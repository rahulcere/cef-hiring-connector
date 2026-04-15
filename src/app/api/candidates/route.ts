import { NextResponse } from "next/server";
import { getAllCandidates } from "@/lib/cubby";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await getAllCandidates();

    const candidates = rows.map((c) => {
      const props = c.properties as Record<string, any>;

      // Resume: was the candidate scored from a CV?
      const cvScore = props?.score_components?.cv_score ?? null;
      const hasResume = cvScore !== null;

      // Transcript: did a Transcript Analyzer run on this candidate?
      const hasTranscript = !!props?.interview_scores;

      // Comments: any entries in feedback_history with source = 'notion_comment'?
      const feedbackHistory: any[] = Array.isArray(props?.feedback_history)
        ? props.feedback_history
        : [];
      const commentFeedback = feedbackHistory.filter(
        (f) => f?.source === "notion_comment"
      );
      const hasComments = commentFeedback.length > 0;
      const commentCount = commentFeedback.length;

      // Human score — use best score from feedback_history or promoted outcome column
      const humanScore =
        typeof props?.human_feedback_score === "number"
          ? props.human_feedback_score
          : typeof c.outcome === "number"
          ? Number(c.outcome)
          : null;

      // Notion URL reconstructed from cubby ID (format: "notion-{pageIdNoDashes}")
      const rawId = c.id.replace(/^notion-/, "");
      const notionUrl = `https://notion.so/${rawId}`;

      return {
        id: c.id,
        name: c.label || c.id,
        role: c.role || "—",
        stage: c.stage || "—",
        aiScore: c.composite_score ?? null,
        humanScore,
        hasResume,
        resumeFiles: hasResume ? 1 : 0,
        hasTranscript,
        hasComments,
        commentCount,
        skills: props?.skill_categories ?? null,
        profileDna: props?.profile_dna ?? null,
        cvScore,
        interviewAvg: props?.score_components?.interview_avg ?? null,
        formula: props?.score_components?.formula ?? null,
        notionUrl,
        syncedAt: c.created_at,
      };
    });

    return NextResponse.json({ candidates, count: candidates.length });
  } catch (err: any) {
    console.error("candidates route error:", err.message);
    return NextResponse.json(
      { error: err.message, candidates: [], count: 0 }
    );
  }
}
