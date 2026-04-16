import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

let cachedResult: { candidates: any[]; count: number; hasMore: boolean; cachedAt: string } | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

function getResumeFiles(properties: Record<string, any>): any[] {
  for (const name of ["resume", "cv", "curriculum"]) {
    const prop = findByName(properties, name);
    if (prop?.type === "files" && prop.files?.length > 0) return prop.files;
  }
  return [];
}

function hasTranscriptData(properties: Record<string, any>): boolean {
  for (const name of ["gemini", "transcript", "interview note"]) {
    const prop = findByName(properties, name);
    if (!prop) continue;
    if (prop.type === "files" && prop.files?.length > 0) return true;
    if (prop.type === "url" && prop.url) return true;
    if (prop.type === "rich_text" && prop.rich_text?.[0]?.plain_text) return true;
  }
  return false;
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

function mapPage(page: any) {
  const props = page.properties || {};
  const pageId: string = page.id;

  // Name
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

  // Stage
  const stageProp = findByName(props, "status") || findByName(props, "stage");
  const stage = statusToStage(stageProp ? String(extractText(stageProp) ?? "") : null);

  // Scores
  const aiScoreProp = findByName(props, "ai score") || findByName(props, "ai_score");
  const aiScore = aiScoreProp ? (extractText(aiScoreProp) as number | null) : null;

  const humanScoreProp =
    findByName(props, "human score") ||
    findByName(props, "human_score") ||
    findByName(props, "outcome");
  const humanScore = humanScoreProp ? (extractText(humanScoreProp) as number | null) : null;

  const resumeFiles = getResumeFiles(props);
  const hasTranscript = hasTranscriptData(props);

  return {
    id: pageId,
    name: name || pageId,
    role: role || "—",
    stage,
    aiScore: typeof aiScore === "number" ? aiScore : null,
    humanScore: typeof humanScore === "number" ? humanScore : null,
    hasResume: resumeFiles.length > 0,
    resumeFiles: resumeFiles.length,
    hasTranscript,
    hasComments: false,
    commentCount: 0,
    cvScore: null,
    interviewAvg: null,
    formula: null,
    notionUrl: `https://notion.so/${pageId.replace(/-/g, "")}`,
    syncedAt: page.last_edited_time || "",
  };
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

  if (!forceRefresh && cachedResult && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return NextResponse.json({ ...cachedResult, cached: true });
  }

  try {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const NOTION_DB = process.env.NOTION_DATABASE_ID!;

    const MAX_PAGES = 3;
    const allPages: any[] = [];
    let cursor: string | undefined = undefined;
    let pagesFetched = 0;

    do {
      const response: any = await notion.databases.query({
        database_id: NOTION_DB,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      allPages.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
      pagesFetched++;
    } while (cursor && pagesFetched < MAX_PAGES);

    const candidates = allPages.map(mapPage);
    cachedResult = { candidates, count: candidates.length, hasMore: !!cursor, cachedAt: new Date().toISOString() };
    cacheTimestamp = Date.now();
    return NextResponse.json(cachedResult);
  } catch (err: any) {
    console.error("candidates route error:", err.message);
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult, cached: true, staleReason: err.message });
    }
    return NextResponse.json({ error: err.message, candidates: [], count: 0 });
  }
}

export function invalidateCache() {
  cachedResult = null;
  cacheTimestamp = 0;
}
