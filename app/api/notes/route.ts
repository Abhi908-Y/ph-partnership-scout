import { NextResponse } from "next/server";
import { saveNote } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.note !== "string") {
    return NextResponse.json({ error: "Send { id, note } as JSON." }, { status: 400 });
  }
  try {
    await saveNote(body.id, body.note.slice(0, 5000));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
