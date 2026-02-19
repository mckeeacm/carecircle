"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

/* ================= TYPES ================= */

type PatientRow = {
  id: string;
  display_name: string;
  created_at: string;
};

type MemberRow = {
  patient_id: string;
  role: string | null;
  created_at?: string | null;
  patients: PatientRow | null;
};

type UserProfile = {
  user_id: string;
  account_mode: "patient" | "support";
  created_at: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

/* ================= HELPERS ================= */

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "/app";
}

function humanMode(m: "patient" | "support" | null) {
  if (m === "patient") return "Patient";
  if (m === "support") return "Support";
  return "Not set";
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
  if (r === "owner") return "Patient / Guardian";
  if (r === "guardian" || r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
}

/* ================= PAGE ================= */

export default function AppHubPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [mode, setMode] = useState<"patient" | "support" | null>(null);

  // IMPORTANT: match the “new DB”: circles come via patient_members join.
  const [circles, setCircles] = useState<Array<{ patient_id: string; role: string | null; patient: PatientRow }>>([]);

  // Support mode only
  const [newPatientName, setNewPatientName] = useState("");

  // Patient mode only
  const [myDisplayName, setMyDisplayName] = useState("");

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
    setUserEmail(data.user.email ?? null);
    setUserId(data.user.id);
    return data.user;
  }

  async function loadMode() {
    const q = await supabase.from("user_profiles").select("user_id,account_mode,created_at").maybeSingle();
    if (q.error) return setPageError(q.error.message);

    const p = (q.data ?? null) as UserProfile | null;
    setMode(p?.account_mode ?? null);
  }

  async function loadCircles() {
    const user = await requireAuth();
    if (!user) return;

    // New DB pattern: patient_members joins to patients
    const q = await supabase
      .from("patient_members")
      .select("patient_id,role,patients:patients(id,display_name,created_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (q.error) return setPageError(q.error.message);

    const rows = (q.data ?? []) as unknown as MemberRow[];
    const mapped = rows
      .filter((r) => r.patients?.id)
      .map((r) => ({
        patient_id: r.patient_id,
        role: r.role ?? null,
        patient: r.patients as PatientRow,
      }));

    setCircles(mapped);
  }

  async function setAccountMode(next: "patient" | "support") {
    setBusy(true);
    setLoading("Saving account type…");

    const r = await supabase.rpc("set_account_mode", { p_mode: next });
    if (r.error) {
      setBusy(false);
      return setPageError(r.error.message);
    }

    setMode(next);
    await loadCircles();

    setBusy(false);
    setOk("Up to date.");
  }

  async function createPatientAsSupport() {
    const name = newPatientName.trim();
    if (!name) return;

    if (mode !== "support") return setPageError("Only support accounts can create a new patient circle.");

    setBusy(true);
    setLoading("Creating patient circle…");

    // Keep your existing RPC name (you already used this earlier)
    const r = await supabase.rpc("create_patient", { p_display_name: name });
    if (r.error) {
      setBusy(false);
      return setPageError(r.error.message);
    }

    const newId = r.data ? String(r.data) : null;

    setNewPatientName("");
    await loadCircles();

    setBusy(false);
    setOk("Created ✅");

    if (newId) window.location.href = `${base}/patients/${newId}`;
  }

  async function createMyCircle() {
    if (mode !== "patient") return setPageError("This is only for patient accounts.");

    if (circles.length > 0) {
      return setPageError("You already have a circle. If you need another, ask a guardian/supporter to invite you.");
    }

    setBusy(true);
    setLoading("Creating your circle…");

    const display = myDisplayName.trim() || "Me";
    const r = await supabase.rpc("create_my_patient_circle", { p_display_name: display });

    if (r.error) {
      setBusy(false);
      // keep your existing behaviour
      if (String(r.error.message || "").toLowerCase().includes("already_in_circle")) {
        await loadCircles();
        setBusy(false);
        return setOk("Up to date.");
      }
      return setPageError(r.error.message);
    }

    const newId = r.data ? String(r.data) : null;

    setMyDisplayName("");
    await loadCircles();

    setBusy(false);
    setOk("Created ✅");

    if (newId) window.location.href = `${base}/patients/${newId}`;
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const circleCount = circles.length;

  const helperText = useMemo(() => {
    if (mode === "patient") {
      return "Patient accounts usually have one circle (your own). Share entries when you want others to see them.";
    }
    if (mode === "support") {
      return "Support accounts can join multiple circles (patients) and help with meds, journals, and appointments.";
    }
    return "Choose how you’ll use CareCircle.";
  }, [mode]);

  useEffect(() => {
    (async () => {
      setLoading("Loading…");
      const u = await requireAuth();
      if (!u) return;

      await loadMode();
      await loadCircles();

      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Hub</h1>
              <div className="cc-subtle" style={{ marginTop: 6 }}>
                Signed in as <b>{userEmail ?? "…"}</b> • Mode: <b>{humanMode(mode)}</b>
              </div>
              <div className="cc-subtle" style={{ marginTop: 6 }}>
                {helperText}
              </div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn cc-btn-primary" href={`${base}/today`}>
                🧭 Today
              </Link>
              <button className="cc-btn" onClick={signOut} disabled={busy}>
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
        </div>

        {/* Mode picker */}
        {mode === null ? (
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Choose your account type</h2>
            <div className="cc-subtle" style={{ marginTop: 6 }}>
              This only affects what you can <i>create</i>. You can change it later.
            </div>

            <div className="cc-stack" style={{ marginTop: 12 }}>
              <button className="cc-btn cc-btn-primary" onClick={() => setAccountMode("patient")} disabled={busy}>
                I’m the patient
              </button>
              <button className="cc-btn" onClick={() => setAccountMode("support")} disabled={busy}>
                I’m supporting someone (family / carer / clinician)
              </button>
            </div>

            {userId ? (
              <div className="cc-small" style={{ marginTop: 12 }}>
                Account: {userId}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* At-a-glance */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your circles</h2>
              <div className="cc-subtle">
                {circleCount === 0 ? "No circles yet." : `You’re in ${circleCount} circle${circleCount === 1 ? "" : "s"}.`}
              </div>
            </div>

            <button className="cc-btn" onClick={loadCircles} disabled={busy}>
              ↻ Refresh
            </button>
          </div>

          {circles.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-strong">No circles yet.</div>
              <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                {mode === "support"
                  ? "Create a patient circle below, or join one via an invite link."
                  : mode === "patient"
                    ? "If this is your first time, create your circle below (or ask a guardian to set it up and invite you)."
                    : "Choose your account type above to continue."}
              </div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {circles.map((c) => (
                <div key={c.patient_id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">{c.patient.display_name}</div>
                      <div className="cc-small" style={{ marginTop: 4 } as any}>
                        You: <b>{humanRole(c.role)}</b> • Created {fmtDate(c.patient.created_at)}
                      </div>
                    </div>

                    <div className="cc-row">
                      <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${c.patient_id}`}>
                        Open
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${c.patient_id}?tab=meds`}>
                        💊 Meds
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${c.patient_id}?tab=journals`}>
                        📝 Journals
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${c.patient_id}?tab=appointments`}>
                        📅 Appointments
                      </Link>
                      <Link className="cc-btn" href={`${base}/patients/${c.patient_id}/summary`}>
                        🧾 Summary
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Patient-only: create my circle (only if 0 circles) */}
        {mode === "patient" && circles.length === 0 ? (
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Create my circle</h2>
            <div className="cc-subtle" style={{ marginTop: 6 } as any}>
              One-time setup. You can invite family/clinicians from inside your patient page.
            </div>

            <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: "2fr auto" } as any}>
              <input
                className="cc-input"
                value={myDisplayName}
                onChange={(e) => setMyDisplayName(e.target.value)}
                placeholder="Your name (optional, e.g. Alex)"
              />
              <button className="cc-btn cc-btn-secondary" onClick={createMyCircle} disabled={busy}>
                ➕ Create
              </button>
            </div>

            <div className="cc-small" style={{ marginTop: 10 } as any}>
              If a guardian is setting you up, they can create your circle and invite you instead.
            </div>
          </div>
        ) : null}

        {/* Support-only: create patient */}
        {mode === "support" ? (
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Set up a new patient</h2>
            <div className="cc-subtle" style={{ marginTop: 6 } as any}>
              Creates a new circle that you own. You can invite the patient and other supporters afterwards.
            </div>

            <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: "2fr auto" } as any}>
              <input
                className="cc-input"
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                placeholder="Patient name (e.g. Mum)"
              />
              <button
                className="cc-btn cc-btn-secondary"
                onClick={createPatientAsSupport}
                disabled={busy || !newPatientName.trim()}
              >
                ➕ Create
              </button>
            </div>
          </div>
        ) : null}

        {/* Patient-mode info */}
        {mode === "patient" && circles.length > 0 ? (
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Patient account</h2>
            <div className="cc-subtle" style={{ marginTop: 6 } as any}>
              Patient accounts don’t usually create multiple circles. If you need access to another circle, ask the
              guardian/supporter to invite you.
            </div>
            <div className="cc-subtle" style={{ marginTop: 10 } as any}>
              Tip: use <Link href={`${base}/today`}>Today</Link> for a quick glance at meds and appointments.
            </div>
          </div>
        ) : null}

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
