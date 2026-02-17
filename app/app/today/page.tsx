"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  if (!r) return "Circle member";
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "support_worker") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "professional_support") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "owner") return "Owner";
  if (r === "patient") return "Patient";
  if (r === "guardian" || r === "legal_guardian") return "Legal guardian";
  return role!;
}

function fmtShort(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function isTodayIso(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/* ---------------- Overview row from RPC ---------------- */

type TodayOverviewRow = {
  patient_id: string;
  display_name: string;
  role: string;

  next_appt_at: string | null;
  next_appt_title: string | null;

  meds_due_today: number | null;
  meds_taken_today: number | null;

  last_journal_at: string | null;
  last_journal_type: string | null;
  last_journal_id: string | null;
};

/* ---------------- Tour ---------------- */

type TourStep = {
  id: string;
  anchorId: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
};

const TOUR_STORAGE_KEY = "cc_tour_done_today_v2";

export default function TodayPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<TodayOverviewRow[]>([]);
  const [newPatientName, setNewPatientName] = useState("");

  // UI state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tourOn, setTourOn] = useState(false);
  const [tourPid, setTourPid] = useState<string | null>(null);

  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

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

  async function loadTodayOverview() {
    setError(null);
    setLoading("Loading your CareCircles…");

    const user = await requireAuth();
    if (!user) return;

    // 🚀 Single call
    const q = await supabase.rpc("today_overview");
    if (q.error) return setPageError(q.error.message);

    const data = (q.data ?? []) as TodayOverviewRow[];

    // Sort: next appointment soonest, else by name
    data.sort((a, b) => {
      const at = a.next_appt_at ? new Date(a.next_appt_at).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.next_appt_at ? new Date(b.next_appt_at).getTime() : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    });

    setRows(data);

    // Tour continuity
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const pid = sp.get("pid");
      if (pid) setTourPid(pid);
      if (!pid && data.length === 1) setTourPid(data[0].patient_id);
    }

    setOk("Up to date.");
  }

  async function createPatientCircle() {
    setError(null);
    const name = newPatientName.trim();
    if (!name) return setPageError("Enter a patient display name.");

    const user = await requireAuth();
    if (!user) return;

    setLoading("Creating patient circle…");

    const { data, error } = await supabase.rpc("create_my_patient_circle", { p_display_name: name });
    if (error) return setPageError(error.message);

    setNewPatientName("");
    await loadTodayOverview();

    const pid = String(data ?? "");
    if (pid && pid !== "null" && pid !== "undefined") {
      window.location.href = `${base}/patients/${pid}`;
      return;
    }

    setOk("Created ✅");
  }

  // Init tour mode
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sp = new URLSearchParams(window.location.search);
    const forceTour = sp.get("tour") === "1";
    const pid = sp.get("pid");
    if (pid) setTourPid(pid);

    const done = window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
    setTourOn(forceTour || (!done && forceTour)); // only forced auto-run
    if (forceTour) setTourOn(true);
  }, []);

  useEffect(() => {
    loadTodayOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atAGlance = useMemo(() => {
    // Small header numbers: how many circles, how many have upcoming appts, etc.
    const circles = rows.length;
    const withAppt = rows.filter((r) => !!r.next_appt_at).length;

    let due = 0;
    let taken = 0;
    for (const r of rows) {
      due += Number(r.meds_due_today ?? 0);
      taken += Number(r.meds_taken_today ?? 0);
    }

    return { circles, withAppt, due, taken };
  }, [rows]);

  const tourSteps: TourStep[] = useMemo(() => {
    const hasPatients = rows.length > 0;
    return [
      {
        id: "welcome",
        anchorId: "tour-today-header",
        title: "Today dashboard",
        body: "This page shows the key info for each patient at a glance: next appointment, meds today, and latest journal activity.",
        placement: "bottom",
      },
      {
        id: "overview-strip",
        anchorId: "tour-overview-strip",
        title: "At-a-glance totals",
        body: "Quick totals across all your circles so you don’t have to open each one.",
        placement: "bottom",
      },
      {
        id: "patients",
        anchorId: "tour-patients-card",
        title: "Patient cards",
        body: "Each card is compact. Tap “More” to expand without leaving the page.",
        placement: "top",
      },
      {
        id: "quick-actions",
        anchorId: hasPatients ? "tour-first-patient-actions" : "tour-create-card",
        title: hasPatients ? "Quick actions" : "Create your first patient",
        body: hasPatients
          ? "Jump straight into Overview, Meds, Journals, or Appointments."
          : "If you're the patient or legal guardian, create the circle here.",
        placement: "top",
      },
      {
        id: "account",
        anchorId: "tour-account-btn",
        title: "Account",
        body: "Account settings and sign out live here.",
        placement: "bottom",
      },
    ];
  }, [rows]);

  function endTour() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
      const sp = new URLSearchParams(window.location.search);
      sp.delete("tour");
      const next = `${window.location.pathname}${sp.toString() ? `?${sp}` : ""}`;
      window.history.replaceState(null, "", next);
    }
    setTourOn(false);
  }

  function goNextFromToday() {
    const pid = tourPid ?? (rows.length === 1 ? rows[0].patient_id : null);
    if (!pid) {
      setPageError("Select or create a patient first, then continue the tour.");
      return;
    }
    window.location.href = `${base}/patients/${pid}?tab=overview&tour=1&pid=${pid}`;
  }

  const hasRows = rows.length > 0;

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad" id="tour-today-header">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Today</h1>
              <div className="cc-subtle">At-a-glance dashboard for your circles.</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/account`} id="tour-account-btn">
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
                {status.kind === "error" ? (
                  <span className="cc-status-error-title">Something needs attention: </span>
                ) : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}

          {/* ✅ At-a-glance strip */}
          <div className="cc-panel" style={{ marginTop: 12 } as any} id="tour-overview-strip">
            <div
              className="cc-row"
              style={{
                gap: 10,
                flexWrap: "wrap",
              } as any}
            >
              <span className="cc-pill cc-pill-primary">Circles: {atAGlance.circles}</span>
              <span className="cc-pill">With upcoming appt: {atAGlance.withAppt}</span>
              <span className="cc-pill">
                Meds today: {atAGlance.taken}/{atAGlance.due}
              </span>

              <div style={{ flex: 1 } as any} />

              <button className="cc-btn" onClick={loadTodayOverview}>
                ↻ Refresh
              </button>
            </div>

            <div className="cc-small" style={{ marginTop: 8 } as any}>
              Tip: each patient card is compact — tap <b>More</b> to expand.
            </div>
          </div>
        </div>

        {/* Patients */}
        <div className="cc-card cc-card-pad" id="tour-patients-card">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your patients</h2>
              <div className="cc-subtle">Most important info first, without needing to open each circle.</div>
            </div>
          </div>

          {!hasRows ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-strong">No patients yet.</div>
              <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                Create your first patient circle below.
              </div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {rows.map((r, idx) => {
                const isExpanded = !!expanded[r.patient_id];

                const due = Number(r.meds_due_today ?? 0);
                const taken = Number(r.meds_taken_today ?? 0);
                const medsLabel = due === 0 ? "No meds due" : `${taken}/${due} taken`;
                const medsOk = due > 0 && taken >= due;

                const apptLabel = r.next_appt_at
                  ? isTodayIso(r.next_appt_at)
                    ? `Today • ${fmtShort(r.next_appt_at)}`
                    : fmtShort(r.next_appt_at)
                  : "No upcoming appt";

                const journalLabel = r.last_journal_at
                  ? `${r.last_journal_type ?? "journal"} • ${relTime(r.last_journal_at)}`
                  : "No journal activity";

                return (
                  <div key={r.patient_id} className="cc-panel-soft">
                    {/* Top row: name + role + actions */}
                    <div className="cc-row-between">
                      <div style={{ minWidth: 220 } as any}>
                        <div className="cc-strong">{r.display_name}</div>
                        <div className="cc-small">
                          You: <b>{humanRole(r.role)}</b>
                        </div>
                      </div>

                      <div className="cc-row" id={idx === 0 ? "tour-first-patient-actions" : undefined}>
                        <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${r.patient_id}`}>
                          Open
                        </Link>

                        <button
                          className="cc-btn"
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [r.patient_id]: !prev[r.patient_id],
                            }))
                          }
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? "Less" : "More"}
                        </button>

                        {tourOn ? (
                          <button
                            className="cc-btn"
                            onClick={() => {
                              setTourPid(r.patient_id);
                              setOk(`Tour patient selected: ${r.display_name}`);
                            }}
                            title="Use this patient for tour next steps"
                          >
                            🎯 Tour
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* ✅ Compact “at-a-glance” chips */}
                    <div
                      className="cc-row"
                      style={{
                        marginTop: 10,
                        gap: 8,
                        flexWrap: "wrap",
                      } as any}
                    >
                      <span className="cc-pill">
                        📅 {r.next_appt_title ? `${r.next_appt_title} • ` : ""}
                        {apptLabel}
                      </span>

                      <span className={["cc-pill", medsOk ? "cc-pill-primary" : ""].join(" ")}>
                        💊 {medsLabel}
                      </span>

                      <span className="cc-pill">📝 {journalLabel}</span>
                    </div>

                    {/* ✅ Expandable details (still minimal scrolling) */}
                    {isExpanded ? (
                      <div className="cc-panel" style={{ marginTop: 12 } as any}>
                        <div
                          className="cc-row"
                          style={{
                            gap: 8,
                            flexWrap: "wrap",
                          } as any}
                        >
                          <Link className="cc-btn" href={`${base}/patients/${r.patient_id}?tab=meds`}>
                            💊 Meds
                          </Link>
                          <Link className="cc-btn" href={`${base}/patients/${r.patient_id}?tab=journals`}>
                            📝 Journals
                          </Link>
                          <Link className="cc-btn" href={`${base}/patients/${r.patient_id}?tab=appointments`}>
                            📅 Appointments
                          </Link>
                          <Link className="cc-btn" href={`${base}/patients/${r.patient_id}?tab=overview`}>
                            🧭 Overview
                          </Link>
                        </div>

                        <div className="cc-small" style={{ marginTop: 10 } as any}>
                          This expanded section is purely for quick navigation — the card above is the “glance view”.
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create patient */}
        <div className="cc-card cc-card-pad" id="tour-create-card">
          <h2 className="cc-h2">Create a patient circle</h2>
          <div className="cc-subtle" style={{ marginTop: 6 } as any}>
            Only the patient or legal guardian should be the “centre” of the circle.
          </div>

          <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: "2fr auto" } as any}>
            <input
              className="cc-input"
              value={newPatientName}
              onChange={(e) => setNewPatientName(e.target.value)}
              placeholder="Patient display name (e.g. Aisha K.)"
            />
            <button className="cc-btn cc-btn-secondary" onClick={createPatientCircle} disabled={!newPatientName.trim()}>
              ➕ Create
            </button>
          </div>
        </div>

        {/* Tour footer controls */}
        {tourOn ? (
          <div className="cc-card cc-card-pad">
            <div className="cc-row-between">
              <div>
                <div className="cc-strong">Guided tour</div>
                <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                  Next we’ll open a patient and show Overview + Permissions.
                </div>
              </div>

              <div className="cc-row">
                <button className="cc-btn" onClick={endTour}>
                  End tour
                </button>
                <button className="cc-btn cc-btn-primary" onClick={goNextFromToday}>
                  Next →
                </button>
              </div>
            </div>

            <div className="cc-small" style={{ marginTop: 10 } as any}>
              Tip: click 🎯 Tour on a patient card to choose which patient the tour uses.
            </div>
          </div>
        ) : null}

        <div className="cc-spacer-24" />
      </div>

      {/* Bubble Tour overlay */}
      {tourOn ? (
        <BubbleTour
          steps={tourSteps}
          onDone={() => {
            // we only mark done when they explicitly end tour
          }}
          onClose={endTour}
        />
      ) : null}
    </main>
  );
}

