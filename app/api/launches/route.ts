import { NextResponse } from "next/server";
import { getLastScan, getLaunches, getNotes } from "@/lib/store";
import { WINDOW_DAYS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [launches, notes, lastScan] = await Promise.all([getLaunches(), getNotes(), getLastScan()]);
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const list = Object.values(launches)
      .filter((l) => Date.parse(l.launchedAt) > cutoff)
      .sort((a, b) => b.score - a.score);
    return NextResponse.json({ launches: list, notes, lastScan });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
