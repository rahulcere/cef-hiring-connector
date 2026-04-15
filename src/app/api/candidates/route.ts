import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NOTION_DB = process.env.NOTION_DATABASE_ID!;

function extractText(prop: any): string | number | null {
  if (!prop) return null;
  if (prop.type === "title") return prop.title?.map((t: any) => t.plain_text).join("") || null;
  if (prop.type === "rich_text") return prop.rich_text?.map((t: any) => t.plain_text).join("") || null;
  if (prop.type === "select") return prop.select?.name || null;
  if (prop.type === "status") return prop.status?.name || null;
  if (prop.type === "number") return typeof prop.number === "number" ? prop.number : null;
  if (prop.type === "multi_select") return prop.multi_select?.map((s: any) => s.name).join(", ") || null;
  if (prop.type === "email") return prop.email || null;
  if (prop.type === "url") return prop.url || null;
  return null;
}

function findByName(properties: Record<string, any>, name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(properties)) {
    if (key.toLowerCase().includes(lower)) return val;
  }
  return null;
}

function getFiles(properties: Record<string, any>, ...names: string[]): any[] {
  for (const name of names) {
    const prop = findByName(properties, name);
    if (prop?.type === "files" && prop.files?.length > 0) return prop.files;
  }
  // Also check all files-type properties
  for (const val of Object.values(properties) as any[]) {
    if (val?.type === "files" && val.files?.length > 0) return val.files;
  }
  return [];
}

function statusToStage(status: string | null): string {
  if (!status) return "applied";
  const lower = status.toLowerCase();
  if (lower.includes("hired") || lower.includes("accept")) return "hired";
  if (lower.includes("trial")) return "trial";
  if (lower.includes("reject")) return "rejected";
  if (lower.includes("interview")) return "interview";
  if (lower.includes("review")) return "review";
  return lower.replace(/\s+/g, "_");
}

export async function GET() {
  try {
    // Paginate through all Notion results
    const allPages: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const response: any = await notion.databases.query({
        database_id: NOTION_DB,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      allPages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    const candidates = allPages.map((page: any) => {
      const props = page.properties || {};
      const pageId: string = page.id; // UUID with dashes

      // Name — find title property
      let name = "";
      for (const val of Object.values(props) as any[]) {
        if (val?.type === "title") {
          name = val.title?.map((t: any) => t.plain_text).join("") || "";
          if (name) break;
        }
      }

      // Role
      const roleProp = findByName(props, "role") || findByName(props, "position");
      const role = roleProp ? String(extractText(roleProp) ?? "") : "";

      // Stage / Status
      const stageProp = findByName(props, "status") || findByName(props, "stage");
      const stageRaw = stageProp ? String(extractText(stageProp) ?? "") : "";
      const stage = statusToStage(stageRaw || null);

      // AI Score
      const aiScoreProp = findByName(props, "ai score") || findByName(props, "ai_score");
      const aiScore = aiScoreProp ? (extractText(aiScoreProp) as number | null) : null;

      // Human Score
      const humanScoreProp =
        findByName(props, "human score") ||
        findByName(props, "human_score") ||
        findByName(props, "outcome");
      const humanScore = humanScoreProp ? (extractText(humanScoreProp) as number | null) : null;

      // Resume files
      const resumeFiles = getFiles(props, "resume", "cv", "curriculum");
      const hasResume = resumeFiles.length > 0;

      // Transcript files
      const transcriptProp =
        findByName(props, "gemini") ||
        findByName(props, "transcript") ||
        findByName(props, "interview");
      const transcriptFiles =
        transcriptProp?.type === "files" ? (transcriptProp.files || []) : [];
      const transcriptUrl =
        transcriptProp?.type === "url" ? transcriptProp.url :
        transcriptProp?.type === "rich_text" ? (transcriptProp.rich_text?.[0]?.plain_text || "") : "";
      const hasTranscript = transcriptFiles.length > 0 || !!transcriptUrl;

      // Notion URL (strip dashes for notion.so short URL)
      const notionUrl = `https://notion.so/${pageId.replace(/-/g, "")}`;

      return {
        id: pageId,
        name: name || pageId,
        role: role || "—",
        stage,
        aiScore: typeof aiScore === "number" ? aiScore : null,
        humanScore: typeof humanScore === "number" ? humanScore : null,
        hasResume,
        resumeFiles: resumeFiles.length,
        hasTranscript,
        hasComments: false,    // lazy-loaded client-side via /api/comment-counts
        commentCount: 0,
        cvScore: null,
        interviewAvg: null,
        formula: null,
        notionUrl,
        syncedAt: page.last_edited_time || "",
      };
    });

    return NextResponse.json({ candidates, count: candidates.length });
  } catch (err: any) {
    console.error("candidates route error:", err.message);
    return NextResponse.json({ error: err.message, candidates: [], count: 0 });
  }
}
