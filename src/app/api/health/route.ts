import { NextResponse } from "next/server";

export async function GET() {
  const checks = {
    notion: !!process.env.NOTION_API_KEY,
    cef_orchestrator: !!process.env.CEF_ORCHESTRATOR_URL,
    cef_wallet: !!process.env.CEF_WALLET_JSON,
    cef_workspace: !!process.env.CEF_WORKSPACE_ID,
    gemini: !!process.env.GEMINI_API_KEY,
  };
  const allGood = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: allGood ? "healthy" : "misconfigured", checks });
}
