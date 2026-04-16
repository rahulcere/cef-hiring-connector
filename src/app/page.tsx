"use client";

import { useEffect, useState, useCallback } from "react";

interface Candidate {
  id: string;
  name: string;
  role: string;
  stage: string;
  aiScore: number | null;
  humanScore: number | null;
  hasResume: boolean;
  hasTranscript: boolean;
  hasComments: boolean;
  commentCount: number;
  cvScore: number | null;
  interviewAvg: number | null;
  formula: string | null;
  notionUrl: string;
  syncedAt: string;
}

interface SyncStats {
  candidates: number;
  transcripts: number;
  humanScores: number;
  aiScores: number;
  statusOutcomes: number;
  comments: number;
  pdfs: number;
  skipped: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-gray-500">—</span>;
  const n = Number(score);
  const color =
    n >= 7 ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/50" :
    n >= 5 ? "bg-amber-900/60 text-amber-300 border-amber-700/50" :
    "bg-red-900/60 text-red-300 border-red-700/50";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${color}`}>
      {n.toFixed(1)}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  if (!stage || stage === "—") return <span className="text-gray-500">—</span>;
  const lower = stage.toLowerCase();
  const color =
    lower === "hired" ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/50" :
    lower === "trial" ? "bg-blue-900/60 text-blue-300 border-blue-700/50" :
    lower === "rejected" ? "bg-red-900/60 text-red-300 border-red-700/50" :
    lower === "interview" ? "bg-purple-900/60 text-purple-300 border-purple-700/50" :
    lower === "ai_scored" ? "bg-gray-800 text-gray-300 border-gray-700/50" :
    "bg-gray-800 text-gray-400 border-gray-700/50";
  const label =
    lower === "ai_scored" ? "AI Scored" :
    stage.charAt(0).toUpperCase() + stage.slice(1);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${color}`}>
      {label}
    </span>
  );
}

