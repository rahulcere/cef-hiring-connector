import { getCefClient } from "./cef-client";

/** Cubby SQL via ClientSdk (same path as v0.0.12; cubby alias is ws_{workspace_id}). */
export async function cubbyQuery(sql: string, params: unknown[] = []) {
  const client = await getCefClient();
  const result = await client.query.sql(sql, params);
  return result as { rows?: unknown[][]; columns?: string[] };
}

export interface CandidateRow {
  id: string;
  label: string;
  type: string;
  role: string;
  stage: string;
  composite_score: number | null;
  outcome: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

export async function getAllCandidates(): Promise<CandidateRow[]> {
  const result = await cubbyQuery(
    `SELECT id, label, type, role, stage, composite_score, outcome, properties
     FROM nodes WHERE type = 'candidate'`,
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    if (typeof obj.properties === "string") {
      try {
        obj.properties = JSON.parse(obj.properties as string);
      } catch {
        obj.properties = {};
      }
    }
    if (!obj.created_at) {
      const props = obj.properties as Record<string, unknown>;
      obj.created_at = props?.created_at || props?.synced_at || "";
    }
    return obj as unknown as CandidateRow;
  });
}

export async function getCandidateEdges(candidateId: string) {
  const result = await cubbyQuery(
    `SELECT e.relationship, e.weight, n.label, n.type
     FROM edges e JOIN nodes n ON e.target_id = n.id
     WHERE e.source_id = ?`,
    [candidateId],
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

export async function getWeightConfigs() {
  const result = await cubbyQuery(
    `SELECT id, label, properties FROM nodes WHERE type = 'weight_config'`,
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    if (typeof obj.properties === "string") {
      try {
        obj.properties = JSON.parse(obj.properties as string);
      } catch {
        obj.properties = {};
      }
    }
    return obj;
  });
}
