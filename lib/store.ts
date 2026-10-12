import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { normalizeRubric, type Rubric } from "./rubric";
import type { ContactsRecord, Launch, OutreachStatus } from "./types";

let client: NeonQueryFunction<false, false> | null = null;
let ready: Promise<void> | null = null;

function db() {
  if (client) return client;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("Storage is not configured. Set DATABASE_URL to your Neon connection string.");
  client = neon(url);
  return client;
}

// Creates the tables on first use, so no manual migration step is needed.
async function sql(text: string, params: unknown[] = []) {
  const q = db();
  ready ??= (async () => {
    await q.query(`CREATE TABLE IF NOT EXISTS launches (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, launched_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q.query(`CREATE TABLE IF NOT EXISTS notes (
      launch_id TEXT PRIMARY KEY, note TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q.query(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await q.query(`CREATE TABLE IF NOT EXISTS contacts (
      launch_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q.query(`CREATE TABLE IF NOT EXISTS statuses (
      launch_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`);
  })().catch((err) => { ready = null; throw err; });
  await ready;
  return (await q.query(text, params)) as Record<string, unknown>[];
}

export async function getLaunches(): Promise<Record<string, Launch>> {
  const rows = await sql(`SELECT data FROM launches`);
  return Object.fromEntries(rows.map((r) => [(r.data as Launch).id, r.data as Launch]));
}

export async function getLaunch(id: string): Promise<Launch | null> {
  const rows = await sql(`SELECT data FROM launches WHERE id = $1`, [id]);
  return rows[0] ? (rows[0].data as Launch) : null;
}

export async function saveLaunches(items: Launch[]) {
  if (!items.length) return;
  await sql(
    `INSERT INTO launches (id, data, launched_at)
     SELECT x->>'id', x, (x->>'launchedAt')::timestamptz FROM jsonb_array_elements($1::jsonb) AS x
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, launched_at = EXCLUDED.launched_at, updated_at = now()`,
    [JSON.stringify(items)]
  );
}

export async function removeLaunches(ids: string[]) {
  if (ids.length) await sql(`DELETE FROM launches WHERE id = ANY($1::text[])`, [ids]);
}

export async function getNotes(): Promise<Record<string, string>> {
  const rows = await sql(`SELECT launch_id, note FROM notes`);
  return Object.fromEntries(rows.map((r) => [String(r.launch_id), String(r.note)]));
}

export async function saveNote(id: string, note: string) {
  if (note.trim()) {
    await sql(
      `INSERT INTO notes (launch_id, note) VALUES ($1, $2)
       ON CONFLICT (launch_id) DO UPDATE SET note = EXCLUDED.note, updated_at = now()`,
      [id, note]
    );
  } else {
    await sql(`DELETE FROM notes WHERE launch_id = $1`, [id]);
  }
}

export async function getStatuses(): Promise<Record<string, OutreachStatus>> {
  const rows = await sql(`SELECT launch_id, status FROM statuses`);
  return Object.fromEntries(rows.map((r) => [String(r.launch_id), r.status as OutreachStatus]));
}

/** "new" is the default, so it is stored as the absence of a row. */
export async function saveStatus(id: string, status: OutreachStatus) {
  if (status === "new") {
    await sql(`DELETE FROM statuses WHERE launch_id = $1`, [id]);
  } else {
    await sql(
      `INSERT INTO statuses (launch_id, status) VALUES ($1, $2)
       ON CONFLICT (launch_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [id, status]
    );
  }
}

export async function getContacts(id: string): Promise<ContactsRecord | null> {
  const rows = await sql(`SELECT data FROM contacts WHERE launch_id = $1`, [id]);
  return rows[0] ? (rows[0].data as ContactsRecord) : null;
}

export async function saveContacts(id: string, data: ContactsRecord) {
  await sql(
    `INSERT INTO contacts (launch_id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (launch_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [id, JSON.stringify(data)]
  );
}

/** Adds one to today's sent-email counter and returns the new total (UTC day). */
export async function bumpEmailCount(): Promise<number> {
  const key = `emailsSent:${new Date().toISOString().slice(0, 10)}`;
  const rows = await sql(
    `INSERT INTO meta (key, value) VALUES ($1, '1')
     ON CONFLICT (key) DO UPDATE SET value = (meta.value::int + 1)::text
     RETURNING value`,
    [key]
  );
  return Number(rows[0]?.value ?? 1);
}

export async function getRubric(): Promise<Rubric> {
  const rows = await sql(`SELECT value FROM meta WHERE key = 'rubric'`);
  let stored: unknown = null;
  try {
    stored = rows[0] ? JSON.parse(String(rows[0].value)) : null;
  } catch {
    // Corrupt value: fall back to defaults.
  }
  return normalizeRubric(stored);
}

export async function saveRubric(r: Rubric) {
  await sql(
    `INSERT INTO meta (key, value) VALUES ('rubric', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(r)]
  );
}

export async function getLastScan(): Promise<string | null> {
  const rows = await sql(`SELECT value FROM meta WHERE key = 'lastScan'`);
  return rows[0] ? String(rows[0].value) : null;
}

export async function setLastScan(iso: string) {
  await sql(
    `INSERT INTO meta (key, value) VALUES ('lastScan', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [iso]
  );
}
