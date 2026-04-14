"use client";

import { useEffect, useState, useCallback } from "react";

interface Candidate {
  id: string;
  label: string;
  role: string;
  stage: string;
  composite_score: number | null;
  outcome: string | null;
  properties: Record<string, any>;
  updated_at: string;
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
  if (score === null || score === undefined) return <span className="text-gray-400">—</span>;
  const n = Number(score);
  const color =
    n >= 7 ? "bg-emerald-100 text-emerald-800" :
    n >= 5 ? "bg-amber-100 text-amber-800" :
    "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-semibold ${color}`}>
      {n.toFixed(1)}
    </span>
  );
}

function StageBadge({ stage }: { stage: string }) {
  if (!stage) return null;
  const colors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    interview: "bg-purple-100 text-purple-800",
    hired: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
    trial: "bg-amber-100 text-amber-800",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[stage] || "bg-gray-100 text-gray-800"}`}>
      {stage}
    </span>
  );
}

export default function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);

  const fetchCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/candidates");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCandidates(data.candidates || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      setHealth(await res.json());
    } catch { /* ignore */ }
  }, []);

  const triggerSync = async (fullSync = false) => {
    setSyncing(true);
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
      await fetchCandidates();
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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
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

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-800 text-red-200 text-sm">
            {error}
          </div>
        )}

        {lastSync && (
          <div className="mb-6 p-4 rounded-lg bg-gray-900 border border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">Last Sync Result</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 text-center">
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

        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading candidates...</div>
        ) : candidates.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">No candidates yet</p>
            <p className="text-gray-600 mt-2">Click "Sync Now" to pull candidates from Notion</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-900/80">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Candidate</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Score</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Top Skills</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">DNA</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{c.label || c.id}</div>
                      <div className="text-xs text-gray-500 font-mono">{c.id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{c.role || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={c.composite_score ?? c.properties?.composite_score ?? null} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StageBadge stage={c.stage || (c.properties?.stage as string) || ""} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[200px] truncate">
                      {c.properties?.skill_categories
                        ? (c.properties.skill_categories as any[]).slice(0, 3).map((s: any) => typeof s === "string" ? s : s.name || s.category).join(", ")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[200px] truncate">
                      {(c.properties?.profile_dna as string) || "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-center text-xs text-gray-600">
          {candidates.length} candidates · Auto-refreshes every 30s · Cron syncs every 15min
        </div>
      </main>
    </div>
  );
}