function DataBadge({ has, label }: { has: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${has ? "text-emerald-400" : "text-gray-600"}`}>
      {has ? "✓" : "✗"} {label}
    </span>
  );
}

function formatDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs < 1) return "just now";
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingComments, setLoadingComments] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "withCV" | "withTranscript" | "withComments">("all");
  const [search, setSearch] = useState("");

  const fetchCommentCounts = useCallback(async (list: Candidate[]) => {
    if (list.length === 0) return;
    setLoadingComments(true);
    try {
      const res = await fetch("/api/comment-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIds: list.map((c) => c.id) }),
      });
      const data = await res.json();
      if (data.counts) {
        setCandidates((prev) =>
          prev.map((c) => ({
            ...c,
            hasComments: (data.counts[c.id] ?? 0) > 0,
            commentCount: data.counts[c.id] ?? 0,
          }))
        );
      }
    } catch {
      // ignore comment load errors
    } finally {
      setLoadingComments(false);
    }
  }, []);

  const fetchCandidates = useCallback(async (refresh = false) => {
    try {
      const url = refresh ? "/api/candidates?refresh=true" : "/api/candidates";
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const list: Candidate[] = data.candidates || [];
      setCandidates(list);
      setError(null);
      if (!data.cached) fetchCommentCounts(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchCommentCounts]);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setHealth(await res.json());
    } catch { /* ignore */ }
  }, []);

  const triggerSync = async (fullSync = false) => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: true, fullSync, limit: fullSync ? 15 : 50 }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error("Sync timed out — try syncing fewer candidates or use incremental sync");
      }
      if (data.error) throw new Error(data.error);
      setLastSync(data.stats);
      await fetchCandidates(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
    fetchHealth();
    const interval = setInterval(fetchCandidates, 30000);
    return () => clearInterval(interval);
  }, [fetchCandidates, fetchHealth]);

  const filtered = candidates.filter((c) => {
    if (filter === "withCV" && !c.hasResume) return false;
    if (filter === "withTranscript" && !c.hasTranscript) return false;
    if (filter === "withComments" && !c.hasComments) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.role.toLowerCase().includes(q);
    }
    return true;
  });

  const withCV = candidates.filter((c) => c.hasResume).length;
  const withTranscript = candidates.filter((c) => c.hasTranscript).length;
  const withAiScore = candidates.filter((c) => c.aiScore !== null).length;
  const withHumanScore = candidates.filter((c) => c.humanScore !== null).length;
  const withComments = candidates.filter((c) => c.hasComments).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CEF Hiring Connector</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Notion → CEF AI Pipeline → Live Scores
            </p>
          </div>
          <div className="flex items-center gap-3">
            {health && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                health.status === "healthy" ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${health.status === "healthy" ? "bg-emerald-400" : "bg-red-400"}`} />
                {health.status}
              </span>
            )}
            <button
              onClick={() => triggerSync(false)}
              disabled={syncing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 rounded-lg text-sm font-medium transition-colors"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
            <button
              onClick={() => triggerSync(true)}
              disabled={syncing}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
            >
              Full Re-sync
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-800 text-red-200 text-sm">
            {error}
          </div>
        )}

        {lastSync && (
          <div className="mb-6 p-4 rounded-lg bg-gray-900 border border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Sync Result</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 text-center">
              {[
                ["Candidates", lastSync.candidates],
                ["Resumes", lastSync.pdfs],
                ["Transcripts", lastSync.transcripts],
                ["AI Scores", lastSync.aiScores],
                ["Human Scores", lastSync.humanScores],
                ["Statuses", lastSync.statusOutcomes],
                ["Comments", lastSync.comments],
                ["Skipped", lastSync.skipped],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="text-2xl font-bold text-white">{value}</div>
                  <div className="text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            {lastSync.errors.length > 0 && (
              <div className="mt-3 text-xs text-red-400">
                {lastSync.errors.length} error(s): {lastSync.errors[0]}
              </div>
            )}
          </div>
        )}

        {!loading && (
          <div className="mb-6 grid grid-cols-3 sm:grid-cols-6 gap-4">
            {[
              { label: "Synced", value: candidates.length, color: "text-white" },
              { label: "With CV", value: withCV, color: "text-emerald-400" },
              { label: "With Transcript", value: withTranscript, color: "text-blue-400" },
              { label: "AI Scored", value: withAiScore, color: "text-purple-400" },
              { label: "Human Scored", value: withHumanScore, color: "text-amber-400" },
              { label: "With Comments", value: loadingComments ? "…" : withComments, color: "text-sky-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="p-4 rounded-lg bg-gray-900 border border-gray-800 text-center">
                <div className={`text-3xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-gray-400 mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && candidates.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by name or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 w-64 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-1">
              {(["all", "withCV", "withTranscript", "withComments"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {f === "all" ? "All" : f === "withCV" ? "Has CV" : f === "withTranscript" ? "Has Transcript" : "Has Comments"}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-500 ml-auto">
              Showing {filtered.length} of {candidates.length}
            </span>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading synced candidates...</div>
        ) : candidates.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">No synced candidates yet</p>
            <p className="text-gray-600 mt-2">Click "Sync Now" to push candidates from Notion through the CEF pipeline</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-900/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Candidate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">AI Score</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Human Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Score Breakdown</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Data</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Synced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-600">{i + 1}</td>
                    <td className="px-4 py-3">
                      <a
                        href={c.notionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-white hover:text-blue-400 transition-colors"
                      >
                        {c.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{c.role}</td>
                    <td className="px-4 py-3 text-center">
                      <StageBadge stage={c.stage} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={c.aiScore} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={c.humanScore} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {c.cvScore !== null && <span>CV: <span className="text-gray-300">{Number(c.cvScore).toFixed(1)}</span></span>}
                        {c.interviewAvg !== null && <span>IV: <span className="text-gray-300">{Number(c.interviewAvg).toFixed(1)}</span></span>}
                        {c.formula && <span className="text-gray-600 truncate max-w-[120px]">{c.formula}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <DataBadge has={c.hasResume} label="CV" />
                        <DataBadge has={c.hasTranscript} label="IV" />
                        <span className={`inline-flex items-center gap-1 text-xs ${c.hasComments ? "text-sky-400" : loadingComments ? "text-gray-600" : "text-gray-600"}`}>
                          {loadingComments && !c.hasComments ? "···" : c.hasComments ? `✓ ${c.commentCount}💬` : "✗ 💬"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {formatDate(c.syncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-center text-xs text-gray-600">
          {candidates.length} candidates synced to CEF pipeline · Auto-refreshes every 30s
        </div>
      </main>
    </div>
  );
}
