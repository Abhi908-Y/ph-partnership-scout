import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Called by the GitHub Actions scheduler. Requires `Authorization: Bearer $CRON_SECRET`.
// (The dashboard's "Scan now" button uses the scanNow server action instead.)
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set on the server." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runScan({ force: true }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
