import { NextResponse } from "next/server";
import { saveStatus } from "@/lib/store";
import { OUTREACH_STATUSES, type OutreachStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !OUTREACH_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `Send { id, status } as JSON, with status one of: ${OUTREACH_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }
  try {
    await saveStatus(body.id, body.status as OutreachStatus);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
