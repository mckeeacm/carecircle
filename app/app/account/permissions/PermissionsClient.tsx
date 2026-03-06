"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PatientRow = {
  id: string;
  display_name: string | null;
};

type FeatureKeyRow = {
  key: string;
  label: string | null;
  description: string | null;
};

type MemberRow = {
  patient_id: string;
  user_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string | null;
};

type RolePermRow = {
  patient_id: string;
  role: string;
  feature_key: string;
  allowed: boolean;
  updated_at?: string | null;
};

type MemberPermRow = {
  patient_id: string;
  user_id: string;
  feature_key: string;
  allowed: boolean;
  updated_at?: string | null;
};

type PermissionsGetShape = {
  patient_id: string;
  user_id: string;
  role: string;
  is_controller: boolean;
  role_permissions: Record<string, boolean>;
  member_overrides: Record<string, boolean>;
  effective: Record<string, boolean>;
};

function truthy(v: unknown): boolean {
  return v === true;
}

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export default function PermissionsClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const [msg, setMsg] = useState<string | null>(null);

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [features, setFeatures] = useState<FeatureKeyRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);

  const [rolePerms, setRolePerms] = useState<RolePermRow[]>([]);
  const [memberPerms, setMemberPerms] = useState<MemberPermRow[]>([]);
  const [mePerm, setMePerm] = useState<PermissionsGetShape | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canManage = truthy(mePerm?.effective?.permissions_manage);
  const myUid = mePerm?.user_id ?? "";

  useEffect(() => {
    const preset = sp.get("pid");
    if (preset && isUuid(preset)) setPatientId(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("feature_keys")
          .select("key, label, description")
          .order("key", { ascending: true });

        if (error) throw error;
        setFeatures((data ?? []) as FeatureKeyRow[]);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_feature_keys");
      }
    })();
  }, [supabase]);

  useEffect(() => {
    (async () => {
      setMsg(null);

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const uid = auth.user?.id;
        if (!uid) {
          setPatients([]);
          setMsg("not_authenticated");
          return;
        }

        const { data: myMemberships, error: msErr } = await supabase
          .from("patient_members")
          .select("patient_id")
          .eq("user_id", uid);

        if (msErr) throw msErr;

        const pids = uniq((myMemberships ?? []).map((r: any) => String(r.patient_id))).filter(isUuid);

        if (pids.length === 0) {
          setPatients([]);
          setMsg("You are not a member of any circles.");
          return;
        }

        const allowedPids: string[] = [];

        for (const pid of pids) {
          const { data, error } = await supabase.rpc("permissions_get", { pid });
          if (!error) {
            const shaped = data as PermissionsGetShape;
            if (truthy(shaped?.effective?.permissions_manage)) {
              allowedPids.push(pid);
            }
          }
        }

        if (allowedPids.length === 0) {
          setPatients([]);
          setMsg("You do not currently have permission to manage access in any circles.");
          return;
        }

        const { data: pts, error: ptsErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", allowedPids)
          .order("created_at", { ascending: false });

        if (ptsErr) throw ptsErr;

        const list = (pts ?? []) as PatientRow[];
        setPatients(list);

        if (!patientId && list[0]?.id) setPatientId(list[0].id);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_circles");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function refresh() {
    if (!patientId) return;

    setLoading(true);
    setMsg(null);

    try {
      const { data: perm, error: permErr } = await supabase.rpc("permissions_get", { pid: patientId });
      if (permErr) throw permErr;

      const me = perm as PermissionsGetShape;
      setMePerm(me);

      const { data: mem, error: memErr } = await supabase.rpc("permissions_members_list", { pid: patientId });
      if (memErr) throw memErr;
      setMembers((mem ?? []) as MemberRow[]);

      const { data: rp, error: rpErr } = await supabase
        .from("patient_role_permissions")
        .select("patient_id, role, feature_key, allowed, updated_at")
        .eq("patient_id", patientId)
        .order("role", { ascending: true })
        .order("feature_key", { ascending: true });

      if (rpErr) throw rpErr;
      const roleRows = (rp ?? []) as RolePermRow[];
      setRolePerms(roleRows);

      const { data: mp, error: mpErr } = await supabase
        .from("patient_member_permissions")
        .select("patient_id, user_id, feature_key, allowed, updated_at")
        .eq("patient_id", patientId)
        .order("user_id", { ascending: true })
        .order("feature_key", { ascending: true });

      if (mpErr) throw mpErr;
      setMemberPerms((mp ?? []) as MemberPermRow[]);

      const allRoles = uniq([
        ...roleRows.map((r) => r.role).filter(Boolean),
        ...(mem ?? []).map((m: any) => String(m.role ?? "")).filter(Boolean),
      ]).sort();

      setRoles(allRoles);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_refresh_permissions");
      setMembers([]);
      setRolePerms([]);
      setMemberPerms([]);
      setRoles([]);
      setMePerm(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function roleAllowed(role: string, featureKey: string): boolean {
    const row = rolePerms.find((r) => r.role === role && r.feature_key === featureKey);
    return row ? truthy(row.allowed) : false;
  }

  function memberOverride(userId: string, featureKey: string): boolean | null {
    const row = memberPerms.find((m) => m.user_id === userId && m.feature_key === featureKey);
    return row ? truthy(row.allowed) : null;
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

  async function upsertRolePerm(role: string, featureKey: string, allowed: boolean) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`role:${role}:${featureKey}`);

    try {
      const { error } = await supabase
        .from("patient_role_permissions")
        .upsert(
          {
            patient_id: patientId,
            role,
            feature_key: featureKey,
            allowed,
          },
          { onConflict: "patient_id,role,feature_key" }
        );

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_set_role_perm");
    } finally {
      setSavingKey(null);
    }
  }

  async function upsertMemberOverride(userId: string, featureKey: string, allowed: boolean) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`member:${userId}:${featureKey}:${allowed ? "1" : "0"}`);

    try {
      const { error } = await supabase
        .from("patient_member_permissions")
        .upsert(
          {
            patient_id: patientId,
            user_id: userId,
            feature_key: featureKey,
            allowed,
          },
          { onConflict: "patient_id,user_id,feature_key" }
        );

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_set_member_override");
    } finally {
      setSavingKey(null);
    }
  }

  async function clearMemberOverride(userId: string, featureKey: string) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`clear:${userId}:${featureKey}`);

    try {
      const { error } = await supabase
        .from("patient_member_permissions")
        .delete()
        .eq("patient_id", patientId)
        .eq("user_id", userId)
        .eq("feature_key", featureKey);

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_clear_override");
    } finally {
      setSavingKey(null);
    }
  }

  async function revokeMember(memberUid: string) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`revoke:${memberUid}`);

    try {
      const member = members.find((m) => m.user_id === memberUid);
      if (!member) throw new Error("Member not found.");
      if (member.is_controller) throw new Error("Cannot revoke a controller.");
      if (memberUid === myUid) throw new Error("You cannot revoke yourself.");

      const { error } = await supabase.rpc("permissions_member_revoke", {
        pid: patientId,
        member_uid: memberUid,
      });

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_revoke_member");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Permissions</h1>
            <div className="cc-subtle">Roles, member overrides, and revoking access</div>
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
            <div className="cc-field" style={{ minWidth: 320 }}>
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

          {mePerm ? (
            <div className="cc-row" style={{ flexWrap: "wrap" }}>
              <span className={`cc-pill ${canManage ? "cc-pill-primary" : ""}`}>
                permissions_manage: {canManage ? "true" : "false"}
              </span>
              <span className="cc-pill">role: {mePerm.role}</span>
              <span className="cc-pill">controller: {mePerm.is_controller ? "true" : "false"}</span>
            </div>
          ) : null}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <h2 className="cc-h2">Circle members</h2>
          <div className="cc-small cc-subtle">
            Individual access can be adjusted with overrides below, or removed completely with revoke.
          </div>

          {members.length === 0 ? (
            <div className="cc-small">No members found.</div>
          ) : (
            <div className="cc-table-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Member</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Controller</th>
                    <th style={thStyle}>User ID</th>
                    <th style={thStyle}>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const revokeBusy = savingKey === `revoke:${m.user_id}`;
                    const canRevoke = canManage && !m.is_controller && m.user_id !== myUid;

                    return (
                      <tr key={m.user_id}>
                        <td style={tdStyle}>
                          <div className="cc-strong">{m.nickname ?? "—"}</div>
                          {m.user_id === myUid ? <div className="cc-small cc-subtle">You</div> : null}
                        </td>
                        <td style={tdStyle}>{m.role ?? "—"}</td>
                        <td style={tdStyle}>{m.is_controller ? "true" : "false"}</td>
                        <td style={tdStyle}>
                          <span className="cc-small cc-wrap">{m.user_id}</span>
                        </td>
                        <td style={tdCenter}>
                          {m.is_controller ? (
                            <span className="cc-small">Controller cannot be revoked</span>
                          ) : m.user_id === myUid ? (
                            <span className="cc-small">You cannot revoke yourself</span>
                          ) : (
                            <button
                              className="cc-btn cc-btn-danger"
                              onClick={() => revokeMember(m.user_id)}
                              disabled={!canRevoke || revokeBusy}
                            >
                              {revokeBusy ? "Revoking…" : "Revoke access"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

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
                            onClick={() => upsertRolePerm(role, f.key, !allowed)}
                            disabled={!canManage || busy}
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
            These adjust an individual member without changing the whole role.
          </div>

          <div className="cc-table-wrap">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Feature</th>
                  {members.map((m) => (
                    <th key={m.user_id} style={thStyle}>
                      <span className="cc-wrap">{m.nickname ?? m.user_id}</span>
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
                      const busyAllow = savingKey === `member:${m.user_id}:${f.key}:1`;
                      const busyDeny = savingKey === `member:${m.user_id}:${f.key}:0`;
                      const busyClear = savingKey === `clear:${m.user_id}:${f.key}`;

                      return (
                        <td key={`${m.user_id}:${f.key}`} style={tdCenter}>
                          {m.is_controller ? (
                            <span className="cc-small">—</span>
                          ) : (
                            <div className="cc-row" style={{ justifyContent: "center" }}>
                              <button
                                className={`cc-btn ${ov === true ? "cc-btn-secondary" : ""}`}
                                onClick={() => upsertMemberOverride(m.user_id, f.key, true)}
                                disabled={!canManage || busyAllow}
                              >
                                {busyAllow ? "…" : "Allow"}
                              </button>

                              <button
                                className={`cc-btn ${ov === false ? "cc-btn-danger" : ""}`}
                                onClick={() => upsertMemberOverride(m.user_id, f.key, false)}
                                disabled={!canManage || busyDeny}
                              >
                                {busyDeny ? "…" : "Deny"}
                              </button>

                              <button
                                className="cc-btn"
                                onClick={() => clearMemberOverride(m.user_id, f.key)}
                                disabled={!canManage || ov === null || busyClear}
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
  minWidth: 220,
};

const tdCenter: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
  textAlign: "center",
  minWidth: 220,
};