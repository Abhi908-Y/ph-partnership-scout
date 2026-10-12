"use server";

import { runScan, type ScanResult } from "@/lib/scan";

// The dashboard's "Scan now" button. Runs server-side so CRON_SECRET never reaches the browser;
// unlike the cron call it is throttled, so repeated clicks can't burn Product Hunt or Gemini quota.
export async function scanNow(): Promise<ScanResult | { error: string }> {
  try {
    return await runScan({ force: false });
  } catch (err) {
    return { error: (err as Error).message };
  }
}
