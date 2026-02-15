"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type PatientRow = {
  id: string;
  display_name: string;
  created_at: string;
};

type UserProfile = {
  user_id: string;
  account_mode: "patient" | "support";
  created_at: string;
};

export default function AppHubPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [mode, setMode] = useState<"patient" | "support" | null>(null);
  const [patients, setPatients] = useState<PatientRow[]>([]);

  // Support mode only: create circle for someone else
  const [newPatientName, setNewPatientName] = useState("");

  // Patient mode only: create my own circle (one-time)
  const [myDisplayName, setMyDisplayName] = useState("");

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
    setError(null);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id,account_mode,created_at")
      .maybeSingle();

    if (error) return setError(error.message);

    const p = (data ?? null) as UserProfile | null;
    setMode(p?.account_mode ?? null);
  }

  async function loadPatients() {
    setError(null);

    // RLS should ensure this returns only circles the user is a member of.
    const { data, error } = await supabase
      .from("patients")
      .select("id,display_name,created_at")
      .order("created_at", { ascending: false });

    if (error) return setError(error.message);
    setPatients((data ?? []) as PatientRow[]);
  }

  async function setAccountMode(next: "patient" | "support") {
    setError(null);
    setBusy(true);

    const { error } = await supabase.rpc("set_account_mode", { p_mode: next });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }

    setMode(next);
    await loadPatients();
    setBusy(false);
  }

  async function createPatientAsSupport() {
    setError(null);
    const name = newPatientName.trim();
    if (!name) return;

    if (mode !== "support") {
      setError("Only support accounts can create a new patient circle.");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("create_patient", { p_display_name: name });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }

    setNewPatientName("");
    await loadPatients();

    const newId = data ? String(data) : null;
    if (newId) window.location.href = `/app/patients/${newId}`;
    setBusy(false);
  }

  async function createMyCircle() {
    setError(null);

    if (mode !== "patient") {
      setError("This is only for patient accounts.");
      return;
    }

    if (patients.length > 0) {
      setError("You already have a circle. If you need another, ask a guardian/supporter to invite you.");
      return;
    }

    setBusy(true);
    const display = myDisplayName.trim() || "Me";
    const { data, error } = await supabase.rpc("create_my_patient_circle", { p_display_name: display });

    if (error) {
      setBusy(false);
      if (String(error.message || "").toLowerCase().includes("already_in_circle")) {
        await loadPatients();
        setBusy(false);
        return;
      }
      return setError(error.message);
    }

    const newId = data ? String(data) : null;
    setMyDisplayName("");
    await loadPatients();

    if (newId) window.location.href = `/app/patients/${newId}`;
    setBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const patientCount = patients.length;

  const helperText = useMemo(() => {
    if (mode === "patient") {
      return "Patient accounts usually have one circle (your own). Share entries to the circle when you want others to see them.";
    }
    if (mode === "support") {
      return "Support accounts can join multiple circles (patients) and post updates to the shared timeline.";
    }
    return "Choose how you’ll use CareCircle.";
  }, [mode]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const u = await requireAuth();
      if (!u) return;

      await loadMode();
      await loadPatients();

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>CareCircle</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 14 }}>
            Signed in as {userEmail ?? "…"}
          </p>
          <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 13 }}>{helperText}</p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "end" }}>
          <a
            href="/app/today"
            style={{
              display: "inline-block",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              textDecoration: "none",
            }}
          >
            Today
          </a>

          <button onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p style={{ color: "crimson", marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</p>
      )}

      {/* Mode picker */}
      {mode === null && !loading && (
        <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>How are you using CareCircle?</h2>
          <p style={{ marginTop: -6, opacity: 0.75, fontSize: 13 }}>
            This controls what you can create. You can change it later.
          </p>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <button
              onClick={() => setAccountMode("patient")}
              disabled={busy}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
            >
              I’m the patient
            </button>

            <button
              onClick={() => setAccountMode("support")}
              disabled={busy}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
            >
              I’m supporting someone (family / carer / clinician)
            </button>
          </div>
        </section>
      )}

      {/* Your circles */}
      <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Your circles</h2>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
              {patientCount === 0 ? "No circles yet." : `You’re in ${patientCount} circle${patientCount === 1 ? "" : "s"}.`}
            </p>
          </div>

          <button onClick={loadPatients} disabled={busy}>
            Refresh
          </button>
        </div>

        {patients.length === 0 ? (
          <p style={{ marginTop: 12, opacity: 0.7 }}>
            {mode === "support"
              ? "Create a patient circle below, or join one via an invite link."
              : mode === "patient"
              ? "If this is your first time, create your circle below, or ask a guardian to set it up and invite you."
              : "Choose your account type above to continue."}
          </p>
        ) : (
          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            {patients.map((p) => (
              <li key={p.id} style={{ marginBottom: 10 }}>
                <a href={`/app/patients/${p.id}`} style={{ textDecoration: "underline", fontWeight: 700 }}>
                  {p.display_name}
                </a>
                <div style={{ marginTop: 4, opacity: 0.65, fontSize: 12 }}>
                  Created {new Date(p.created_at).toLocaleDateString()} •{" "}
                  <a href={`/app/patients/${p.id}?tab=meds`} style={{ textDecoration: "underline" }}>
                    meds
                  </a>{" "}
                  •{" "}
                  <a href={`/app/patients/${p.id}?tab=appointments`} style={{ textDecoration: "underline" }}>
                    appointments
                  </a>{" "}
                  •{" "}
                  <a href={`/app/patients/${p.id}?tab=journals`} style={{ textDecoration: "underline" }}>
                    journals
                  </a>{" "}
                  •{" "}
                  <a href={`/app/patients/${p.id}/summary`} style={{ textDecoration: "underline" }}>
                    summary
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Patient-only: create my circle (only if 0 circles) */}
      {mode === "patient" && patients.length === 0 && (
        <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Create my circle</h2>
          <p style={{ marginTop: -6, opacity: 0.75, fontSize: 13 }}>
            This creates your own circle (one-time). You can invite family/clinicians from inside your patient page.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={myDisplayName}
              onChange={(e) => setMyDisplayName(e.target.value)}
              placeholder="Your name (optional, e.g. Alex)"
              style={{ flex: 1, padding: 10 }}
            />
            <button onClick={createMyCircle} disabled={busy}>
              Create
            </button>
          </div>

          <p style={{ margin: "10px 0 0", opacity: 0.7, fontSize: 12 }}>
            If a guardian is setting you up, they can create your circle and invite you instead.
          </p>
        </section>
      )}

      {/* Support-only: create patient */}
      {mode === "support" && (
        <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Set up a new patient (guardian setup)</h2>
          <p style={{ marginTop: -6, opacity: 0.75, fontSize: 13 }}>
            Creates a new circle that you own. You can invite the patient and other supporters afterwards.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newPatientName}
              onChange={(e) => setNewPatientName(e.target.value)}
              placeholder="Patient name (e.g. Mum)"
              style={{ flex: 1, padding: 10 }}
            />
            <button onClick={createPatientAsSupport} disabled={busy || !newPatientName.trim()}>
              Create
            </button>
          </div>
        </section>
      )}

      {/* Patient-mode info */}
      {mode === "patient" && patients.length > 0 && (
        <section style={{ marginTop: 18, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Patient account</h2>
          <p style={{ marginTop: -6, opacity: 0.75, fontSize: 13 }}>
            Patient accounts don’t create multiple circles. If you need access to another circle, ask the guardian/supporter to invite you.
          </p>
          <p style={{ margin: "10px 0 0", opacity: 0.75, fontSize: 13 }}>
            Tip: use <a href="/app/today" style={{ textDecoration: "underline" }}>Today</a> for a quick glance at meds and appointments.
          </p>
        </section>
      )}

      <footer style={{ marginTop: 24, opacity: 0.6, fontSize: 12 }}>
        User ID: {userId ?? "…"}
      </footer>
    </main>
  );
}
