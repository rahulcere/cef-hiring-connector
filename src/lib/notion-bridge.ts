import { Client } from "@notionhq/client";
import type { ClientSdk } from "@cef-ai/client-sdk";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const STATUS_OUTCOME: Record<string, number> = {
  accepted: 9,
  "company rejected": 2,
  "candidate rejected": 3,
  trial: 7,
  "sent for trial": 7,
};

function extractText(prop: any): string | number | any[] {
  if (!prop) return "";
  if (prop.type === "title")
    return prop.title?.map((t: any) => t.plain_text).join("") || "";
  if (prop.type === "rich_text")
    return prop.rich_text?.map((t: any) => t.plain_text).join("") || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "number") return prop.number;
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "multi_select")
    return prop.multi_select?.map((s: any) => s.name).join(", ") || "";
  if (prop.type === "files") return prop.files || [];
  return "";
}

function findByName(properties: any, name: string) {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(properties)) {
    if (key.toLowerCase().includes(lower)) return { key, val };
  }
  return null;
}

function findByType(properties: any, type: string) {
  for (const [key, val] of Object.entries(properties) as [string, any][]) {
    if (val.type === type) return { key, val };
  }
  return null;
}

async function extractPdfText(fileUrl: string): Promise<string | null> {
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) return null;
    const uint8 = new Uint8Array(await res.arrayBuffer());
    const { extractText: extract } = await import("unpdf");
    const result = await extract(uint8);
    const text = Array.isArray(result.text)
      ? result.text.join(" ")
      : String(result.text || "");
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

