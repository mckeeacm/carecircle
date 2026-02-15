"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

type MemberRow = { user_id: string; role: string };
type PatientRow = { id: string; display_name: string };

type FeatureKey = { key: string; label: string; description: string | null };

type RoleDefault = {
  patient_id: string;
  role: string;
  feature_key: string;
  allowed: boolean;
};

type MemberOverride = {
  patient_id: string;
  user_id: string;
  feature_key: string;
  allowed: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

const ROLE_ORDER = ["patient", "guardian", "legal_guardian", "owner", "family", "carer", "professional", "clinician"];

export default function PermissionsPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [authedUserId, setAuthedUserId] = useState<string | null>(null);

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [myRole, setMyRole] = useState<string | null>(null);
  const isController = useMemo(() => {
    const r = (myRole ?? "").toLowerCase();
    return ["patient", "guardian", "legal_guardian", "owner"].includes(r);
  }, [myRole]);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [features, setFeatures] = useState<FeatureKey[]>([]);

  const [roleDefaults, setRoleDefaults] = useState<RoleDefault[]>([]);
  const [memberOverrides, setMemberOverrides] = useState<MemberOverride[]>([]);

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
    // simplest: fetch patients where I'm a member via patient_members join
    const user = await requireAuth();
    if (!user) return;

    const q = await supabase
      .from("patient_members")
      .select("patient_id, patients:patients(id,display_name)")
      .eq("user_id", user.id);

    if (q.error) return setPageError(q.error.message);

    const list: PatientRow[] = (q.data ?? [])
      .map((r: any) => r.patients)
      .filter(Boolean);

    setPatients(list);
    if (!patientId && list.length) setPatientId(list[0].id);
  }

  async function loadMyRole(pid: string) {
    const user = await requireAuth();
    if (!user) return;

    const q = await supabase.from("patient_members").select("role").eq("patient_id", pid).eq("user_id", user.id).maybeSingle();
    if (q.error) return setPageError(q.error.message);
    setMyRole((q.data as any)?.role ?? null);
  }

  async function loadMembers(pid: string) {
    const q = await supabase.from("patient_members").select("user_id,role").eq("patient_id", pid);
    if (q.error) return setPageError(q.error.message);
    setMembers((q.data ?? []) as MemberRow[]);
  }

  async function loadFeatures() {
    const q = await supabase.from("feature_keys").select("key,label,description").order("label", { ascending: true });
    if (q.error) return setPageError(q.error.message);
    setFeatures((q.data ?? []) as FeatureKey[]);
  }

  async function loadDefaults(pid: string) {
    const q = await supabase
      .from("patient_role_feature_defaults")
      .select("patient_id,role,feature_key,allowed")
      .eq("patient_id", pid);

    if (q.error) return setPageError(q.error.message);
    setRoleDefaults((q.data ?? []) as RoleDefault[]);
  }

  async function loadOverrides(pid: string) {
    const q = await supabase
      .from("patient_member_feature_overrides")
      .select("patient_id,user_id,feature_key,allowed")
      .eq("patient_id", pid);

    if (q.error) return setPageError(q.error.message);
    setMemberOverrides((q.data ?? []) as MemberOverride[]);
  }

  function effectiveAllowed(userId: string, role: string, featureKey: string) {
    const r = (role ?? "").toLowerCase();

    // Controllers always allowed (by policy + your design)
    if (["patient", "guardian", "legal_guardian", "owner"].includes(r)) return true;

    const override = memberOverrides.find((o) => o.user_id === userId && o.feature_key === featureKey);
    if (override) return !!override.allowed;

    const def = roleDefaults.find((d) => d.role.toLowerCase() === r && d.feature_key === featureKey);
    if (def) return !!def.allowed;

    // default deny if no template row
    return false;
  }

  async function toggleRoleDefault(role: string, featureKey: string, next: boolean) {
    if (!patientId) return;
    if (!isController) return setPageError("Only the patient/legal guardian can change permissions.");

    setLoading("Saving role default…");

    const up = await supabase
      .from("patient_role_feature_defaults")
      .upsert(
        { patient_id: patientId, role, feature_key: featureKey, allowed: next, created_by: authedUserId },
        { onConflict: "patient_id,role,feature_key" }
      );

    if (up.error) return setPageError(up.error.message);
    await loadDefaults(patientId);
    setOk("Saved ✅");
  }

  async function toggleMemberOverride(userId: string, featureKey: string, next: boolean) {
    if (!patientId) return;
    if (!isController) return setPageError("Only the patient/legal guardian can change permissions.");

    setLoading("Saving member override…");

    const up = await supabase
      .from("patient_member_feature_overrides")
      .upsert(
        { patient_id: patientId, user_id: userId, feature_key: featureKey, allowed: next, updated_by: authedUserId },
        { onConflict: "patient_id,user_id,feature_key" }
      );

    if (up.error) return setPageError(up.error.message);
    await loadOverrides(patientId);
    setOk("Saved ✅");
  }

  useEffect(() => {
    (async () => {
      setLoading("Loading…");
      await loadMyPatients();
      await loadFeatures();
      setOk("Ready.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!patientId) return;
      setLoading("Loading circle permissions…");
      await loadMyRole(patientId);
      await loadMembers(patientId);
      await loadDefaults(patientId);
      await loadOverrides(patientId);
      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const rolesInCircle = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) set.add((m.role ?? "").toLowerCase());
    const list = Array.from(set);
    list.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
    return list.length ? list : ["family", "carer", "professional"];
  }, [members]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">Account</div>
              <h1 className="cc-h1">Permissions</h1>
              <p className="cc-subtle">
                The patient / legal guardian controls access. Defaults by role, with per-person overrides.
              </p>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href="/app/today">← Back to Today</Link>
              <Link className="cc-btn cc-btn-primary" href="/app/messages">💬 Messages</Link>
            </div>
          </div>

          <div className="cc-spacer-12" />

          <div className="cc-row">
            <div className="cc-field" style={{ minWidth: 280 }}>
              <div className="cc-label">Patient</div>
              <select className="cc-select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </div>

            <span className={`cc-pill ${isController ? "cc-pill-primary" : ""}`}>
              You: {myRole ? myRole : "member"} {isController ? "(controller)" : "(read-only)"}
            </span>
          </div>
        </div>

        {status.kind !== "idle" && (
          <div className={`cc-status cc-card ${status.kind === "ok" ? "cc-status-ok" : status.kind === "error" ? "cc-status-error" : "cc-status-loading"}`}>
            <div>
              {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
              {status.msg}
            </div>
            {error ? <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div> : null}
          </div>
        )}

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Role defaults</h2>
          <p className="cc-subtle">These defaults apply unless a person has an override.</p>

          <div className="cc-stack">
            {rolesInCircle.map((role) => (
              <div key={role} className="cc-panel">
                <div className="cc-row-between">
                  <div className="cc-strong">{role}</div>
                  {!isController ? <span className="cc-small">Read-only</span> : null}
                </div>

                <div className="cc-spacer-12" />

                <div className="cc-stack">
                  {features.map((f) => {
                    const current = roleDefaults.find((d) => d.role.toLowerCase() === role && d.feature_key === f.key)?.allowed ?? false;
                    return (
                      <label key={f.key} className="cc-check">
                        <input
                          type="checkbox"
                          checked={current}
                          disabled={!isController}
                          onChange={(e) => toggleRoleDefault(role, f.key, e.target.checked)}
                        />
                        <span>
                          <span className="cc-strong">{f.label}</span>
                          {f.description ? <span className="cc-small"> — {f.description}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Per-person overrides</h2>
          <p className="cc-subtle">Overrides win over role defaults.</p>

          {members.length === 0 ? (
            <p className="cc-subtle">No members found.</p>
          ) : (
            <div className="cc-stack">
              {members.map((m) => (
                <div key={m.user_id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">{m.role}</div>
                      <div className="cc-small">{m.user_id}</div>
                    </div>
                    {!isController ? <span className="cc-small">Read-only</span> : null}
                  </div>

                  <div className="cc-spacer-12" />

                  <div className="cc-stack">
                    {features.map((f) => {
                      const hasOverride = memberOverrides.some((o) => o.user_id === m.user_id && o.feature_key === f.key);
                      const eff = effectiveAllowed(m.user_id, m.role, f.key);
                      return (
                        <label key={f.key} className="cc-check">
                          <input
                            type="checkbox"
                            checked={eff}
                            disabled={!isController}
                            onChange={(e) => toggleMemberOverride(m.user_id, f.key, e.target.checked)}
                          />
                          <span>
                            <span className="cc-strong">{f.label}</span>{" "}
                            <span className="cc-small">{hasOverride ? "(override)" : "(default)"}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
