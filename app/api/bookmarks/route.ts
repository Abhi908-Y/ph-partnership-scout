import { NextResponse } from "next/server";
import { getLaunch, setBookmark } from "@/lib/store";

export const dynamic = "force-dynamic";

// PUT { id, saved: true | false } saves or unsaves a launch.
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.saved !== "boolean") {
    return NextResponse.json({ error: "Send { id, saved: true | false } as JSON." }, { status: 400 });
  }
  try {
    if (body.saved && !(await getLaunch(body.id))) {
      return NextResponse.json({ error: "That launch is no longer available." }, { status: 404 });
    }
    await setBookmark(body.id, body.saved);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