async function fetchGoogleDoc(url: string): Promise<string | null> {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${match[1]}/export?format=txt`
    );
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

async function llmParseComment(
  commentText: string,
  authorName: string
): Promise<any | null> {
  if (!GEMINI_KEY) return null;
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + GEMINI_KEY,
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "system",
            content: `Parse this hiring evaluator comment into structured feedback. Return ONLY valid JSON:
{"verdict":"positive"|"negative"|"neutral","score":<0-10 or null>,"strengths":["..."],"risks":["..."],"summary":"<1 sentence>"}`,
          },
          {
            role: "user",
            content: `Evaluator: ${authorName}\nComment: ${commentText}`,
          },
        ],
        temperature: 0,
      }),
    });
    const data = await res.json();
    const raw = data.choices[0].message.content;
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch {
    return null;
  }
}

export interface SyncStats {
  candidates: number;
  transcripts: number;
  humanScores: number;
  statusOutcomes: number;
  comments: number;
  pdfs: number;
  skipped: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

export async function syncNotionToCef(
  client: ClientSdk,
  options: { limit?: number; lastSyncTime?: string | null } = {}
): Promise<SyncStats> {
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const NOTION_DB = process.env.NOTION_DATABASE_ID!;
  const limit = options.limit ?? 50;

  const stats: SyncStats = {
    candidates: 0,
    transcripts: 0,
    humanScores: 0,
    statusOutcomes: 0,
    comments: 0,
    pdfs: 0,
    skipped: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
  };

  const filter = options.lastSyncTime
    ? {
        timestamp: "last_edited_time" as const,
        last_edited_time: { after: options.lastSyncTime },
      }
    : undefined;

  const response = await notion.databases.query({
    database_id: NOTION_DB,
    filter,
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
  });

  const pages = response.results.slice(0, limit);

  for (const page of pages) {
    const pageId = page.id.replace(/-/g, "");
    const candidateId = `notion-${pageId}`;

    if (!("properties" in page)) continue;
    const props = page.properties;

    const titleProp = findByType(props, "title");
    const name = titleProp ? String(extractText(titleProp.val)) : "Unknown";
    const roleProp = findByName(props, "role");
    const role = roleProp ? String(extractText(roleProp.val) || "general") : "general";

    const textParts = [`Candidate: ${name}`, `Role: ${role}`];
    for (const [key, val] of Object.entries(props)) {
      if ((val as any).type === "title" || (val as any).type === "files") continue;
      const text = extractText(val);
      if (text && String(text).length > 2) textParts.push(`${key}: ${text}`);
    }

    // Page body
    try {
      const blocks = await notion.blocks.children.list({ block_id: page.id });
      for (const block of blocks.results) {
        if ("type" in block) {
          if (block.type === "paragraph" && (block as any).paragraph?.rich_text) {
            const t = (block as any).paragraph.rich_text
              .map((r: any) => r.plain_text)
              .join("");
            if (t.trim()) textParts.push(t);
          }
          if (block.type === "bulleted_list_item" && (block as any).bulleted_list_item?.rich_text) {
            const t = (block as any).bulleted_list_item.rich_text
              .map((r: any) => r.plain_text)
              .join("");
            if (t.trim()) textParts.push("- " + t);
          }
        }
      }
    } catch { /* ignore */ }

    // PDF resume
    const resumeProp = findByName(props, "resume");
    if (resumeProp) {
      const files = (resumeProp.val as any).files || [];
      for (const file of files) {
        const url =
          file.type === "file" ? file.file?.url : file.external?.url;
        if (!url) continue;
        const isPdf =
          file.name?.toLowerCase().endsWith(".pdf") ||
          url.includes(".pdf") ||
          url.includes("secure.notion-static.com");
        if (isPdf) {
          const pdfText = await extractPdfText(url);
          if (pdfText) {
            textParts.push(`\n--- Resume (PDF) ---\n${pdfText}`);
            stats.pdfs++;
          }
        }
      }
    }

    const resumeText = textParts.join("\n");
    if (resumeText.length < 200) {
      stats.skipped++;
      continue;
    }

    // 1. NEW_APPLICATION
    try {
      await client.event.create("USER_CONVERSATION", {
        event_type: "NEW_APPLICATION",
        candidateId,
        candidateName: name,
        resumeText,
        role,
      });
      stats.candidates++;
    } catch (err: any) {
      stats.errors.push(`NEW_APPLICATION for ${name}: ${err.message}`);
    }

    // 2. Interview transcript
    const geminiProp = findByName(props, "gemini");
    let transcriptText: string | null = null;
    if (geminiProp) {
      const val = geminiProp.val as any;
      if (val.type === "files" && val.files?.length > 0) {
        for (const f of val.files) {
          if (transcriptText) break;
          const fileUrl = f.type === "file" ? f.file?.url : f.external?.url;
          if (!fileUrl) continue;
          const fname = (f.name || "").toLowerCase();
          if (fname.endsWith(".pdf") || fileUrl.includes(".pdf") || fileUrl.includes("secure.notion-static.com")) {
            transcriptText = await extractPdfText(fileUrl);
          }
          if (!transcriptText) {
            try {
              const res = await fetch(fileUrl);
              if (res.ok) {
                const text = await res.text();
                if (text.length > 50) transcriptText = text;
              }
            } catch { /* ignore */ }
          }
        }
      } else if (val.type === "url" || val.type === "rich_text") {
        const urlText = String(extractText(val));
        if (urlText.includes("docs.google.com")) {
          transcriptText = await fetchGoogleDoc(urlText);
        }
      }

      if (transcriptText) {
        try {
          await client.event.create("USER_CONVERSATION", {
            event_type: "INTERVIEW_TRANSCRIPT",
            candidateId,
            role,
            transcriptText,
          });
          stats.transcripts++;
        } catch (err: any) {
          stats.errors.push(`INTERVIEW_TRANSCRIPT for ${name}: ${err.message}`);
        }
      }
    }

    // 3. Human Score
    const humanScoreProp = findByName(props, "human score");
    if (humanScoreProp) {
      const humanScore = extractText(humanScoreProp.val);
      if (typeof humanScore === "number" && humanScore > 0) {
        try {
          await client.event.create("USER_CONVERSATION", {
            event_type: "OUTCOME_RECORDED",
            candidateId,
            role,
            outcome: humanScore,
            source: "notion_property",
          });
          stats.humanScores++;
        } catch (err: any) {
          stats.errors.push(`HUMAN_SCORE for ${name}: ${err.message}`);
        }
      }
    }

    // 4. Status → Outcome
    const statusProp = findByName(props, "status");
    if (statusProp) {
      const statusText = String(extractText(statusProp.val));
      if (statusText.length >= 2) {
        const learningOutcome =
          STATUS_OUTCOME[statusText.toLowerCase()] || 5;
        try {
          await client.event.create("USER_CONVERSATION", {
            event_type: "OUTCOME_RECORDED",
            candidateId,
            role,
            outcome: learningOutcome,
            source: "notion_status",
            notionStatus: statusText,
          });
          stats.statusOutcomes++;
        } catch (err: any) {
          stats.errors.push(`STATUS for ${name}: ${err.message}`);
        }
      }
    }

    // 5. Comments
    try {
      const commentsResponse = await notion.comments.list({
        block_id: page.id,
      });
      for (const comment of commentsResponse.results) {
        const commentText =
          comment.rich_text?.map((r: any) => r.plain_text).join("") || "";
        if (!commentText.trim() || commentText.length < 10) continue;
        const authorName =
          (comment as any).created_by?.name ||
          (comment as any).created_by?.id ||
          "Unknown";
        const parsed = await llmParseComment(commentText, authorName);
        if (parsed?.score !== null && parsed?.score !== undefined) {
          try {
            await client.event.create("USER_CONVERSATION", {
              event_type: "OUTCOME_RECORDED",
              candidateId,
              role,
              outcome: parsed.score,
              evaluatorName: authorName,
              source: "notion_comment",
              strengths: JSON.stringify(parsed.strengths || []),
              risks: JSON.stringify(parsed.risks || []),
            });
            stats.comments++;
          } catch (err: any) {
            stats.errors.push(`COMMENT for ${name}: ${err.message}`);
          }
        }
      }
    } catch { /* ignore */ }

    await new Promise((r) => setTimeout(r, 300));
  }

  stats.completedAt = new Date().toISOString();
  return stats;
}
