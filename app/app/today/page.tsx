"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type PatientRow = {
  id: string;
  display_name: string;
};

type MemberRow = {
  patient_id: string;
  role: string;
  patients: PatientRow | null;
};

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

type TourStep = {
  id: string;
  anchorId: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
};

const TOUR_STORAGE_KEY = "cc_tour_done_today_v1";

export default function TodayPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);

  const [patients, setPatients] = useState<Array<{ patient_id: string; role: string; patient: PatientRow }>>([]);
  const [newPatientName, setNewPatientName] = useState("");

  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  // ---- Tour query params
  const [tourOn, setTourOn] = useState(false);
  const [tourPid, setTourPid] = useState<string | null>(null);

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
    setAuthedUserId(data.user.id);
    return data.user;
  }

  async function loadMyPatients() {
    setLoading("Loading your CareCircles…");

    const user = await requireAuth();
    if (!user) return;

    const q = await supabase
      .from("patient_members")
      .select("patient_id,role,patients:patients(id,display_name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (q.error) return setPageError(q.error.message);

    const rows = (q.data ?? []) as unknown as MemberRow[];
    const mapped = rows
      .filter((r) => r.patients?.id)
      .map((r) => ({
        patient_id: r.patient_id,
        role: r.role,
        patient: r.patients as PatientRow,
      }));

    setPatients(mapped);

    // If tour is running but pid wasn't provided, auto-pick if single circle
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const pid = sp.get("pid");
      if (!pid && mapped.length === 1) {
        setTourPid(mapped[0].patient_id);
      }
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
    await loadMyPatients();

    const pid = String(data ?? "");
    if (pid && pid !== "null" && pid !== "undefined") {
      window.location.href = `${base}/patients/${pid}`;
      return;
    }

    setOk("Created ✅");
  }

  // Init tour from URL + localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sp = new URLSearchParams(window.location.search);
    const forceTour = sp.get("tour") === "1";
    const pid = sp.get("pid");
    if (pid) setTourPid(pid);

    const done = window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
    setTourOn(forceTour || !done ? forceTour : false); // only show automatically if forced; otherwise user can start elsewhere
    if (forceTour) setTourOn(true);
  }, []);

  useEffect(() => {
    loadMyPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tourSteps: TourStep[] = useMemo(() => {
    const hasPatients = patients.length > 0;

    return [
      {
        id: "welcome",
        anchorId: "tour-today-header",
        title: "Welcome to Today",
        body: "This is your hub: jump into a patient, then meds/journals/appointments in one tap.",
        placement: "bottom",
      },
      {
        id: "patients",
        anchorId: "tour-patients-card",
        title: "Your patients",
        body: "Each patient has their own circle. Open one to see the full dashboard.",
        placement: "bottom",
      },
      {
        id: "quick-actions",
        anchorId: hasPatients ? "tour-first-patient-actions" : "tour-create-card",
        title: hasPatients ? "Quick actions" : "Create your first patient",
        body: hasPatients
          ? "These shortcuts take you straight to Meds, Journals, or Appointments."
          : "If you're the patient or legal guardian, create the circle here.",
        placement: "top",
      },
      {
        id: "account",
        anchorId: "tour-account-btn",
        title: "Account settings",
        body: "Change your account settings, sign out, and (later) manage your onboarding preferences.",
        placement: "bottom",
      },
    ];
  }, [patients]);

  function endTour() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOUR_STORAGE_KEY, "1");

      // remove tour=1 from URL so the page isn't “stuck” in tour mode
      const sp = new URLSearchParams(window.location.search);
      sp.delete("tour");
      const next = `${window.location.pathname}${sp.toString() ? `?${sp}` : ""}`;
      window.history.replaceState(null, "", next);
    }
    setTourOn(false);
  }

  function goNextFromToday() {
    // Next page in the tour: patient overview
    const pid = tourPid ?? (patients.length === 1 ? patients[0].patient_id : null);
    if (!pid) {
      setPageError("Select or create a patient first, then continue the tour.");
      return;
    }
    window.location.href = `${base}/patients/${pid}?tab=overview&tour=1&pid=${pid}`;
  }

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad" id="tour-today-header">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Today</h1>
              <div className="cc-subtle">Quick access to patients, meds, journals, and appointments.</div>
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
        </div>

        {/* My patients */}
        <div className="cc-card cc-card-pad" id="tour-patients-card">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your patients</h2>
              <div className="cc-subtle">Open a patient to view Overview, Meds, Journals, and Appointments.</div>
            </div>
            <button className="cc-btn" onClick={loadMyPatients}>
              ↻ Refresh
            </button>
          </div>

          {patients.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-strong">No patients yet.</div>
              <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                Create your first patient circle below.
              </div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {patients.map((p, idx) => (
                <div key={p.patient_id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">{p.patient.display_name}</div>
                      <div className="cc-small">
                        You: <b>{humanRole(p.role)}</b>
                      </div>
                    </div>

                    <div className="cc-row" id={idx === 0 ? "tour-first-patient-actions" : undefined}>
                      <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${p.patient_id}`}>
                        Open
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=meds`}>
                        💊 Meds
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=journals`}>
                        📝 Journals
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=appointments`}>
                        📅 Appointments
                      </Link>

                      {/* If we’re in tour mode, set pid for “Next” continuity */}
                      {tourOn ? (
                        <button
                          className="cc-btn"
                          onClick={() => {
                            setTourPid(p.patient_id);
                            setOk(`Tour patient selected: ${p.patient.display_name}`);
                          }}
                          title="Use this patient for tour next steps"
                        >
                          🎯 Tour
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
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

        {/* Tour footer controls (only when tour=1) */}
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
            // Don’t auto-mark done here; we only mark done when they end tour explicitly.
            // This keeps it easy to re-run with ?tour=1.
          }}
          onClose={endTour}
        />
      ) : null}
    </main>
  );
}

/* ---------------- Bubble Tour (inline, no import headaches) ---------------- */

function BubbleTour(props: {
  steps: TourStep[];
  onClose: () => void;
  onDone: () => void;
}) {
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

  // bubble positioning
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
      // bottom
      bubbleTop = below;
      bubbleLeft = pos.left;
    }

    // keep on-screen
    const maxLeft = window.scrollX + window.innerWidth - bubbleW - 12;
    const minLeft = window.scrollX + 12;
    bubbleLeft = clamp(bubbleLeft, minLeft, maxLeft);

    const maxTop = window.scrollY + window.innerHeight - 160;
    const minTop = window.scrollY + 12;
    bubbleTop = clamp(bubbleTop, minTop, maxTop);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.25)",
          zIndex: 9998,
        }}
        onClick={props.onClose}
      />

      {/* Highlight */}
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

      {/* Bubble */}
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
