import { NextResponse } from "next/server";
import { draftOutreach, findContacts, outreachConfig, sendOutreachEmail } from "@/lib/outreach";
import { bumpEmailCount, getContacts, getLaunch, getStatuses, saveContacts, saveStatus } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

// GET /api/outreach?id=… → setup flags and any saved contacts for that launch.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Pass ?id=<launch id>.");
  try {
    return NextResponse.json({ config: outreachConfig(), contacts: await getContacts(id) });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

// POST /api/outreach with { action: "find" | "draft" | "send", id, ... }
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") return fail("Send JSON with an action and a launch id.");
  try {
    const launch = await getLaunch(body.id);
    if (!launch) return fail("That launch is no longer in the 7-day list.", 404);

    if (body.action === "find") {
      const contacts = await findContacts(launch);
      await saveContacts(launch.id, contacts);
      return NextResponse.json({ contacts });
    }

    const contacts = await getContacts(launch.id);
    const founder = contacts?.founders.find((f) => f.name === body.name);
    if (!contacts || !founder) return fail("Look up the founders' contacts first.");

    if (body.action === "draft") {
      founder.draft = await draftOutreach(launch, founder);
      await saveContacts(launch.id, contacts);
      return NextResponse.json({ contacts });
    }

    if (body.action === "send") {
      const subject = String(body.subject ?? "").trim();
      const text = String(body.body ?? "").trim();
      if (!subject || !text) return fail("Subject and message can't be empty.");
      if (founder.sentAt && !body.again) return fail(`Already emailed ${founder.name} on ${founder.sentAt.slice(0, 10)}.`, 409);

      const sent = await sendOutreachEmail(founder, subject, text, await bumpEmailCount());
      founder.draft = { ...(founder.draft ?? { linkedinNote: "" }), subject, body: text };
      founder.sentAt = new Date().toISOString();
      founder.sentTo = sent.to;
      founder.sentSubject = subject;
      await saveContacts(launch.id, contacts);
      if (((await getStatuses())[launch.id] ?? "new") === "new") await saveStatus(launch.id, "contacted");
      return NextResponse.json({ contacts, sentTo: sent.to });
    }

    return fail("Unknown action. Use find, draft or send.");
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}
