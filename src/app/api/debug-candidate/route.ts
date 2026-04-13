import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function extractPdfText(fileUrl: string): Promise<{ text: string | null; error: string | null }> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return { text: null, error: `HTTP ${res.status}: ${res.statusText}` };
    const buf = await res.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    const { extractText: extract } = await import("unpdf");
    const result = await extract(uint8);
    const text = Array.isArray(result.text)
      ? result.text.join(" ")
      : String(result.text || "");
    return { text: text.length > 50 ? text.slice(0, 500) + "..." : null, error: text.length <= 50 ? `Text too short (${text.length} chars)` : null };
  } catch (err: any) {
    return { text: null, error: err.message };
  }
}

async function fetchFileAsText(fileUrl: string): Promise<{ text: string | null; error: string | null }> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return { text: null, error: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("pdf") || contentType.includes("octet-stream")) {
      return extractPdfText(fileUrl);
    }
    const text = await res.text();
    return { text: text.length > 50 ? text.slice(0, 500) + "..." : null, error: text.length <= 50 ? `Too short (${text.length})` : null };
  } catch (err: any) {
    return { text: null, error: err.message };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get("id");

  if (!pageId) {
    return NextResponse.json({ error: "Pass ?id=<notion-page-id>" });
  }

  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const debug: Record<string, unknown> = {};

  try {
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const props = page.properties;

    const propSummary: Record<string, { type: string; preview: string }> = {};
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      let preview = "";
      if (val.type === "title") preview = val.title?.map((t: any) => t.plain_text).join("") || "";
      else if (val.type === "rich_text") preview = val.rich_text?.map((t: any) => t.plain_text).join("") || "";
      else if (val.type === "select") preview = val.select?.name || "";
      else if (val.type === "status") preview = val.status?.name || "";
      else if (val.type === "number") preview = String(val.number ?? "");
      else if (val.type === "url") preview = val.url || "";
      else if (val.type === "files") preview = `${val.files?.length || 0} file(s): ${val.files?.map((f: any) => f.name).join(", ")}`;
      else preview = `(${val.type})`;
      propSummary[key] = { type: val.type, preview };
    }
    debug.properties = propSummary;

    // Resume extraction
    const resumeDebug: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (!key.toLowerCase().includes("resume")) continue;
      resumeDebug.propertyName = key;
      resumeDebug.type = val.type;
      if (val.type === "files" && val.files?.length > 0) {
        resumeDebug.fileCount = val.files.length;
        const fileResults = [];
        for (const f of val.files) {
          const url = f.type === "file" ? f.file?.url : f.external?.url;
          const fileInfo: Record<string, unknown> = {
            name: f.name,
            fileType: f.type,
            hasUrl: !!url,
            urlStart: url?.substring(0, 80),
          };
          if (url) {
            fileInfo.extraction = await extractPdfText(url);
          }
          fileResults.push(fileInfo);
        }
        resumeDebug.files = fileResults;
      } else {
        resumeDebug.note = "No files found in resume property";
      }
    }
    debug.resume = Object.keys(resumeDebug).length > 0 ? resumeDebug : "No 'resume' property found";

    // Transcript extraction (gemini)
    const transcriptDebug: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (!key.toLowerCase().includes("gemini")) continue;
      transcriptDebug.propertyName = key;
      transcriptDebug.type = val.type;
      if (val.type === "files" && val.files?.length > 0) {
        transcriptDebug.fileCount = val.files.length;
        const fileResults = [];
        for (const f of val.files) {
          const url = f.type === "file" ? f.file?.url : f.external?.url;
          const fileInfo: Record<string, unknown> = {
            name: f.name,
            fileType: f.type,
            hasUrl: !!url,
            urlStart: url?.substring(0, 80),
          };
          if (url) {
            fileInfo.extraction = await fetchFileAsText(url);
          }
          fileResults.push(fileInfo);
        }
        transcriptDebug.files = fileResults;
      } else if (val.type === "url") {
        transcriptDebug.url = val.url;
      } else if (val.type === "rich_text") {
        transcriptDebug.text = val.rich_text?.map((t: any) => t.plain_text).join("") || "";
      } else {
        transcriptDebug.note = `Property type is ${val.type}, no files`;
      }
    }
    debug.transcript = Object.keys(transcriptDebug).length > 0 ? transcriptDebug : "No 'gemini' property found";

    // AI Score
    const aiScoreDebug: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("ai") && key.toLowerCase().includes("score")) {
        aiScoreDebug.propertyName = key;
        aiScoreDebug.type = val.type;
        aiScoreDebug.value = val.type === "number" ? val.number : "(not a number)";
      }
    }
    debug.aiScore = Object.keys(aiScoreDebug).length > 0 ? aiScoreDebug : "No AI Score property found";

    // Human Score
    const humanScoreDebug: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props) as [string, any][]) {
      if (key.toLowerCase().includes("human") && key.toLowerCase().includes("score")) {
        humanScoreDebug.propertyName = key;
        humanScoreDebug.type = val.type;
        humanScoreDebug.value = val.type === "number" ? val.number : "(not a number)";
      }
    }
    debug.humanScore = Object.keys(humanScoreDebug).length > 0 ? humanScoreDebug : "No Human Score property found";

    // Comments
    try {
      const comments = await notion.comments.list({ block_id: pageId });
      debug.comments = {
        count: comments.results.length,
        items: comments.results.map((c: any) => ({
          author: c.created_by?.name || c.created_by?.id || "Unknown",
          text: c.rich_text?.map((r: any) => r.plain_text).join("") || "",
          createdAt: c.created_time,
        })),
      };
    } catch (err: any) {
      debug.comments = { error: err.message };
    }

    return NextResponse.json({ ok: true, debug });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message, stack: err.stack?.split("\n").slice(0, 5) });
  }
}
