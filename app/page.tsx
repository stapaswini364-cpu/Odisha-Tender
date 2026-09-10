"use client";

import { useCallback, useEffect, useState } from "react";

type DashboardStats = {
  totalOrganisations: number;
  newTenders: number;
  notificationsSent: number;
  lastRun: JobRun | null;
};

type Tender = {
  id: string;
  externalKey: string;
  title: string | null;
  referenceNo: string | null;
  type: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  detectedAt: string | null;
  notifiedAt: string | null;
  notificationStatus: string | null;
  organisation: string | null;
};

type JobRun = {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  newItemsFound: number | null;
  notificationsSent: number | null;
  durationMs: number | null;
  errorMessage: string | null;
};

type SystemStatus = {
  database: { status: string; healthy: boolean };
  tenderPortal: { status: string; healthy: boolean };
  telegram: { status: string; healthy: boolean };
  captcha: { status: string; healthy: boolean };
  cron: { status: string; healthy: boolean };
};

type DashboardData = {
  success: boolean;
  stats: DashboardStats;
  latestTenders: Tender[];
  recentJobRuns: JobRun[];
  systemStatus: SystemStatus;
};

const serif = { fontFamily: "'Newsreader', serif" };
const sans = { fontFamily: "'IBM Plex Sans', sans-serif" };
const mono = { fontFamily: "'IBM Plex Mono', monospace" };

