import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const checkComments = searchParams.get("comments") === "true";

  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const NOTION_DB = process.env.NOTION_DATABASE_ID!;

  const allPages: any[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await notion.databases.query({
      database_id: NOTION_DB,
      start_cursor: cursor,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });
    allPages.push(...response.results);
    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  const withCv: { id: string; name: string; role: string; resumeFiles: number; transcriptFiles: number; aiScore: number | null; humanScore: number | null; commentCount: number }[] = [];

  for (const page of allPages) {
    if (!("properties" in page)) continue;
    const props = page.properties as any;

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

    if (resumeFiles === 0) continue;

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

    let commentCount = 0;
    if (checkComments) {
      try {
        const comments = await notion.comments.list({ block_id: page.id });
        commentCount = comments.results.filter((c: any) => {
          const text = c.rich_text?.map((r: any) => r.plain_text).join("") || "";
          return text.trim().length >= 10;
        }).length;
      } catch { /* ignore */ }
    }

    withCv.push({ id: page.id, name, role, resumeFiles, transcriptFiles, aiScore, humanScore, commentCount });
  }

  withCv.sort((a, b) => {
    const aScore = (a.transcriptFiles > 0 ? 10 : 0) + (a.aiScore ? 5 : 0) + (a.humanScore ? 5 : 0) + a.commentCount;
    const bScore = (b.transcriptFiles > 0 ? 10 : 0) + (b.aiScore ? 5 : 0) + (b.humanScore ? 5 : 0) + b.commentCount;
    return bScore - aScore;
  });

  return NextResponse.json({
    totalInDb: allPages.length,
    withCv: withCv.length,
    candidates: withCv,
  });
}
