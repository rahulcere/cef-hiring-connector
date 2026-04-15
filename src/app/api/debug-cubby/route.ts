import { NextResponse } from "next/server";
import { cubbyQuery } from "@/lib/cubby";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, any> = {};

  // Test 1: What columns exist on the nodes table?
  try {
    const r = await cubbyQuery(`PRAGMA table_info(nodes)`);
    results.nodes_schema = r;
  } catch (e: any) {
    results.nodes_schema_error = e.message;
  }

  // Test 2: Can we select a single row with just safe columns?
  try {
    const r = await cubbyQuery(`SELECT id, label, type, role, stage, composite_score, outcome FROM nodes WHERE type = 'candidate' LIMIT 1`);
    results.sample_row = r;
  } catch (e: any) {
    results.sample_row_error = e.message;
  }

  // Test 3: How many candidate nodes are there?
  try {
    const r = await cubbyQuery(`SELECT COUNT(*) as count FROM nodes WHERE type = 'candidate'`);
    results.candidate_count = r;
  } catch (e: any) {
    results.candidate_count_error = e.message;
  }

  return NextResponse.json(results);
}
