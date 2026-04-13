import { NextResponse } from "next/server";
import { getAllCandidates, getCandidateEdges, getWeightConfigs } from "@/lib/cubby";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const detail = searchParams.get("id");

  try {
    if (detail) {
      const candidates = await getAllCandidates();
      const candidate = candidates.find((c) => c.id === detail);
      if (!candidate)
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      const edges = await getCandidateEdges(detail);
      return NextResponse.json({ candidate, edges });
    }

    const candidates = await getAllCandidates();
    const weights = await getWeightConfigs();
    return NextResponse.json({ candidates, weights, count: candidates.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
