import { NextResponse } from "next/server";
import { normalizeRubric } from "@/lib/rubric";
import { getRubric, saveRubric } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ rubric: await getRubric() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Saves the rubric from the dashboard. Changing the fit bands bumps the version, so the next
// scans have Gemini re-score existing launches; weight and threshold changes apply immediately.
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the rubric as JSON." }, { status: 400 });
  try {
    const current = await getRubric();
    const next = normalizeRubric({ ...body, version: current.version });
    const bandsChanged = next.fitBands.some((b, i) => b.description !== current.fitBands[i]?.description);
    const saved = { ...next, version: current.version + (bandsChanged ? 1 : 0), updatedAt: new Date().toISOString() };
    await saveRubric(saved);
    return NextResponse.json({ rubric: saved, rescoring: bandsChanged });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
