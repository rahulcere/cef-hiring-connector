import { NextResponse } from "next/server";

export async function GET() {
  const hasWallet =
    !!(process.env.CEF_WALLET_MNEMONIC || process.env.WALLET_MNEMONIC || "").trim() ||
    !!process.env.CEF_WALLET_JSON;
  const checks = {
    notion: !!process.env.NOTION_API_KEY,
    cef_orchestrator: !!process.env.CEF_ORCHESTRATOR_URL,
    cef_gar: !!process.env.CEF_GAR_URL,
    cef_wallet: hasWallet,
    cef_workspace: !!process.env.CEF_WORKSPACE_ID,
    cef_stream: !!process.env.CEF_STREAM_ID,
    cef_agent: !!process.env.CEF_AS_PUBKEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };
  const allGood = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: allGood ? "healthy" : "misconfigured", checks });
}
