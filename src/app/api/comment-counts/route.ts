import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function fetchCommentCount(pageId: string): Promise<number> {
  try {
    const res = await notion.comments.list({ block_id: pageId });
    return res.results.length;
  } catch {
    return 0;
  }
}

export async function POST(request: Request) {
  try {
    const { pageIds } = await request.json();
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    // Batch 10 at a time with 150ms between batches to stay under Notion rate limits
    const BATCH = 10;
    const DELAY = 150;
    const counts: Record<string, number> = {};

    for (let i = 0; i < pageIds.length; i += BATCH) {
      const batch: string[] = pageIds.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((id) => fetchCommentCount(id)));
      results.forEach((n, j) => { counts[batch[j]] = n; });
      if (i + BATCH < pageIds.length) {
        await new Promise((r) => setTimeout(r, DELAY));
      }
    }

    return NextResponse.json({ counts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, counts: {} }, { status: 500 });
  }
}
