import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const notion = new Client({ auth: process.env.NOTION_API_KEY });

let cachedCounts: Record<string, number> = {};
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
    const { pageIds, refresh } = await request.json();
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const now = Date.now();
    const cacheValid = !refresh && now - cacheTimestamp < CACHE_TTL_MS;

    if (cacheValid) {
      const allCached = pageIds.every((id: string) => id in cachedCounts);
      if (allCached) {
        const counts: Record<string, number> = {};
        pageIds.forEach((id: string) => { counts[id] = cachedCounts[id] ?? 0; });
        return NextResponse.json({ counts, cached: true });
      }
    }

    const BATCH = 10;
    const DELAY = 200;
    const counts: Record<string, number> = {};

    for (let i = 0; i < pageIds.length; i += BATCH) {
      const batch: string[] = pageIds.slice(i, i + BATCH);
      const uncached = cacheValid
        ? batch.filter((id) => !(id in cachedCounts))
        : batch;

      if (cacheValid) {
        batch.forEach((id) => {
          if (id in cachedCounts) counts[id] = cachedCounts[id];
        });
      }

      if (uncached.length > 0) {
        const results = await Promise.all(uncached.map((id) => fetchCommentCount(id)));
        results.forEach((n, j) => {
          counts[uncached[j]] = n;
          cachedCounts[uncached[j]] = n;
        });
      }

      if (i + BATCH < pageIds.length && uncached.length > 0) {
        await new Promise((r) => setTimeout(r, DELAY));
      }
    }

    cacheTimestamp = now;
    return NextResponse.json({ counts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, counts: {} }, { status: 500 });
  }
}
