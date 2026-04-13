import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const checkComments = searchParams.get("comments") === "true";

  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const NOTION_DB = process.env.NOTION_DATABASE_ID!;

  // Get one page of 100 results
  let cursor: string | undefined;
  let batch: any[] = [];

  // Skip pages if needed
  for (let p = 1; p <= page; p++) {
    const response = await notion.databases.query({
      database_id: NOTION_DB,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });
    batch = response.results;
    cursor = response.next_cursor || undefined;
    if (!response.has_more) break;
  }

  const candidates: any[] = [];

  for (const pg of batch) {
    if (!("properties" in pg)) continue;
    const props = pg.properties as any;

    let name = "Unknown";
    for (const [, val] of Object.entries(props) as [string, any][]) {
      if (val.type === "title") { name = val.title?.map((t: any) => t.plain_text).join("") || "Unknown"; break; }
    }

    let role = "general";
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("role")) { role = val.select?.name || "general"; break; }
    }

    let resumeFiles = 0;
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("resume") && val.type === "files") resumeFiles = val.files?.length || 0;
    }

    let transcriptFiles = 0;
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("gemini") && val.type === "files") transcriptFiles = val.files?.length || 0;
    }

    let aiScore: number | null = null;
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("ai") && key.toLowerCase().includes("score") && val.type === "number") aiScore = val.number;
    }

    let humanScore: number | null = null;
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("human") && key.toLowerCase().includes("score") && val.type === "number") humanScore = val.number;
    }

    let commentCount = -1;
    if (checkComments && resumeFiles > 0) {
      try {
        const comments = await notion.comments.list({ block_id: pg.id });
        commentCount = comments.results.filter((c: any) => {
          const text = c.rich_text?.map((r: any) => r.plain_text).join("") || "";
          return text.trim().length >= 10;
        }).length;
      } catch { commentCount = 0; }
    }

    candidates.push({ id: pg.id, name, role, resumeFiles, transcriptFiles, aiScore, humanScore, commentCount });
  }

  const withCv = candidates.filter((c) => c.resumeFiles > 0);

  withCv.sort((a: any, b: any) => {
    const aScore = (a.transcriptFiles > 0 ? 10 : 0) + (a.aiScore ? 5 : 0) + (a.humanScore ? 5 : 0) + Math.max(a.commentCount, 0);
    const bScore = (b.transcriptFiles > 0 ? 10 : 0) + (b.aiScore ? 5 : 0) + (b.humanScore ? 5 : 0) + Math.max(b.commentCount, 0);
    return bScore - aScore;
  });

  return NextResponse.json({
    batchSize: batch.length,
    withCvInBatch: withCv.length,
    withCv,
    nextPage: page + 1,
  });
}
