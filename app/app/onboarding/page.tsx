"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string;
};

type PatientRow = {
  id: string;
  display_name: string | null;
  created_by: string;
  created_at: string;
};

type StepId = "circle" | "vault" | "permissions" | "finish";

function safeBool(v: unknown) {
  return v === true;
}

export default function OnboardingPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<CircleMembership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  const [selectedPatientId, setSelectedPatientId] = useState<string>("");

  const [hasVaultShare, setHasVaultShare] = useState<boolean>(false);

  // Create circle form
  const [newCircleName, setNewCircleName] = useState<string>("");

  const currentStep: StepId = useMemo(() => {
    if (!selectedPatientId) return "circle";
    if (!hasVaultShare) return "vault";

    // If controller, we want them to seed/review permissions as part of onboarding.
    const me = memberships.find((m) => m.patient_id === selectedPatientId);
    if (me?.is_controller) return "permissions";

    return "finish";
  }, [selectedPatientId, hasVaultShare, memberships]);

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const me = auth.user;
      if (!me) {
        router.push("/login");
        return;
      }

      setUid(me.id);

      // memberships
      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller, created_at")
        .eq("user_id", me.id)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ms = (mem ?? []) as CircleMembership[];
      setMemberships(ms);

      const ids = Array.from(new Set(ms.map((m) => m.patient_id)));

      if (ids.length === 0) {
        setPatientsById({});
        setSelectedPatientId("");
        setHasVaultShare(false);
        return;
      }

      // patients
      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name, created_by, created_at")
        .in("id", ids);

      if (pErr) throw pErr;

      const map: Record<string, PatientRow> = {};
      (pts ?? []).forEach((p: any) => (map[p.id] = p as PatientRow));
      setPatientsById(map);

      // choose a default circle:
      // prefer controller circle, else first
      if (!selectedPatientId) {
        const controller = ms.find((m) => safeBool(m.is_controller));
        setSelectedPatientId(controller?.patient_id ?? ms[0].patient_id);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function refreshVaultShare(patientId: string, userId: string) {
    setHasVaultShare(false);
    try {
      const { data, error } = await supabase
        .from("patient_vault_shares")
        .select("id")
        .eq("patient_id", patientId)
        .eq("user_id", userId)
        .limit(1);

      if (error) throw error;
      setHasVaultShare((data ?? []).length > 0);
    } catch {
      // Don’t hard-fail onboarding just because we can’t read shares (RLS configs vary).
      // We'll treat it as "not yet" and let the user click through vault-init.
      setHasVaultShare(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!uid || !selectedPatientId) return;
    refreshVaultShare(selectedPatientId, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selectedPatientId]);

  async function createCircle() {
    if (!uid) return;
    const name = newCircleName.trim();
    if (!name) return setMsg("Please enter a circle name.");

    setBusy("create-circle");
    setMsg(null);

    try {
      const pid = crypto.randomUUID();
      const now = new Date().toISOString();

      // 1) patients
      const { error: pErr } = await supabase.from("patients").insert({
        id: pid,
        display_name: name,
        created_by: uid,
        created_at: now,
      });

      if (pErr) throw pErr;

      // 2) patient_members (make creator the controller)
      const { error: mErr } = await supabase.from("patient_members").insert({
        patient_id: pid,
        user_id: uid,
        role: "patient",
        nickname: null,
        is_controller: true,
        created_at: now,
      });

      if (mErr) throw mErr;

      // 3) seed defaults (idempotent)
      const { error: seedErr } = await supabase.rpc("permissions_seed_defaults", { pid });
      if (seedErr) throw seedErr;

      // move forward
      setNewCircleName("");
      await refresh();
      setSelectedPatientId(pid);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_circle");
    } finally {
      setBusy(null);
    }
  }

  async function seedDefaults() {
    if (!selectedPatientId) return;
    setBusy("seed");
    setMsg(null);
    try {
      const { error } = await supabase.rpc("permissions_seed_defaults", { pid: selectedPatientId });
      if (error) throw error;
      // nothing else to refresh here; permissions UI lives elsewhere
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_seed_defaults");
    } finally {
      setBusy(null);
    }
  }

  const selectedMembership = memberships.find((m) => m.patient_id === selectedPatientId) ?? null;
  const selectedPatient = selectedPatientId ? patientsById[selectedPatientId] : null;
  const isController = safeBool(selectedMembership?.is_controller);

  if (loading) {
    return (
      <div style={page}>
        <div style={shell}>
          <Header />
          <div style={card}>
            <div style={{ opacity: 0.8 }}>Loading onboarding…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={shell}>
        <Header />

        {msg && <div style={errorBox}>{msg}</div>}

        <div style={grid}>
          {/* Left: Stepper */}
          <div style={sideCard}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Getting started</div>
            <Step label="Create or select a circle" active={currentStep === "circle"} done={!!selectedPatientId} />
            <Step label="Set up vault access (E2EE)" active={currentStep === "vault"} done={!!selectedPatientId && hasVaultShare} />
            <Step label="Permissions & roles" active={currentStep === "permissions"} done={!!selectedPatientId && hasVaultShare && !isController ? true : false} />
            <Step label="Finish" active={currentStep === "finish"} done={false} />

            {selectedPatientId && (
              <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Selected circle</div>
                <div>{selectedPatient?.display_name ?? selectedPatientId}</div>
                <div style={{ marginTop: 6 }}>
                  Role: <b>{selectedMembership?.role ?? "—"}</b>
                  {isController ? " • controller" : ""}
                </div>
              </div>
            )}
          </div>

          {/* Right: Active step content */}
          <div style={card}>
            {currentStep === "circle" && (
              <>
                <h2 style={h2}>Welcome to CareCircle</h2>
                <p style={p}>
                  Let’s get you set up with a care circle. A circle is the patient context where journals, meds, appointments,
                  and secure notes live.
                </p>

                {memberships.length > 0 ? (
                  <>
                    <div style={sectionTitle}>Select an existing circle</div>
                    <select
                      value={selectedPatientId}
                      onChange={(e) => setSelectedPatientId(e.target.value)}
                      style={select}
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      {memberships.map((m) => (
                        <option key={m.patient_id} value={m.patient_id}>
                          {(patientsById[m.patient_id]?.display_name ?? m.patient_id) +
                            (safeBool(m.is_controller) ? " (controller)" : "")}
                        </option>
                      ))}
                    </select>

                    <div style={{ height: 18 }} />

                    <div style={sectionTitle}>Or create a new circle</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        value={newCircleName}
                        onChange={(e) => setNewCircleName(e.target.value)}
                        placeholder="Circle name (e.g. Aisha’s Care)"
                        style={input}
                      />
                      <button onClick={createCircle} disabled={busy === "create-circle"} style={primaryBtn}>
                        {busy === "create-circle" ? "Creating…" : "Create circle"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={sectionTitle}>Create your first circle</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        value={newCircleName}
                        onChange={(e) => setNewCircleName(e.target.value)}
                        placeholder="Circle name (e.g. Mum’s Care)"
                        style={input}
                      />
                      <button onClick={createCircle} disabled={busy === "create-circle"} style={primaryBtn}>
                        {busy === "create-circle" ? "Creating…" : "Create circle"}
                      </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                      You’ll be set as the controller for this circle.
                    </div>
                  </>
                )}

                {!!selectedPatientId && (
                  <div style={{ marginTop: 18 }}>
                    <button
                      onClick={() => {
                        // advance to vault step
                        // (currentStep is derived, so just keep patient selected)
                        if (!uid) return;
                        refreshVaultShare(selectedPatientId, uid);
                      }}
                      style={secondaryBtn}
                    >
                      Continue
                    </button>
                  </div>
                )}
              </>
            )}

            {currentStep === "vault" && (
              <>
                <h2 style={h2}>Secure vault (end-to-end encryption)</h2>
                <p style={p}>
                  CareCircle stores sensitive content as encrypted jsonb ciphertext. This device needs a vault share to decrypt
                  and create secure content.
                </p>

                <div style={infoBox}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>What happens here?</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    You’ll initialise this device’s E2EE access for the selected circle. After that, journals, DM, sobriety notes,
                    appointment notes and profile sensitive fields can decrypt locally.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button
                    onClick={() => router.push(`/patients/${selectedPatientId}/vault-init`)}
                    style={primaryBtn}
                    disabled={!selectedPatientId}
                  >
                    Initialise vault for this circle
                  </button>

                  <button
                    onClick={() => uid && selectedPatientId && refreshVaultShare(selectedPatientId, uid)}
                    style={secondaryBtn}
                    disabled={!selectedPatientId}
                  >
                    I’ve done it — recheck
                  </button>
                </div>

                {hasVaultShare ? (
                  <div style={{ marginTop: 12, ...okBox }}>
                    Vault share detected for this circle on this account.
                  </div>
                ) : (
                  <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
                    No vault share detected yet (or access is blocked by RLS). After vault init, click “recheck”.
                  </div>
                )}
              </>
            )}

            {currentStep === "permissions" && (
              <>
                <h2 style={h2}>Permissions & roles</h2>
                <p style={p}>
                  As the controller, you can set role defaults and member overrides. We’ll seed clean defaults, then you can
                  fine-tune access.
                </p>

                <div style={infoBox}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Recommended next step</div>
                  <div style={{ fontSize: 13, opacity: 0.9 }}>
                    Seed defaults (safe + idempotent), then open Permissions.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button onClick={seedDefaults} disabled={busy === "seed"} style={primaryBtn}>
                    {busy === "seed" ? "Seeding…" : "Seed defaults"}
                  </button>

                  <button onClick={() => router.push("/account/permissions")} style={secondaryBtn}>
                    Open permissions
                  </button>

                  <button onClick={() => router.push("/hub")} style={secondaryBtn}>
                    Skip for now
                  </button>
                </div>

                <div style={{ marginTop: 14, fontSize: 12, opacity: 0.75 }}>
                  Tip: Roles are applied first, then per-member overrides.
                </div>
              </>
            )}

            {currentStep === "finish" && (
              <>
                <h2 style={h2}>All set</h2>
                <p style={p}>
                  You’re ready to use CareCircle. You can manage journals, meds, appointments, direct messages, and secure notes
                  within each circle.
                </p>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button onClick={() => router.push("/hub")} style={primaryBtn}>
                    Go to Hub
                  </button>
                  <button onClick={() => router.push("/today")} style={secondaryBtn}>
                    Go to Today
                  </button>
                </div>

                {!isController && (
                  <div style={{ marginTop: 14, fontSize: 12, opacity: 0.75 }}>
                    You’re not a controller in this circle, so permissions are managed by the controller.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.65 }}>
          Onboarding is guided but reversible — you can always revisit permissions or vault init later.
        </div>
      </div>
    </div>
  );
}

/* ---------- UI helpers ---------- */

function Header() {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
      <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>Onboarding</div>
    </div>
  );
}

function Step({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "10px 10px",
        borderRadius: 12,
        border: active ? "1px solid #222" : "1px solid #eee",
        background: active ? "#fff" : "#fafafa",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          border: "1px solid #ddd",
          fontWeight: 900,
          background: done ? "#e7ffe7" : "#fff",
        }}
      >
        {done ? "✓" : "•"}
      </div>
      <div style={{ fontWeight: active ? 800 : 650, opacity: done ? 0.9 : 0.85 }}>{label}</div>
    </div>
  );
}

/* ---------- Styles ---------- */

const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #fbfbfb 0%, #f6f6f6 100%)",
};

const shell: React.CSSProperties = {
  maxWidth: 1040,
  margin: "0 auto",
  padding: 18,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "320px 1fr",
  gap: 14,
};

const card: React.CSSProperties = {
  border: "1px solid #eaeaea",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
  boxShadow: "0 6px 24px rgba(0,0,0,0.04)",
};

const sideCard: React.CSSProperties = {
  ...card,
  background: "linear-gradient(180deg, #ffffff 0%, #fbfbfb 100%)",
};

const h2: React.CSSProperties = {
  margin: "0 0 8px 0",
  fontSize: 20,
  fontWeight: 900,
  letterSpacing: -0.2,
};

const p: React.CSSProperties = {
  margin: "0 0 14px 0",
  opacity: 0.85,
  lineHeight: 1.45,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  fontWeight: 800,
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const input: React.CSSProperties = {
  flex: "1 1 260px",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  outline: "none",
};

const select: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: 800,
  cursor: "pointer",
};

const infoBox: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 12,
  background: "#fafafa",
};

const okBox: React.CSSProperties = {
  border: "1px solid #cfe9cf",
  borderRadius: 14,
  padding: 12,
  background: "#e7ffe7",
  fontWeight: 800,
};

const errorBox: React.CSSProperties = {
  border: "1px solid #c33",
  borderRadius: 14,
  padding: 12,
  background: "#fff5f5",
  color: "#900",
  marginBottom: 12,
  fontWeight: 700,
};