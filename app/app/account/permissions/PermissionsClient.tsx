"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function PermissionsClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const [msg, setMsg] = useState<string | null>(null);

  const [uid, setUid] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [features, setFeatures] = useState<FeatureKeyRow[]>([]);
  const [data, setData] = useState<PermGet | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const bootedRef = useRef(false);

  async function getSessionUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user ?? null;
  }

  // Boot: lock onto auth session reliably (prevents RPC being called as anon)
  useEffect(() => {
    let alive = true;

    const preset = (sp.get("pid") ?? "").trim();
    if (preset && isUuid(preset)) setPatientId((prev) => prev || preset);

    (async () => {
      try {
        setMsg(null);
        const u = await getSessionUser();
        if (!alive) return;

        setUid(u?.id ?? "");
        setEmail(u?.email ?? "");

        bootedRef.current = true;

        if (!u?.id) {
          setMsg("Not signed in (no session). If you’re signed in in another tab, refresh once.");
          return;
        }

        await loadControllerPatients(u.id);
        await loadFeatures();
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "failed_to_boot_permissions");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user;
      setUid(u?.id ?? "");
      setEmail(u?.email ?? "");

      // If we just became signed-in, load the lists
      if (u?.id) {
        loadControllerPatients(u.id).catch(() => {});
        loadFeatures().catch(() => {});
      } else {
        setPatients([]);
        setPatientId("");
        setData(null);
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadControllerPatients(currentUid: string) {
    setMsg(null);

    // Controllers only (your chosen rule)
    const { data: pm, error: pmErr } = await supabase
      .from("patient_members")
      .select("patient_id")
      .eq("user_id", currentUid)
      .eq("is_controller", true);

    if (pmErr) throw pmErr;

    const ids = Array.from(new Set((pm ?? []).map((r: any) => String(r.patient_id)))).filter(isUuid);

    if (ids.length === 0) {
      setPatients([]);
      setData(null);
      setMsg("You are not a controller for any circles.");
      return;
    }

    const { data: pts, error: pErr } = await supabase
      .from("patients")
      .select("id, display_name")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (pErr) throw pErr;

    const rows = (pts ?? []) as PatientRow[];
    setPatients(rows);

    setPatientId((prev) => {
      if (prev && ids.includes(prev)) return prev;
      return rows[0]?.id ?? "";
    });
  }

  async function loadFeatures() {
    const { data, error } = await supabase
      .from("feature_keys")
      .select("key, label, description")
      .order("key", { ascending: true });

    if (error) throw error;
    setFeatures((data ?? []) as FeatureKeyRow[]);
  }

  async function refresh() {
    if (!patientId) return;

    setLoading(true);
    setMsg(null);

    try {
      // Ensure session exists before calling RPC
      const u = await getSessionUser();
      if (!u?.id) {
        setData(null);
        setMsg("Not signed in (no session).");
        return;
      }

      // IMPORTANT: param name is pid (matches function signature)
      const { data, error } = await supabase.rpc("permissions_get", { pid: patientId });
      if (error) throw error;

      setData(data as PermGet);
    } catch (e: any) {
      setData(null);

      // This is the exact symptom you saw:
      // permissions_get raises "Not allowed" if auth.uid() is null or user lacks permissions_manage.
      setMsg(e?.message ?? "failed_to_load_permissions");
    } finally {
      setLoading(false);
    }
  }

  // Refresh when patientId changes (but only after initial boot)
  useEffect(() => {
    if (!bootedRef.current) return;
    if (!patientId) return;
    refresh().catch(() => {});
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
            <div className="cc-subtle cc-wrap">Controller-only management</div>
            {email ? <div className="cc-small cc-subtle cc-wrap">Signed in as: {email}</div> : null}
          </div>
          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {!uid ? (
          <div className="cc-card cc-card-pad">
            <div className="cc-strong">Not signed in</div>
            <div className="cc-subtle">This page needs an authenticated session to call permissions RPCs.</div>
            <div className="cc-spacer-12" />
            <button className="cc-btn" onClick={() => window.location.reload()}>
              Refresh page
            </button>
          </div>
        ) : (
          <>
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
              <div className="cc-card cc-card-pad">
                <div className="cc-strong">No permissions data</div>
                <div className="cc-subtle">
                  If you see <code>Not allowed</code>, it usually means the RPC ran without an auth session (auth.uid() = null)
                  or you don’t currently have <code>permissions_manage</code> for this circle.
                </div>
              </div>
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
                            <th key={r} style={thStyle}>{r}</th>
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