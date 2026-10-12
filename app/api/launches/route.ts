import { NextResponse } from "next/server";
import { getLastScan, getLaunches, getNotes, getStatuses } from "@/lib/store";
import { WINDOW_DAYS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [launches, notes, statuses, lastScan] = await Promise.all([
      getLaunches(),
      getNotes(),
      getStatuses(),
      getLastScan(),
    ]);
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const list = Object.values(launches)
      .filter((l) => Date.parse(l.launchedAt) > cutoff)
      .sort((a, b) => b.score - a.score);
    return NextResponse.json({ launches: list, notes, statuses, lastScan });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
