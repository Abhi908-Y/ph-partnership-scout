# ProductHunt Partnership Scout — project context for Claude Code

## What this is
Exam project (MESA Cohort C4, Case 4). Kavya leads partnerships at an async-standup B2B SaaS. The app finds Product Hunt launches from the last 7 days in four categories (Project management, HR tech, Developer productivity, Team communication), ranks them, and gives her an outreach list. She must contact founders within 7 days of launch.

## Hard rules (from the exam brief)
- All AI tasks use **Gemini Flash** (`GEMINI_MODEL`, default `gemini-3.8-flash`). Never use the Claude/Anthropic API in the app.
- Must use **live data** (Product Hunt API) and work at submission time.
- Deploy on **Vercel**. Submission = public URL + GitHub repo + Components Map (`components_map.png`).

## Stack
- Next.js 16 App Router (React 19), TypeScript, plain CSS (`app/globals.css`), no Tailwind.
- Storage: **Neon Postgres** via `@neondatabase/serverless` (`lib/store.ts`). Tables auto-created on first request; `schema.sql` mirrors them.
- Scheduler: GitHub Actions (`.github/workflows/scan.yml`) POSTs `/api/scan` every 30 min with `Authorization: Bearer $CRON_SECRET`; the route returns 401 without it. The dashboard "Scan now" button uses the `scanNow` server action (`app/actions.ts`), throttled to one scan per 3 min. (Vercel Hobby cron is once/day, so we don't use it.)
- Alerts: Telegram Bot API (`lib/telegram.ts`), one digest per scan.

## Flow
`/api/scan` → `lib/scan.ts`: fetch PH (`lib/producthunt.ts`) → merge with Neon → score → drop launches older than 7 days → Gemini analysis (`lib/gemini.ts`, max 80 per scan, batches of 8, 4 in parallel) → Telegram digest (fit ≥ 5 only) → save.
Dashboard `app/dashboard.tsx` (client, wrapped by `app/page.tsx`; sketchbook theme in `app/globals.css`, Inter via next/font) reads `/api/launches`, saves notes via `PUT /api/notes` and outreach status via `PUT /api/status`.

## Scoring
`score = votes + 5 × makerComments`, where makerComments is Product Hunt's `makerReplies` field (one cheap query per topic, no comment fetching). If PH redacts every maker name (`[REDACTED]`, id 0), makerComments is null, the founder shows as "see Product Hunt page", and the score falls back to `votes + commentsCount` with `scoreBasis: "all"`.

## Known risks to verify early
- PH redacts some maker names (verified Oct 2026: mixed per post). Handled.
- Topic slugs in `lib/config.ts` were verified against the API on 2026-10-12. PH rate limit is 6,250 complexity points / 15 min, ~100 per topic query.
- Gemini default `gemini-3.8-flash` (GA Sep 2026), verified working.

## Env vars
See `.env.example`: PRODUCTHUNT_TOKEN, GEMINI_API_KEY, GEMINI_MODEL, DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, APP_URL, CRON_SECRET.
Outreach (optional): HUNTER_API_KEY, RESEND_API_KEY, OUTREACH_TEST_TO (test mode: all email goes there), OUTREACH_FROM, OUTREACH_SENDER_NAME, MY_COMPANY_NAME.

## Outreach
`lib/outreach.ts` + `POST /api/outreach` (actions find | draft | send). Founder contacts, drafts and the sent log live in the Neon `contacts` table (JSONB per launch). Product Hunt's `website` is a producthunt.com/r redirect; `resolveDomain` follows it for Hunter. Titles come from `lib/roles.ts`. LinkedIn requests are copy-note-and-open only (no API).

## Commands
`npm install`, `npm run dev`, `npm run build`. Always run `npm run build` before committing; it type-checks.
