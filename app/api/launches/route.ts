import { NextResponse } from "next/server";
import { getBookmarks, getLastScan, getLaunches, getNotes, getRubric, getStatuses } from "@/lib/store";
import { WINDOW_DAYS } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [launches, notes, statuses, lastScan, rubric, bookmarks] = await Promise.all([
      getLaunches(),
      getNotes(),
      getStatuses(),
      getLastScan(),
      getRubric(),
      getBookmarks(),
    ]);
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
    const saved = new Set(bookmarks);
    // Launches inside the 7-day window, plus bookmarked ones whose window has closed (kept for the Saved tab).
    const list = Object.values(launches)
      .filter((l) => Date.parse(l.launchedAt) > cutoff || saved.has(l.id))
      .sort((a, b) => b.score - a.score);
    return NextResponse.json({ launches: list, notes, statuses, lastScan, rubric, bookmarks });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
