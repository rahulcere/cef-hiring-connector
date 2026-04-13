import { NextRequest, NextResponse } from "next/server";
import { getCefClient } from "@/lib/cef-client";
import { syncNotionToCef } from "@/lib/notion-bridge";

// Baseline: only sync changes after this timestamp.
// Set SYNC_BASELINE in env to anchor the start point after initial data push.
// In-memory lastSyncTime moves forward from there with each sync.
let lastSyncTime: string | null = process.env.SYNC_BASELINE || null;
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

  // Allow setting the baseline from the API
  if (body.setBaseline) {
    lastSyncTime = new Date().toISOString();
    return NextResponse.json({ success: true, message: "Baseline set", lastSyncTime });
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
