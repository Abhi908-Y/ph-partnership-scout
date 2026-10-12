import type { Launch } from "./types";
import { WINDOW_DAYS } from "./config";

const MAX_ITEMS = 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendDigest(items: Launch[]): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !items.length) return false;

  const day = (iso: string) => Math.min(WINDOW_DAYS, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) + 1);
  const shown = items.slice(0, MAX_ITEMS);
  const lines = shown.map(
    (l, i) =>
      `${i + 1}. <b>${esc(l.name)}</b> (${esc(String(l.category))}, fit ${l.relevance}/10)\n` +
      `   ${l.votes} upvotes, day ${day(l.launchedAt)} of ${WINDOW_DAYS}\n` +
      `   ${esc(l.oneLiner)}`
  );
  const more = items.length > shown.length ? `\n\n…and ${items.length - shown.length} more on the dashboard.` : "";
  const header = `🚀 ${items.length} new launch${items.length > 1 ? "es" : ""} worth reviewing`;
  const footer = process.env.APP_URL ? `\n\nOpen the dashboard: ${process.env.APP_URL}` : "";

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `${header}\n\n${lines.join("\n\n")}${more}${footer}`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return res.ok;
}
