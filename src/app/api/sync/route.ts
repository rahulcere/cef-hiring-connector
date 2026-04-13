import { NextRequest, NextResponse } from "next/server";
import { getCefClient } from "@/lib/cef-client";
import { syncNotionToCef } from "@/lib/notion-bridge";

// In-memory sync state (resets on cold start — fine for cron)
let lastSyncTime: string | null = null;
let lastSyncResult: any = null;

export const maxDuration = 120; // 2 minutes max for Vercel
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Return last sync result
  return NextResponse.json({
    lastSyncTime,
    lastSyncResult,
    status: "ok",
  });
}

export async function POST(request: NextRequest) {
  // Verify cron secret for automated calls
  const authHeader = request.headers.get("authorization");
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const body = await request.json().catch(() => ({}));
  const isManual = body.manual === true;

  if (!isVercelCron && !isManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getCefClient();
    const stats = await syncNotionToCef(client, {
      limit: body.limit ?? 50,
      lastSyncTime: body.fullSync ? null : lastSyncTime,
      pageIds: body.pageIds,
    });

    lastSyncTime = stats.completedAt;
    lastSyncResult = stats;

    return NextResponse.json({ success: true, stats });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
