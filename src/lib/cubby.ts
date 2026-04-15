const ORCHESTRATOR = process.env.CEF_ORCHESTRATOR_URL!;
const AS_PUBKEY = process.env.CEF_AS_PUBKEY!;
const CUBBY_ALIAS = "ws_2113";

export async function cubbyQuery(sql: string, params: unknown[] = []) {
  const url = `${ORCHESTRATOR}api/v1/agent-services/${AS_PUBKEY}/cubbies/${CUBBY_ALIAS}/instances/default/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cubby query failed (${res.status}): ${text}`);
  }
  return res.json();
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
  // Use only columns confirmed in the nodes schema (no timestamp columns)
  const result = await cubbyQuery(
    `SELECT id, label, type, role, stage, composite_score, outcome, properties
     FROM nodes WHERE type = 'candidate'`
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    if (typeof obj.properties === "string") {
      try { obj.properties = JSON.parse(obj.properties as string); } catch { obj.properties = {}; }
    }
    // Fall back: try to get created_at from properties if it exists
    if (!obj.created_at) {
      const props = obj.properties as any;
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
    [candidateId]
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

export async function getWeightConfigs() {
  const result = await cubbyQuery(
    `SELECT id, label, properties FROM nodes WHERE type = 'weight_config'`
  );
  if (!result.rows) return [];
  const cols: string[] = result.columns || [];
  return result.rows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    if (typeof obj.properties === "string") {
      try { obj.properties = JSON.parse(obj.properties as string); } catch { obj.properties = {}; }
    }
    return obj;
  });
}
