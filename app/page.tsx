import Dashboard from "./dashboard";

// The "Scan now" server action runs under this page, so give it the same time budget as /api/scan.
export const maxDuration = 120;

export default function Page() {
  return <Dashboard />;
}
