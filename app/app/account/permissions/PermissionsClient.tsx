"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PatientRow = { id: string; display_name: string | null };

type FeatureKeyRow = {
  key: string;
  label: string | null;
  description: string | null;
};

type PermGet = {
  roles: string[];
  members: {
    user_id: string;
    role: string | null;
    nickname: string | null;
    is_controller: boolean | null;
    email: string | null;
  }[];
  role_perms: { patient_id: string; role: string; feature_key: string; allowed: boolean }[];
  member_perms: { patient_id: string; user_id: string; feature_key: string; allowed: boolean }[];
};

function truthy(v: unknown): boolean {
  return v === true;
}

export default function PermissionsClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const [msg, setMsg] = useState<string | null>(null);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [features, setFeatures] = useState<FeatureKeyRow[]>([]);
  const [data, setData] = useState<PermGet | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Read pid from querystring (optional)
  useEffect(() => {
    const preset = sp.get("pid");
    if (preset && !patientId) setPatientId(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // Load controller patients
  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setMsg("not_authenticated");
        return;
      }

      const { data: pm, error: pmErr } = await supabase
        .from("patient_members")
        .select("patient_id")
        .eq("user_id", auth.user.id)
        .eq("is_controller", true);

      if (pmErr) {
        setMsg(pmErr.message);
        return;
      }

      const ids = Array.from(new Set((pm ?? []).map((r: any) => r.patient_id as string)));
      if (ids.length === 0) {
        setPatients([]);
        setMsg("You are not a controller for any circles.");
        return;
      }

      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .in("id", ids)
        .order("created_at", { ascending: false });

      if (pErr) {
        setMsg(pErr.message);
        return;
      }

      setPatients((pts ?? []) as PatientRow[]);
      if (!patientId && pts?.[0]?.id) setPatientId(pts[0].id);
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_patients"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load features list
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("feature_keys")
        .select("key, label, description")
        .order("key", { ascending: true });

      if (error) {
        setMsg(error.message);
        return;
      }
      setFeatures((data ?? []) as FeatureKeyRow[]);
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_features"));
  }, [supabase]);

  async function refresh() {
    if (!patientId) return;
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc("permissions_get", { pid: patientId }); // pid is correct
      if (error) throw error;
      setData(data as PermGet);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_permissions");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function roleAllowed(role: string, featureKey: string): boolean {
    const rp = data?.role_perms?.find((r) => r.role === role && r.feature_key === featureKey);
    return rp ? truthy(rp.allowed) : false;
  }

  function memberOverride(memberUid: string, featureKey: string): boolean | null {
    const mp = data?.member_perms?.find((m) => m.user_id === memberUid && m.feature_key === featureKey);
    return mp ? truthy(mp.allowed) : null;
  }

  async function seedDefaults() {
    if (!patientId) return;
    setMsg(null);
    setSavingKey("seed");
    try {
      const { error } = await supabase.rpc("permissions_seed_defaults", { pid: patientId });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_seed_defaults");
    } finally {
      setSavingKey(null);
    }
  }

  async function setRolePerm(role: string, featureKey: string, allowed: boolean) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`role:${role}:${featureKey}`);
    try {
      const { error } = await supabase.rpc("permissions_set_role", {
        pid: patientId,
        p_role: role,
        p_feature_key: featureKey,
        p_allowed: allowed,
      });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_set_role_perm");
    } finally {
      setSavingKey(null);
    }
  }

  async function setMemberOverride(memberUid: string, featureKey: string, allowed: boolean) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`member:${memberUid}:${featureKey}`);
    try {
      const { error } = await supabase.rpc("permissions_set_member", {
        pid: patientId,
        member_uid: memberUid,
        p_feature_key: featureKey,
        p_allowed: allowed,
      });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_set_member_override");
    } finally {
      setSavingKey(null);
    }
  }

  async function clearMemberOverride(memberUid: string, featureKey: string) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`clear:${memberUid}:${featureKey}`);
    try {
      const { error } = await supabase.rpc("permissions_clear_member_override", {
        pid: patientId,
        member_uid: memberUid,
        p_feature_key: featureKey,
      });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_clear_override");
    } finally {
      setSavingKey(null);
    }
  }

  const roles = data?.roles ?? [];
  const members = data?.members ?? [];

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Account • Permissions</h1>
            <div className="cc-subtle">Controller-only management</div>
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
            <Link className="cc-btn" href="/app/account">
              Account
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row">
            <div className="cc-field" style={{ minWidth: 280 }}>
              <div className="cc-label">Circle</div>
              <select className="cc-select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <button className="cc-btn cc-btn-secondary" onClick={seedDefaults} disabled={!patientId || savingKey === "seed"}>
              {savingKey === "seed" ? "Seeding…" : "Seed defaults"}
            </button>

            <button className="cc-btn" onClick={refresh} disabled={!patientId || loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {!patientId ? (
          <div className="cc-card cc-card-pad">Select a circle.</div>
        ) : !data ? (
          <div className="cc-card cc-card-pad">No permissions data.</div>
        ) : (
          <>
            <div className="cc-card cc-card-pad cc-stack">
              <h2 className="cc-h2">Role permissions</h2>
              <div className="cc-table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Feature</th>
                      {roles.map((r) => (
                        <th key={r} style={thStyle}>
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {features.map((f) => (
                      <tr key={f.key}>
                        <td style={tdStyle}>
                          <div className="cc-strong">{f.label ?? f.key}</div>
                          <div className="cc-small cc-subtle">{f.description ?? f.key}</div>
                          <div className="cc-small">key: {f.key}</div>
                        </td>
                        {roles.map((role) => {
                          const allowed = roleAllowed(role, f.key);
                          const busy = savingKey === `role:${role}:${f.key}`;
                          return (
                            <td key={`${role}:${f.key}`} style={tdCenter}>
                              <button
                                className={`cc-btn ${allowed ? "cc-btn-secondary" : ""}`}
                                onClick={() => setRolePerm(role, f.key, !allowed)}
                                disabled={busy}
                              >
                                {busy ? "…" : allowed ? "Allowed" : "Denied"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="cc-card cc-card-pad cc-stack">
              <h2 className="cc-h2">Member overrides</h2>
              <div className="cc-small cc-subtle">
                Overrides apply on top of role permissions. Controllers cannot be overridden (your RPC enforces this).
              </div>

              <div className="cc-table-wrap">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Feature</th>
                      {members.map((m) => (
                        <th key={m.user_id} style={thStyle}>
                          <span className="cc-wrap">{m.nickname ?? m.email ?? m.user_id}</span>
                          {m.is_controller ? " (controller)" : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {features.map((f) => (
                      <tr key={f.key}>
                        <td style={tdStyle}>
                          <div className="cc-strong">{f.label ?? f.key}</div>
                          <div className="cc-small cc-subtle">{f.description ?? f.key}</div>
                          <div className="cc-small">key: {f.key}</div>
                        </td>

                        {members.map((m) => {
                          const ov = memberOverride(m.user_id, f.key);
                          const busySet = savingKey === `member:${m.user_id}:${f.key}`;
                          const busyClear = savingKey === `clear:${m.user_id}:${f.key}`;

                          return (
                            <td key={`${m.user_id}:${f.key}`} style={tdCenter}>
                              {m.is_controller ? (
                                <span className="cc-small">—</span>
                              ) : (
                                <div className="cc-row" style={{ justifyContent: "center" }}>
                                  <button
                                    className={`cc-btn ${ov === true ? "cc-btn-secondary" : ""}`}
                                    onClick={() => setMemberOverride(m.user_id, f.key, true)}
                                    disabled={busySet}
                                  >
                                    {busySet && ov !== true ? "…" : "Allow"}
                                  </button>

                                  <button
                                    className={`cc-btn ${ov === false ? "cc-btn-danger" : ""}`}
                                    onClick={() => setMemberOverride(m.user_id, f.key, false)}
                                    disabled={busySet}
                                  >
                                    {busySet && ov !== false ? "…" : "Deny"}
                                  </button>

                                  <button
                                    className="cc-btn"
                                    onClick={() => clearMemberOverride(m.user_id, f.key)}
                                    disabled={ov === null || busyClear}
                                    style={{ opacity: ov === null ? 0.55 : 1 }}
                                  >
                                    {busyClear ? "…" : "Clear"}
                                  </button>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
  minWidth: 260,
};

const tdCenter: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
  textAlign: "center",
  minWidth: 180,
};