const bg = "#0B1120";
const panel = "#121B2E";
const line = "#22314B";
const text = "#E7ECF5";
const muted = "#8593AC";
const amber = "#E0A458";
const teal = "#4FD1AE";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(durationMs: number | null) {
  if (!durationMs) return "—";
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function getRunStatusLabel(status: string | null) {
  if (!status) return "Unknown";
  switch (status.toLowerCase()) {
    case "success": return "Success";
    case "failed": return "Failed";
    case "captcha_failed": return "CAPTCHA failed";
    case "running": return "Running";
    default: return status;
  }
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />;
}

// Extract district/area name from the tender title.
// Portal titles usually contain phrasing like "... in the district of Malkangiri for the year ..."
// so we parse it out here rather than re-scraping or changing the database schema.
function extractDistrict(title: string | null): string {
  if (!title) return "—";
  const match = title.match(/district\s+of\s+([A-Za-z][A-Za-z\s]*?)(?=\s+(?:for|under|during|in|on)\b|[.,]|$)/i);
  return match ? match[1].trim() : "—";
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<"tracker" | "all">("all");
  const [trackedIds, setTrackedIds] = useState<string[]>([]);

  // Search results across the FULL database (not just latest 10)
  const [searchResults, setSearchResults] = useState<Tender[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Debounce the search query by 350ms so we don't hit the API on every keystroke
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(handle);
  }, [query]);

  // Whenever the debounced query changes, search the full database via /api/tenders
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      return;
    }

    let cancelled = false;
    setSearching(true);

    fetch(`/api/tenders?q=${encodeURIComponent(debouncedQuery)}&limit=100`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.success) {
          setSearchResults(data.data);
        }
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Load tracked tender IDs from the database (shared across all devices/browsers)
  const loadTrackedIds = useCallback(async () => {
    try {
      const response = await fetch("/api/tracked", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && Array.isArray(data.tenderIds)) {
        setTrackedIds(data.tenderIds);
      }
    } catch {
      // silently ignore - tracked list is non-critical
    }
  }, []);

  useEffect(() => {
    loadTrackedIds();
  }, [loadTrackedIds]);

  // Toggle tracked state via the database API instead of localStorage
  async function toggleTracked(id: string) {
    setTrackedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

    try {
      const response = await fetch("/api/tracked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenderId: id }),
      });

      if (!response.ok) {
        await loadTrackedIds();
      }
    } catch {
      await loadTrackedIds();
    }
  }

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/dashboard", { method: "GET", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load dashboard");
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  function handleRefresh() {
    setRefreshing(true);
    loadDashboard();
    loadTrackedIds();
  }

  // Base list: search results (full DB) when searching, otherwise latest 10 from dashboard
  const baseTenders = debouncedQuery ? (searchResults ?? []) : (dashboard?.latestTenders ?? []);

  const displayedTenders =
    tab === "tracker" ? baseTenders.filter((t) => trackedIds.includes(t.id)) : baseTenders;

  const lastUpdated = dashboard?.stats.lastRun?.startedAt
    ? formatDate(dashboard.stats.lastRun.startedAt)
    : "—";

  return (
    <main className="min-h-screen" style={{ backgroundColor: bg, color: text, ...sans }}>
      {/* Top bar - masthead with live counters */}
      <header style={{ borderBottom: `2px solid ${amber}`, backgroundColor: bg }}>
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded"
              style={{ border: `1px solid ${amber}`, color: amber }}
            >
              ⌂
            </div>
            <div>
              <h1 className="text-xl leading-tight" style={{ ...serif, fontWeight: 600 }}>
                Odisha Tenders – Automated Telegram Notification Platform
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-8 text-sm">
            <div>
              <p className="text-xs" style={{ color: muted }}>TRACKED</p>
              <p style={{ ...mono, fontSize: "1.1rem" }} className="mt-0.5">{trackedIds.length}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: muted }}>ALL SEEN</p>
              <p style={{ ...mono, fontSize: "1.1rem", color: amber }} className="mt-0.5">{dashboard?.latestTenders.length ?? 0}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: muted }}>NOTIFIED</p>
              <p style={{ ...mono, fontSize: "1.1rem", color: teal }} className="mt-0.5">{dashboard?.stats.notificationsSent ?? 0}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: muted }}>UPDATED</p>
              <p style={{ ...mono, fontSize: "0.85rem" }} className="mt-0.5">{lastUpdated}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded border-l-2 px-4 py-3 text-sm" style={{ borderColor: amber, backgroundColor: panel }}>
            <strong style={{ color: amber }}>Error.</strong> {error}
          </div>
        )}

        {loading ? (
          <p style={{ color: muted }}>Loading console…</p>
        ) : !dashboard ? (
          <div
            className="rounded-lg px-8 py-16 text-center"
            style={{ backgroundColor: "#EFEAE0", color: "#1A2333" }}
          >
            <p className="text-lg font-semibold">Couldn't load the dashboard</p>
            <p className="mt-2 text-sm" style={{ color: "#4A5568" }}>
              {error || "Something went wrong fetching data."}
            </p>
            <button
              onClick={handleRefresh}
              className="mt-4 rounded px-4 py-2 text-sm font-medium"
              style={{ border: "1px solid #8A5A1E", color: "#8A5A1E" }}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* Tabs + search */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <button
                onClick={() => setTab("tracker")}
                className="rounded px-4 py-2 text-sm font-medium transition"
                style={
                  tab === "tracker"
                    ? { backgroundColor: amber, color: bg }
                    : { border: `1px solid ${line}`, color: muted }
                }
              >
                Tracker
              </button>
              <button
                onClick={() => setTab("all")}
                className="rounded px-4 py-2 text-sm font-medium transition"
                style={
                  tab === "all"
                    ? { backgroundColor: amber, color: bg }
                    : { border: `1px solid ${line}`, color: muted }
                }
              >
                All Tenders
              </button>
              <div className="flex-1 min-w-[240px] relative">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search entire database by title, organisation, reference…"
                  className="w-full rounded px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: panel, border: `1px solid ${line}`, color: text }}
                />
                {searching && (
                  <span className="absolute right-3 top-2.5 text-xs" style={{ color: muted }}>
                    Searching…
                  </span>
                )}
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="rounded px-4 py-2 text-sm disabled:opacity-50"
                style={{ border: `1px solid ${amber}`, color: amber }}
              >
                {refreshing ? "Syncing…" : "Sync now"}
              </button>
            </div>

            {debouncedQuery && (
              <p className="mb-3 text-xs" style={{ color: muted }}>
                Searching full database for &ldquo;{debouncedQuery}&rdquo; — {searchResults?.length ?? 0} result(s)
              </p>
            )}

            {/* Tender list */}
            {displayedTenders.length === 0 ? (
              <div
                className="rounded-lg px-8 py-16 text-center"
                style={{ backgroundColor: "#EFEAE0", color: "#1A2333" }}
              >
                <p className="text-lg font-semibold">
                  {debouncedQuery
                    ? "No tenders match your search"
                    : `No tenders ${tab === "tracker" ? "tracked" : "found"} yet`}
                </p>
                <p className="mt-2 text-sm" style={{ color: "#4A5568" }}>
                  {debouncedQuery
                    ? "Try a different title, organisation, or reference number."
                    : "The watcher checks every ~4 minutes per batch across all organisations — this fills in automatically as new tenders come through, with instant Telegram alerts."}
                </p>
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#EFEAE0" }}>
                <table className="w-full text-left text-sm" style={{ color: "#1A2333" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#E4DECF", color: "#4A5568" }}>
                      <th className="px-3 py-3 font-semibold text-xs uppercase tracking-wide"></th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Tender</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Organisation</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">District</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Kind</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Detected</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Notified</th>
                      <th className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedTenders.map((tender) => (
                      <tr key={tender.id} className="border-t" style={{ borderColor: "#D9D2C2" }}>
                        <td className="px-3 py-4">
                          <button
                            onClick={() => toggleTracked(tender.id)}
                            aria-label={trackedIds.includes(tender.id) ? "Untrack" : "Track"}
                            className="text-lg leading-none"
                            style={{ color: trackedIds.includes(tender.id) ? "#8A5A1E" : "#C4BCA9" }}
                          >
                            {trackedIds.includes(tender.id) ? "★" : "☆"}
                          </button>
                        </td>
                        <td className="px-5 py-4 max-w-[340px]">
                          <p className="font-semibold truncate">{tender.title || "Untitled tender"}</p>
                          <p className="text-xs mt-0.5" style={{ ...mono, color: "#6B7280" }}>
                            {tender.referenceNo || "no reference"}
                          </p>
                        </td>
                        <td className="px-5 py-4 max-w-[200px]">
                          <p className="truncate" style={{ color: "#4A5568" }}>{tender.organisation || "Unknown"}</p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs" style={{ color: "#4A5568" }}>{extractDistrict(tender.title)}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className="rounded px-2 py-0.5 text-xs capitalize font-medium"
                            style={{ backgroundColor: "#F5E3C8", color: "#8A5A1E" }}
                          >
                            {tender.type || "tender"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs" style={{ ...mono, color: "#6B7280" }}>
                          {formatDate(tender.detectedAt)}
                        </td>
                        <td className="px-5 py-4">
                          <span className="flex items-center gap-1.5 text-xs capitalize font-medium">
                            <Dot color={tender.notificationStatus === "sent" ? "#2F6F5E" : "#C6621B"} />
                            {tender.notificationStatus || "pending"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {tender.sourceUrl ? (
                            <a
                              href={tender.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded px-3 py-1.5 text-xs font-medium"
                              style={{ border: "1px solid #8A5A1E", color: "#8A5A1E" }}
                            >
                              View on Portal
                            </a>
                          ) : (
                            <span className="text-xs" style={{ color: "#8A8F98" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bottom grid: system status + job runs */}
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <div className="rounded" style={{ border: `1px solid ${line}`, backgroundColor: panel }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: line }}>
                  <h3 className="text-sm font-medium">System status</h3>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: "Database", s: dashboard!.systemStatus.database },
                    { label: "Tender portal", s: dashboard!.systemStatus.tenderPortal },
                    { label: "Telegram", s: dashboard!.systemStatus.telegram },
                    { label: "CAPTCHA service", s: dashboard!.systemStatus.captcha },
                    { label: "Cron scheduler", s: dashboard!.systemStatus.cron },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Dot color={item.s.healthy ? teal : amber} />
                        {item.label}
                      </span>
                      <span style={{ color: muted }} className="text-xs">{item.s.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2 rounded" style={{ border: `1px solid ${line}`, backgroundColor: panel }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: line }}>
                  <h3 className="text-sm font-medium">Recent job runs</h3>
                </div>
                <div className="overflow-x-auto">
                  {dashboard!.recentJobRuns.length === 0 ? (
                    <p className="p-6 text-sm" style={{ color: muted }}>No job runs yet.</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr style={{ color: muted }}>
                          <th className="px-4 py-2 font-normal text-xs">Started</th>
                          <th className="px-4 py-2 font-normal text-xs">Status</th>
                          <th className="px-4 py-2 font-normal text-xs">New</th>
                          <th className="px-4 py-2 font-normal text-xs">Sent</th>
                          <th className="px-4 py-2 font-normal text-xs">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard!.recentJobRuns.map((run) => (
                          <tr key={run.id} className="border-t" style={{ borderColor: line }}>
                            <td className="px-4 py-2 text-xs" style={{ ...mono, color: muted }}>{formatDate(run.startedAt)}</td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1.5 text-xs">
                                <Dot color={run.status === "success" ? teal : amber} />
                                {getRunStatusLabel(run.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs">{run.newItemsFound ?? 0}</td>
                            <td className="px-4 py-2 text-xs">{run.notificationsSent ?? 0}</td>
                            <td className="px-4 py-2 text-xs" style={{ ...mono, color: muted }}>{formatDuration(run.durationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <footer className="mt-10 flex justify-end text-xs" style={{ color: muted }}>
              <p>Source: tendersodisha.gov.in</p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
