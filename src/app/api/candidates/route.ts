import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NOTION_DB = process.env.NOTION_DATABASE_ID!;

function extractText(prop: any): string | number | any[] {
  if (!prop) return "";
  if (prop.type === "title")
    return prop.title?.map((t: any) => t.plain_text).join("") || "";
  if (prop.type === "rich_text")
    return prop.rich_text?.map((t: any) => t.plain_text).join("") || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "number") return prop.number ?? "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "multi_select")
    return prop.multi_select?.map((s: any) => s.name).join(", ") || "";
  if (prop.type === "files") return prop.files || [];
  return "";
}

function findByName(properties: any, name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(properties)) {
    if (key.toLowerCase().includes(lower)) return { key, val };
  }
  return null;
}

function findByType(properties: any, type: string) {
  for (const [key, val] of Object.entries(properties) as [string, any][]) {
    if (val.type === type) return { key, val };
  }
  return null;
}

async function fetchCommentCount(pageId: string): Promise<number> {
  try {
    const res = await notion.comments.list({ block_id: pageId });
    return res.results.length;
  } catch {
    return 0;
  }
}

// Fetch comments 10 at a time to avoid Notion rate limits (~3 req/s)
async function batchFetchComments(pageIds: string[]): Promise<number[]> {
  const BATCH = 10;
  const DELAY = 150; // ms between batches
  const results: number[] = new Array(pageIds.length).fill(0);

  for (let i = 0; i < pageIds.length; i += BATCH) {
    const batch = pageIds.slice(i, i + BATCH);
    const counts = await Promise.all(batch.map((id) => fetchCommentCount(id)));
    counts.forEach((n, j) => { results[i + j] = n; });
    if (i + BATCH < pageIds.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }
  return results;
}

export async function GET() {
  try {
    // Paginate through ALL Notion results (Notion returns max 100 per page)
    const allPages: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response: any = await notion.databases.query({
        database_id: NOTION_DB,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
      allPages.push(...response.results);
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    const validPages = allPages.filter((page: any) => "properties" in page);

    const candidates = validPages.map((page: any) => {
      const props = page.properties;
      const titleProp = findByType(props, "title");
      const name = titleProp ? String(extractText(titleProp.val)) : "Unknown";
      const roleProp = findByName(props, "role");
      const role = roleProp ? String(extractText(roleProp.val) || "—") : "—";
      const statusProp = findByName(props, "status");
      const status = statusProp ? String(extractText(statusProp.val) || "—") : "—";

      const aiScoreProp = findByName(props, "ai score");
      const aiScore = aiScoreProp ? (aiScoreProp.val as any).number ?? null : null;

      const humanScoreProp = findByName(props, "human score");
      const humanScore = humanScoreProp ? (humanScoreProp.val as any).number ?? null : null;

      const resumeProp = findByName(props, "resume");
      const resumeFiles = resumeProp ? ((resumeProp.val as any).files?.length || 0) : 0;

      const transcriptProp = findByName(props, "gemini");
      let hasTranscript = false;
      if (transcriptProp) {
        const v = transcriptProp.val as any;
        if (v.type === "files" && v.files?.length > 0) hasTranscript = true;
        else if (v.type === "url" && v.url) hasTranscript = true;
        else if (v.type === "rich_text" && v.rich_text?.length > 0) hasTranscript = true;
      }

      return {
        id: page.id,
        name,
        role,
        status,
        aiScore,
        humanScore,
        hasResume: resumeFiles > 0,
        resumeFiles,
        hasTranscript,
        hasComments: false, // filled below
        commentCount: 0,    // filled below
        lastEdited: page.last_edited_time,
        createdTime: page.created_time,
        notionUrl: `https://notion.so/${page.id.replace(/-/g, "")}`,
      };
    });

    // Fetch comment counts for all candidates (batched to respect rate limits)
    const pageIds = candidates.map((c) => c.id);
    const commentCounts = await batchFetchComments(pageIds);
    commentCounts.forEach((count, i) => {
      candidates[i].commentCount = count;
      candidates[i].hasComments = count > 0;
    });

    return NextResponse.json({ candidates, count: candidates.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, candidates: [], count: 0 },
      { status: 500 }
    );
  }
}
