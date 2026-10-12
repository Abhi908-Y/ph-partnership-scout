# ProductHunt Partnership Scout

A ranked outreach list of Product Hunt launches from the last 7 days in project management, HR tech, developer productivity and team communication. Built for Kavya, partnerships lead at an async-standup SaaS.

Each launch shows: product name, founder, one-line description, upvotes, maker replies, days since launch (as a 7-day countdown), and a Gemini-written outreach angle. Kavya can keep notes on every launch, and she gets a Telegram digest when new relevant launches appear.

## Components Map

| # | Component | Technology | Role |
|---|-----------|------------|------|
| 1 | Data source | Product Hunt GraphQL API v2 (`lib/producthunt.ts`) | Pulls the top 20 posts per topic from the last 7 days: upvotes, comments, maker replies, makers, launch date |
| 2 | Scheduler | GitHub Actions cron (`.github/workflows/scan.yml`) | Calls `POST /api/scan` every 30 min. Vercel Hobby cron only allows one run per day, so GitHub is used instead |
| 3 | Scan pipeline | Next.js route `app/api/scan` (requires `CRON_SECRET`), `scanNow` server action (`app/actions.ts`), `lib/scan.ts` | Merges new data, scores, drops launches older than 7 days, sends new launches to Gemini, triggers the alert |
| 4 | Scoring | `lib/scan.ts` | `score = upvotes + 5 × maker replies`. Falls back to `upvotes + total comments` when every maker name is redacted |
| 5 | AI analysis | Gemini Flash via REST (`lib/gemini.ts`) | Classifies into the 4 categories or "Not relevant", rates fit 0–10, writes the one-liner, a 2-sentence summary and the outreach angle (structured JSON output) |
| 6 | Storage | Neon Postgres (`lib/store.ts`, `schema.sql`) | Tables `launches` (JSONB per launch), `notes`, `statuses` (outreach status per launch), `meta` (last scan time). Created automatically on first request |
| 7 | Alerts | Telegram Bot API (`lib/telegram.ts`) | One digest per scan listing new relevant launches with fit ≥ 5/10, with a link to the dashboard |
| 8 | Dashboard | Next.js 16 page (`app/page.tsx` + `app/dashboard.tsx`) | Sketchbook-style ranked list (founder, one-liner, Gemini fit, upvotes, maker replies, 7-day bar), category tabs and search. Clicking a launch opens a pop-up with all founders and their roles, New / Contacted / Replied / Partner status (`PUT /api/status`), stats, Gemini summary, outreach angle + copy button, autosaving notes and links. Sidebar views: This week, Closing soon, Contacted, Replied, Partners, Not relevant. "Scan now" button |
| 9 | Hosting | Vercel | Serves the dashboard and API routes |
| 10 | Founder outreach | Hunter.io + Gemini Flash + Resend (`lib/outreach.ts`, `app/api/outreach`) | In the launch pop-up: finds each founder's work email and LinkedIn (Hunter), drafts a personal email and a 200-character LinkedIn note (Gemini), lets Kavya edit and send the email (Resend) and marks the launch Contacted. LinkedIn has no API for connection requests, so the app copies the note and opens the profile |

Flow: GitHub Actions (or the "Scan now" button) → `/api/scan` → Product Hunt API → score → Gemini Flash → Neon Postgres → Telegram digest → dashboard reads `/api/launches`.

## Setup

1. **Product Hunt token.** Go to https://www.producthunt.com/v2/oauth/applications, create an app (any redirect URL), and copy the *Developer token*.
2. **Gemini key.** Create one at https://aistudio.google.com/apikey.
3. **Telegram.** Message @BotFather and run `/newbot` to get the token. Send your bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
4. **Push to GitHub** and import the repo in Vercel.
5. **Neon.** In Vercel, go to Storage and add **Neon**, then connect it to the project. This sets `DATABASE_URL` automatically. If you created the database at neon.tech instead, copy its pooled connection string into `DATABASE_URL`. The tables are created automatically on first request, or you can run `schema.sql` in Neon's SQL Editor.
6. **Vercel env vars:** `PRODUCTHUNT_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.8-flash`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_URL`, and `CRON_SECRET`. Redeploy after adding them.
7. **GitHub secrets** (Settings, then Secrets and variables, then Actions): `APP_URL` (your Vercel URL, with no trailing slash) and `CRON_SECRET` (the same value as in Vercel). Run the workflow once manually from the Actions tab.
8. Open the dashboard and click **Scan Product Hunt now** to fill it immediately.

Local dev: `cp .env.example .env.local`, fill it in, then run `npm install && npm run dev`.

## Founder outreach (optional)

Add these to `.env.local` and Vercel to turn it on. Without them the dashboard still lists founders with LinkedIn search links and drafts LinkedIn notes.

- `HUNTER_API_KEY`: from https://hunter.io/api-keys. One Email Finder lookup per founder, only when you click "Find emails & LinkedIn" (no credit is used when nothing is found).
- `RESEND_API_KEY`: from https://resend.com/api-keys.
- `OUTREACH_TEST_TO`: **test mode**. Every email goes to this address instead of the founder, marked with who it would have reached. Use your Resend account's email, because Resend's test sender (`onboarding@resend.dev`) only delivers there.
- For real sending: verify a domain in Resend, set `OUTREACH_FROM="Kavya <kavya@yourcompany.com>"`, and remove `OUTREACH_TEST_TO`. Commercial email rules (CAN-SPAM, GDPR) apply: send one-to-one, be honest about who you are, and honour opt-outs.

Safeguards: the server only sends to an email Hunter found for that launch's founders, at most once per founder unless you click "Email again", and at most 25 emails a day. Hunter's opt-out list (HTTP 451) is respected.

## Notes and limits

- **Founder names.** Product Hunt's API redacts some maker names (`[REDACTED]`). Redacted names are hidden; if every maker on a launch is redacted, the dashboard shows "see Product Hunt page" and that launch is scored with total comments instead of maker replies.
- **Maker replies** come from Product Hunt's `makerReplies` field (comments written by the makers).
- **Topic slugs** live in `lib/config.ts` (verified against the API; Product Hunt has no `project-management` topic, so `task-management` is used). Override with `PH_TOPICS`. Each topic costs ~100 of Product Hunt's 6,250 rate-limit points per 15 minutes.
- **Kavya's product description** used in prompts can be changed with `MY_PRODUCT_DESCRIPTION`.
- Each scan analyzes at most 80 new launches (about 25 s per 40), to stay within the 120 s function budget. Any remaining launches are picked up on the next scan.