/* ---------------- Bubble Tour (inline, no import headaches) ---------------- */

function BubbleTour(props: { steps: TourStep[]; onClose: () => void; onDone: () => void }) {
  const { steps } = props;
  const [i, setI] = useState(0);
  const step = steps[i];

  const [pos, setPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [missingAnchor, setMissingAnchor] = useState(false);

  const rafRef = useRef<number | null>(null);

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function compute() {
    if (!step) return;

    const el = document.getElementById(step.anchorId);
    if (!el) {
      setMissingAnchor(true);
      setPos(null);
      return;
    }

    setMissingAnchor(false);

    const r = el.getBoundingClientRect();
    setPos({
      top: r.top + window.scrollY,
      left: r.left + window.scrollX,
      width: r.width,
      height: r.height,
    });
  }

  useEffect(() => {
    compute();

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };
    const onResize = () => compute();

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.anchorId]);

  if (!step) return null;

  const isLast = i === steps.length - 1;

  const bubbleW = 340;
  const bubblePad = 12;

  let bubbleTop = 20;
  let bubbleLeft = 20;

  if (pos) {
    const placement = step.placement ?? "bottom";

    const above = pos.top - bubblePad;
    const below = pos.top + pos.height + bubblePad;
    const leftOf = pos.left - bubblePad;
    const rightOf = pos.left + pos.width + bubblePad;

    if (placement === "top") {
      bubbleTop = above - 140;
      bubbleLeft = pos.left;
    } else if (placement === "left") {
      bubbleTop = pos.top;
      bubbleLeft = leftOf - bubbleW;
    } else if (placement === "right") {
      bubbleTop = pos.top;
      bubbleLeft = rightOf;
    } else {
      bubbleTop = below;
      bubbleLeft = pos.left;
    }

    const maxLeft = window.scrollX + window.innerWidth - bubbleW - 12;
    const minLeft = window.scrollX + 12;
    bubbleLeft = clamp(bubbleLeft, minLeft, maxLeft);

    const maxTop = window.scrollY + window.innerHeight - 160;
    const minTop = window.scrollY + 12;
    bubbleTop = clamp(bubbleTop, minTop, maxTop);
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.25)",
          zIndex: 9998,
        }}
        onClick={props.onClose}
      />

      {pos ? (
        <div
          style={{
            position: "absolute",
            top: pos.top - 6,
            left: pos.left - 6,
            width: pos.width + 12,
            height: pos.height + 12,
            borderRadius: 14,
            boxShadow: "0 0 0 3px rgba(255,255,255,0.9), 0 12px 40px rgba(0,0,0,0.35)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          top: bubbleTop,
          left: bubbleLeft,
          width: bubbleW,
          zIndex: 10000,
        }}
      >
        <div className="cc-card cc-card-pad" style={{ borderRadius: 18 }}>
          <div className="cc-kicker">
            Tour {i + 1} / {steps.length}
          </div>

          <div className="cc-strong" style={{ fontSize: 16, marginTop: 6 } as any}>
            {step.title}
          </div>

          <div className="cc-subtle" style={{ marginTop: 8, lineHeight: 1.4 } as any}>
            {missingAnchor ? (
              <>
                We couldn’t find <code>{step.anchorId}</code> on this page.
                <div style={{ marginTop: 8 } as any}>
                  Add <code>id="{step.anchorId}"</code> to the element you want to highlight.
                </div>
              </>
            ) : (
              step.body
            )}
          </div>

          <div className="cc-row" style={{ marginTop: 12 } as any}>
            <button className="cc-btn" onClick={props.onClose}>
              Close
            </button>

            <div style={{ flex: 1 } as any} />

            <button className="cc-btn" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
              Back
            </button>

            {!isLast ? (
              <button className="cc-btn cc-btn-primary" onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))}>
                Next
              </button>
            ) : (
              <button
                className="cc-btn cc-btn-primary"
                onClick={() => {
                  props.onDone();
                  props.onClose();
                }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
