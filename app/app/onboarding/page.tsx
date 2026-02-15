"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type WhoAmI = {
  uid: string | null;
  email?: string | null;
  account_mode?: string | null;
};

type CircleRow = {
  patient_id: string;
  patient_name?: string | null;
  role?: string | null;
};

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

const TOUR_STEPS = [
  {
    key: "today",
    title: "Today",
    body: "Your home screen: quick view of meds, appointments, and recent updates.",
  },
  {
    key: "profile",
    title: "Care profile",
    body: "Add allergies, triggers, calming methods, and key notes so everyone supports consistently.",
  },
  {
    key: "journals",
    title: "Journals",
    body: "Patient journal is private by default. The circle journal is shared. Patient can selectively share entries.",
  },
  {
    key: "permissions",
    title: "Permissions",
    body: "Only the patient/legal guardian can change what each person can see or do.",
  },
  {
    key: "summary",
    title: "Clinician summary",
    body: "A clean view for clinicians: diagnoses, meds, and entries marked for summary — with an audit trail.",
  },
];

export default function OnboardingPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [authedUid, setAuthedUid] = useState<string | null>(null);
  const [whoami, setWhoami] = useState<WhoAmI | null>(null);

  // Single patient first run
  const [circles, setCircles] = useState<CircleRow[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>("");

  // Mode selection
  const [mode, setMode] = useState<"patient" | "legal_guardian">("patient");

  // Tour
  const [tourOn, setTourOn] = useState(true);
  const [tourStep, setTourStep] = useState(0);

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
    setAuthedUid(data.user.id);
    return data.user;
  }

  async function loadWhoami() {
    const r = await supabase.rpc("whoami");
    if (r.error) return setPageError(r.error.message);

    const val: any = r.data;
    const w: WhoAmI = {
      uid: val?.uid ?? val?.user_id ?? null,
      email: val?.email ?? null,
      account_mode: val?.account_mode ?? val?.mode ?? null,
    };
    setWhoami(w);
  }

  async function loadMyCircles() {
    const r = await supabase.rpc("my_circles");
    if (r.error) return setPageError(r.error.message);

    const rows = (r.data ?? []) as any[];
    const mapped: CircleRow[] = rows.map((x) => ({
      patient_id: x.patient_id ?? x.id ?? x.pid,
      patient_name: x.patient_name ?? x.display_name ?? x.name ?? null,
      role: x.role ?? null,
    }));

    setCircles(mapped);

    // single patient first: auto-select if exactly one
    if (mapped.length === 1) {
      setPatientId(mapped[0].patient_id);
      setPatientName(mapped[0].patient_name ?? "");
    }
  }

  async function setAccountMode(nextMode: "patient" | "legal_guardian") {
    setLoading("Saving your account mode…");
    const r = await supabase.rpc("set_account_mode", { p_mode: nextMode });
    if (r.error) return setPageError(r.error.message);
    setMode(nextMode);
    await loadWhoami();
    setOk("Account mode saved ✅");
  }

  async function createMyCircle() {
    const user = await requireAuth();
    if (!user) return;

    const name = patientName.trim();
    if (!name) return setPageError("Enter the patient’s name.");

    setLoading("Creating your CareCircle…");

    const r = await supabase.rpc("create_my_patient_circle", { p_display_name: name });
    if (r.error) return setPageError(r.error.message);

    const pid =
      typeof r.data === "string"
        ? r.data
        : (r.data?.patient_id ?? r.data?.id ?? null);

    if (pid) {
      setPatientId(pid);

      const seed = await supabase.rpc("permissions_seed_defaults", { pid });
      if (seed.error) return setPageError(seed.error.message);

      // audit (writes to public.audit_events)
      await supabase.rpc("log_audit_event", {
        p_patient_id: pid,
        p_action: "create",
        p_resource: "onboarding",
        p_meta: { mode },
      });
    }

    await loadMyCircles();
    setOk("Circle created + defaults applied ✅");
  }

  function nextTour() {
    setTourStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));
  }
  function prevTour() {
    setTourStep((s) => Math.max(s - 1, 0));
  }

  useEffect(() => {
    (async () => {
      const user = await requireAuth();
      if (!user) return;

      setLoading("Preparing your setup…");
      await loadWhoami();
      await loadMyCircles();
      setOk("Ready.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCircle = circles.length > 0;
  const canContinue = !!patientId;

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">Welcome</div>
              <h1 className="cc-h1">Let’s set up your CareCircle</h1>
              <div className="cc-subtle" style={{ marginTop: 6 }}>
                First-time setup for patient / legal guardian — then we’ll give you a quick tour.
              </div>

              <div className="cc-row" style={{ marginTop: 10 }}>
                <span className="cc-pill cc-pill-primary">
                  Signed in: <b>{whoami?.email ?? authedUid ?? "—"}</b>
                </span>
                {whoami?.account_mode ? <span className="cc-pill">Mode: {whoami.account_mode}</span> : null}
              </div>
            </div>

            <div className="cc-row">
              <button className="cc-btn" onClick={() => window.location.reload()}>
                Refresh
              </button>

              {canContinue ? (
                <Link className="cc-btn cc-btn-primary" href={`${base}/today`}>
                  Go to Today →
                </Link>
              ) : null}
            </div>
          </div>

          {/* Status */}
          {status.kind !== "idle" ? (
            <div
              className={[
                "cc-status",
                status.kind === "error"
                  ? "cc-status-error"
                  : status.kind === "ok"
                    ? "cc-status-ok"
                    : status.kind === "loading"
                      ? "cc-status-loading"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 }}
            >
              <div>
                {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
                {status.msg}
              </div>

              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" }}>
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Step 1 */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">1) Choose your setup mode</h2>
          <div className="cc-subtle">
            This controls what you can manage. Only patient/legal guardian can edit permissions.
          </div>

          <div className="cc-row" style={{ marginTop: 12 }}>
            <button
              className={["cc-btn", mode === "patient" ? "cc-btn-primary" : ""].join(" ")}
              onClick={() => setAccountMode("patient")}
            >
              🧑 Patient
            </button>

            <button
              className={["cc-btn", mode === "legal_guardian" ? "cc-btn-primary" : ""].join(" ")}
              onClick={() => setAccountMode("legal_guardian")}
            >
              🛡️ Legal guardian
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">2) Create your first patient</h2>
          <div className="cc-subtle">
            Single patient for now. Later we can support multiple wards per guardian.
          </div>

          {!hasCircle ? (
            <div className="cc-panel" style={{ marginTop: 12 }}>
              <div className="cc-field">
                <div className="cc-label">Patient display name</div>
                <input
                  className="cc-input"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. Amina Khan"
                />
              </div>

              <div className="cc-row" style={{ marginTop: 10 }}>
                <button className="cc-btn cc-btn-primary" onClick={createMyCircle} disabled={!patientName.trim()}>
                  Create CareCircle
                </button>
              </div>

              <div className="cc-small" style={{ marginTop: 10 }}>
                This will: create the patient + add you as owner + seed default permissions.
              </div>
            </div>
          ) : (
            <div className="cc-panel" style={{ marginTop: 12 }}>
              <div className="cc-strong">You already have {circles.length} circle(s)</div>

              <div className="cc-stack" style={{ marginTop: 10 }}>
                {circles.map((c) => {
                  const active = patientId === c.patient_id;
                  return (
                    <button
                      key={c.patient_id}
                      className={["cc-btn", active ? "cc-btn-secondary" : ""].join(" ")}
                      onClick={() => {
                        setPatientId(c.patient_id);
                        setPatientName(c.patient_name ?? "");
                        setOk("Selected ✅");
                      }}
                    >
                      {active ? "✅ " : ""}
                      {c.patient_name ?? c.patient_id} — {c.role ?? "member"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Step 3 */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">3) Quick tour</h2>
              <div className="cc-subtle">A simple walkthrough of how the app works.</div>
            </div>

            <label className="cc-check">
              <input type="checkbox" checked={tourOn} onChange={(e) => setTourOn(e.target.checked)} />
              Show tour
            </label>
          </div>

          {tourOn ? (
            <div className="cc-panel-soft" style={{ marginTop: 12 }}>
              <div className="cc-kicker">
                Step {tourStep + 1} of {TOUR_STEPS.length}
              </div>

              <div className="cc-strong" style={{ fontSize: 16 }}>
                {TOUR_STEPS[tourStep].title}
              </div>

              <div className="cc-subtle" style={{ marginTop: 6 }}>
                {TOUR_STEPS[tourStep].body}
              </div>

              <div className="cc-row" style={{ marginTop: 12 }}>
                <button className="cc-btn" onClick={prevTour} disabled={tourStep === 0}>
                  Back
                </button>

                <button className="cc-btn cc-btn-primary" onClick={nextTour} disabled={tourStep === TOUR_STEPS.length - 1}>
                  Next
                </button>

                {patientId ? (
                  <>
                    <Link className="cc-btn" href={`${base}/patients/${patientId}?tab=overview`}>
                      Open patient
                    </Link>
                    <Link className="cc-btn" href={`${base}/patients/${patientId}/permissions`}>
                      Permissions
                    </Link>
                    <Link className="cc-btn" href={`${base}/patients/${patientId}/summary`}>
                      Clinician summary
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="cc-panel" style={{ marginTop: 12 }}>
              <div className="cc-subtle" style={{ margin: 0 }}>
                Tour hidden. You can turn it back on anytime.
              </div>
            </div>
          )}
        </div>

        {/* Finish */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Finish</h2>
          <div className="cc-subtle">Once you’ve created (or selected) a patient, you can start using the app.</div>

          <div className="cc-row" style={{ marginTop: 12 }}>
            {canContinue ? (
              <Link className="cc-btn cc-btn-primary" href={`${base}/today`}>
                Go to Today →
              </Link>
            ) : (
              <button className="cc-btn" disabled>
                Go to Today →
              </button>
            )}

            {patientId ? (
              <Link className="cc-btn" href={`${base}/patients/${patientId}?tab=overview`}>
                Open patient →
              </Link>
            ) : null}
          </div>

          {!canContinue ? (
            <div className="cc-small" style={{ marginTop: 10 }}>
              Create/select a patient first to continue.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
