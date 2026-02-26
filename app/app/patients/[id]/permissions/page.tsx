"use client";

import { useEffect, useMemo, useState } from "react";
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
  role_perms: {
    patient_id: string;
    role: string;
    feature_key: string;
    allowed: boolean;
  }[];
  member_perms: {
    patient_id: string;
    user_id: string;
    feature_key: string;
    allowed: boolean;
  }[];
};

function truthy(v: unknown): boolean {
  return v === true;
}

export default function AccountPermissionsPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [msg, setMsg] = useState<string | null>(null);

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [features, setFeatures] = useState<FeatureKeyRow[]>([]);
  const [data, setData] = useState<PermGet | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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
        setMsg("You are not a controller for any patients.");
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
      const { data, error } = await supabase.rpc("permissions_get", { pid: patientId });
      if (error) throw error;

      // Supabase may return json as object already
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

  // Helpers
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

  async function saveMemberRoleNickname(memberUid: string, role: string, nickname: string) {
    if (!patientId) return;
    setMsg(null);
    setSavingKey(`membermeta:${memberUid}`);
    try {
      const { error } = await supabase.rpc("patient_members_set_role_nickname", {
        pid: patientId,
        member_uid: memberUid,
        p_role: role,
        p_nickname: nickname,
      });
      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_update_member");
    } finally {
      setSavingKey(null);
    }
  }

  const roles = data?.roles ?? [];
  const members = data?.members ?? [];

  return (
    <div style={{ padding: 16 }}>
      <h2>Account • Permissions</h2>

      {msg && (
        <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Patient
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)} style={{ padding: 6 }}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name ?? p.id}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={seedDefaults}
          disabled={!patientId || savingKey === "seed"}
          style={{ padding: "8px 10px", borderRadius: 10 }}
        >
          {savingKey === "seed" ? "Seeding…" : "Seed defaults"}
        </button>

        <button
          onClick={refresh}
          disabled={!patientId || loading}
          style={{ padding: "8px 10px", borderRadius: 10 }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!patientId ? (
        <div style={{ opacity: 0.7 }}>Select a patient.</div>
      ) : !data ? (
        <div style={{ opacity: 0.7 }}>No permissions data.</div>
      ) : (
        <>
          {/* Members */}
          <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <h3 style={{ marginTop: 0 }}>Circle members</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {members.map((m) => (
                <MemberEditor
                  key={m.user_id}
                  member={m}
                  roles={roles}
                  saving={savingKey === `membermeta:${m.user_id}`}
                  onSave={(role, nick) => saveMemberRoleNickname(m.user_id, role, nick)}
                />
              ))}
            </div>
          </section>

          {/* Role permissions matrix */}
          <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <h3 style={{ marginTop: 0 }}>Role permissions</h3>
            <div style={{ overflowX: "auto" }}>
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
                        <div style={{ fontWeight: 600 }}>{f.label ?? f.key}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{f.description ?? f.key}</div>
                        <div style={{ fontSize: 12, opacity: 0.65 }}>key: {f.key}</div>
                      </td>
                      {roles.map((role) => {
                        const allowed = roleAllowed(role, f.key);
                        const busy = savingKey === `role:${role}:${f.key}`;
                        return (
                          <td key={`${role}:${f.key}`} style={tdStyleCenter}>
                            <button
                              onClick={() => setRolePerm(role, f.key, !allowed)}
                              disabled={busy}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 10,
                                border: "1px solid #ddd",
                                background: allowed ? "#e7ffe7" : "#fff",
                              }}
                              title="Toggle role permission"
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
          </section>

          {/* Member overrides matrix */}
          <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Member overrides</h3>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
              Overrides apply on top of role permissions. Controllers cannot be overridden (your RPC enforces this).
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Feature</th>
                    {members.map((m) => (
                      <th key={m.user_id} style={thStyle}>
                        {m.nickname ?? m.email ?? m.user_id}
                        {m.is_controller ? " (controller)" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {features.map((f) => (
                    <tr key={f.key}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{f.label ?? f.key}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{f.description ?? f.key}</div>
                        <div style={{ fontSize: 12, opacity: 0.65 }}>key: {f.key}</div>
                      </td>

                      {members.map((m) => {
                        const ov = memberOverride(m.user_id, f.key); // null means no override
                        const busySet = savingKey === `member:${m.user_id}:${f.key}`;
                        const busyClear = savingKey === `clear:${m.user_id}:${f.key}`;

                        return (
                          <td key={`${m.user_id}:${f.key}`} style={tdStyleCenter}>
                            {m.is_controller ? (
                              <span style={{ fontSize: 12, opacity: 0.6 }}>—</span>
                            ) : (
                              <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                                <button
                                  onClick={() => setMemberOverride(m.user_id, f.key, true)}
                                  disabled={busySet}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #ddd",
                                    background: ov === true ? "#e7ffe7" : "#fff",
                                  }}
                                  title="Set override: allowed"
                                >
                                  {busySet && ov !== true ? "…" : "Allow"}
                                </button>

                                <button
                                  onClick={() => setMemberOverride(m.user_id, f.key, false)}
                                  disabled={busySet}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #ddd",
                                    background: ov === false ? "#ffe7e7" : "#fff",
                                  }}
                                  title="Set override: denied"
                                >
                                  {busySet && ov !== false ? "…" : "Deny"}
                                </button>

                                <button
                                  onClick={() => clearMemberOverride(m.user_id, f.key)}
                                  disabled={ov === null || busyClear}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #ddd",
                                    opacity: ov === null ? 0.4 : 1,
                                  }}
                                  title="Clear override"
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
          </section>
        </>
      )}
    </div>
  );
}

function MemberEditor({
  member,
  roles,
  saving,
  onSave,
}: {
  member: PermGet["members"][number];
  roles: string[];
  saving: boolean;
  onSave: (role: string, nickname: string) => void;
}) {
  const [role, setRole] = useState(member.role ?? "");
  const [nickname, setNickname] = useState(member.nickname ?? "");

  useEffect(() => {
    setRole(member.role ?? "");
    setNickname(member.nickname ?? "");
  }, [member.user_id, member.role, member.nickname]);

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {member.nickname ?? member.email ?? member.user_id} {member.is_controller ? "(controller)" : ""}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>{member.email ?? member.user_id}</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Role
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={roles[0] ?? "family"}
              disabled={!!member.is_controller}
              style={{ padding: 6 }}
              title={member.is_controller ? "Controllers keep their role management access" : "Role (lowercased by RPC)"}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Nickname
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Optional" style={{ padding: 6 }} />
          </label>

          <button
            onClick={() => onSave(role || (member.role ?? "family"), nickname)}
            disabled={saving}
            style={{ padding: "8px 10px", borderRadius: 10 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid #f3f3f3",
  verticalAlign: "top",
  minWidth: 240,
};

const tdStyleCenter: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid #f3f3f3",
  verticalAlign: "top",
  textAlign: "center",
  minWidth: 180,
};