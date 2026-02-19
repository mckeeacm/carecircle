"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

function humanRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role || "Circle member";
}

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(iso));
}

type TodayPatientCard = {
  patient_id: string;
  display_name: string;
  role: string;
  meds_active: number;
  meds_taken_today: number;
  next_appt_at: string | null;
};

type TodayOverview = {
  circles: number;
  upcoming_appts: number;
  meds_taken_today: number;
  meds_expected_today: number;
  patients: TodayPatientCard[];
};

export default function TodayPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app/app";
    return appBaseFromPathname(window.location.pathname) || "/app/app";
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<TodayOverview | null>(null);

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    return data.user;
  }

  async function load() {
    setError(null);
    const user = await requireAuth();
    if (!user) return;

    setLoading("Loading Today…");

    const r = await supabase.rpc("today_overview");
    if (r.error) return setPageError(r.error.message);

    setOverview(r.data as TodayOverview);
    setOk("Up to date.");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = overview ?? { circles: 0, upcoming_appts: 0, meds_taken_today: 0, meds_expected_today: 0, patients: [] };

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Today</h1>
              <div className="cc-subtle">At-a-glance dashboard for your circles.</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/account`}>
                ⚙️ Account
              </Link>

              <button
                className="cc-btn"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
              >
                🚪 Sign out
              </button>
            </div>
          </div>

          {/* Status */}
          {status.kind !== "idle" && (
            <div
              className={[
                "cc-status",
                status.kind === "ok"
                  ? "cc-status-ok"
                  : status.kind === "loading"
                    ? "cc-status-loading"
                    : status.kind === "error"
                      ? "cc-status-error"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 } as any}
            >
              <div>
                {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}

          {/* Compact summary row */}
          <div className="cc-panel" style={{ marginTop: 12 } as any}>
            <div className="cc-row-between" style={{ gap: 10 } as any}>
              <span className="cc-pill">Circles: <b>{totals.circles}</b></span>
              <span className="cc-pill">With upcoming appt: <b>{totals.upcoming_appts}</b></span>
              <span className="cc-pill">Meds today: <b>{totals.meds_taken_today}/{totals.meds_expected_today}</b></span>

              <div style={{ flex: 1 } as any} />

              <button className="cc-btn" onClick={load}>
                ↻ Refresh
              </button>
            </div>

            <div className="cc-small" style={{ marginTop: 10 } as any}>
              Tip: patient cards are compact — tap Open for full dashboard.
            </div>
          </div>
        </div>

        {/* Patient cards (compact, minimal scrolling) */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your patients</h2>
              <div className="cc-subtle">Most important info first — without opening each circle.</div>
            </div>
            <button className="cc-btn" onClick={load}>↻ Refresh</button>
          </div>

          {!overview || overview.patients.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-strong">No patients yet.</div>
              <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                You’ll see circles here once you’re added as a member.
              </div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {overview.patients.map((p) => (
                <div key={p.patient_id} className="cc-panel-soft">
                  <div className="cc-row-between" style={{ gap: 12 } as any}>
                    <div style={{ minWidth: 0 } as any}>
                      <div className="cc-strong" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as any}>
                        {p.display_name}
                      </div>
                      <div className="cc-small">You: <b>{humanRole(p.role)}</b></div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end", gap: 8 } as any}>
                      <span className="cc-pill">Meds: <b>{p.meds_taken_today}/{p.meds_active}</b></span>
                      <span className="cc-pill">Next appt: <b>{fmtWhen(p.next_appt_at)}</b></span>

                      <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${p.patient_id}`}>Open</Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=meds`}>💊</Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=journals`}>📝</Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=appointments`}>📅</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
