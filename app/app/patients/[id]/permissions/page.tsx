"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type Member = { user_id: string; role: string; is_controller: boolean };

type RolePerm = { role: string; feature_key: string; allowed: boolean };
type MemberPerm = { user_id: string; feature_key: string; allowed: boolean };

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
  if (r === "owner") return "Patient / Guardian";
  if (r === "guardian") return "Legal guardian";
  if (r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

const FEATURES: { key: string; label: string; desc: string }[] = [
  { key: "profile_view", label: "View care profile", desc: "See communication, allergies, safety notes." },
  { key: "profile_edit", label: "Edit care profile", desc: "Change profile fields." },

  { key: "meds_view", label: "View medications", desc: "See med list and logs." },
  { key: "meds_edit", label: "Edit medications", desc: "Add/edit/archive meds, log taken/missed." },

  { key: "journals_view", label: "View journals", desc: "See patient + circle timeline (as allowed by app logic)." },
  { key: "journals_post_circle", label: "Post circle updates", desc: "Create updates/comments in circle feed." },

  { key: "appointments_view", label: "View appointments", desc: "See upcoming/past appointments." },
  { key: "appointments_edit", label: "Edit appointments", desc: "Add/edit/delete appointments." },

  { key: "summary_view", label: "View clinician summary", desc: "Open / generate summary page." },

  { key: "invites_manage", label: "Manage invites", desc: "Create invites / add members." },
  { key: "permissions_manage", label: "Manage permissions", desc: "Change access templates / overrides." },
];

export default function PatientPermissionsPage() {
  const params = useParams();
  const patientId = String(params?.id ?? "");

  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("…");

  const [roles, setRoles] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rolePerms, setRolePerms] = useState<RolePerm[]>([]);
  const [memberPerms, setMemberPerms] = useState<MemberPerm[]>([]);

  const rolePermMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const rp of rolePerms) m.set(`${rp.role.toLowerCase()}::${rp.feature_key}`, !!rp.allowed);
    return m;
  }, [rolePerms]);

  const memberPermMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const mp of memberPerms) m.set(`${mp.user_id}::${mp.feature_key}`, !!mp.allowed);
    return m;
  }, [memberPerms]);

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
    return data.user;
  }

  async function loadPatientName() {
    const q = await supabase.from("patients").select("display_name").eq("id", patientId).single();
    if (q.error) return setPageError(q.error.message);
    setPatientName(q.data.display_name);
  }

  async function loadAll() {
    setError(null);
    const user = await requireAuth();
    if (!user) return;

    setLoading("Loading permissions…");

    await loadPatientName();

    const r = await supabase.rpc("permissions_get", { pid: patientId });
    if (r.error) return setPageError(r.error.message);

    const data = r.data as any;

    setRoles((data?.roles ?? []).map((x: any) => String(x)));
    setMembers((data?.members ?? []) as Member[]);
    setRolePerms((data?.role_perms ?? []) as RolePerm[]);
    setMemberPerms((data?.member_perms ?? []) as MemberPerm[]);

    setOk("Up to date.");
  }

  async function seedDefaults() {
    setError(null);
    setLoading("Seeding role templates…");
    const r = await supabase.rpc("permissions_seed_defaults", { pid: patientId });
    if (r.error) return setPageError(r.error.message);
    await loadAll();
    setOk("Defaults seeded ✅");
  }

  async function setRolePermission(role: string, feature_key: string, allowed: boolean) {
    setError(null);
    setLoading("Saving role template…");
    const r = await supabase.rpc("permissions_set_role", {
      pid: patientId,
      p_role: role,
      p_feature_key: feature_key,
      p_allowed: allowed,
    });
    if (r.error) return setPageError(r.error.message);
    await loadAll();
    setOk("Saved ✅");
  }

  async function setMemberOverride(user_id: string, feature_key: string, allowed: boolean) {
    setError(null);
    setLoading("Saving member override…");
    const r = await supabase.rpc("permissions_set_member", {
      pid: patientId,
      member_uid: user_id,
      p_feature_key: feature_key,
      p_allowed: allowed,
    });
    if (r.error) return setPageError(r.error.message);
    await loadAll();
    setOk("Saved ✅");
  }

  async function clearMemberOverride(user_id: string, feature_key: string) {
    setError(null);
    setLoading("Clearing override…");
    const r = await supabase.rpc("permissions_clear_member_override", {
      pid: patientId,
      member_uid: user_id,
      p_feature_key: feature_key,
    });
    if (r.error) return setPageError(r.error.message);
    await loadAll();
    setOk("Override cleared ✅");
  }

  useEffect(() => {
    (async () => {
      if (!patientId || patientId === "undefined") return setPageError("Missing patient id.");
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (!patientId || patientId === "undefined") {
    return (
      <main className="cc-page">
        <div className="cc-container">Missing patient id.</div>
      </main>
    );
  }

  // Ensure common roles appear even if not currently used, so templates are configurable.
  const roleColumns = useMemo(() => {
    const baseRoles = ["family", "carer", "professional", "clinician"];
    const merged = new Set<string>([...baseRoles, ...roles.map((r) => r.toLowerCase())]);
    return Array.from(merged);
  }, [roles]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">Patient</div>
              <h1 className="cc-h1">Permissions — {patientName}</h1>
              <div className="cc-subtle">
                Role templates + per-user overrides. Only patient/legal guardian (controller) can change these.
              </div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/patients/${patientId}`}>
                ← Back to patient
              </Link>
              <button className="cc-btn" onClick={loadAll}>
                Refresh
              </button>
              <button className="cc-btn cc-btn-primary" onClick={seedDefaults}>
                Seed defaults
              </button>
            </div>
          </div>

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

        {/* Role templates */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Role templates</h2>
              <div className="cc-subtle">These are the defaults for members with a given role.</div>
            </div>
          </div>

          <div className="cc-panel" style={{ marginTop: 12, overflowX: "auto" } as any}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 } as any}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, width: 320 } as any}>Feature</th>
                  {roleColumns.map((role) => (
                    <th key={role} style={{ textAlign: "left", padding: 10 } as any}>
                      {humanRole(role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f) => (
                  <tr key={f.key} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" } as any}>
                    <td style={{ padding: 10 } as any}>
                      <div className="cc-strong">{f.label}</div>
                      <div className="cc-small">{f.desc}</div>
                      <div className="cc-small">Key: {f.key}</div>
                    </td>

                    {roleColumns.map((role) => {
                      const k = `${role.toLowerCase()}::${f.key}`;
                      const allowed = rolePermMap.get(k) ?? false;

                      return (
                        <td key={k} style={{ padding: 10, verticalAlign: "top" } as any}>
                          <label className="cc-check">
                            <input
                              type="checkbox"
                              checked={allowed}
                              onChange={(e) => setRolePermission(role, f.key, e.target.checked)}
                            />
                            Allowed
                          </label>
                          <div className="cc-small" style={{ marginTop: 6 } as any}>
                            {allowed ? "✅ enabled" : "— default off"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cc-small" style={{ marginTop: 10 } as any}>
            Note: patient/legal guardian always has access regardless of templates.
          </div>
        </div>

        {/* Member overrides */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Per-user overrides</h2>
          <div className="cc-subtle">
            Overrides take priority over the role template for that specific person.
          </div>

          {members.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 12 } as any}>
              No members found.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {members.map((m) => (
                <div key={m.user_id} className="cc-panel-green">
                  <div className="cc-row-between">
                    <div style={{ minWidth: 280 } as any}>
                      <div className="cc-strong">
                        {humanRole(m.role)}
                        {m.is_controller ? " • controller" : ""}
                      </div>
                      <div className="cc-small" style={{ marginTop: 4 } as any}>
                        User: {m.user_id}
                      </div>
                    </div>

                    <div className="cc-small">
                      Controller members can’t be restricted here (they’re always allowed).
                    </div>
                  </div>

                  {!m.is_controller && (
                    <div className="cc-panel-soft" style={{ marginTop: 12 } as any}>
                      <div style={{ overflowX: "auto" } as any}>
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 } as any}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: 10, width: 320 } as any}>Feature</th>
                              <th style={{ textAlign: "left", padding: 10 } as any}>Override</th>
                              <th style={{ textAlign: "left", padding: 10 } as any}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {FEATURES.map((f) => {
                              const key = `${m.user_id}::${f.key}`;
                              const hasOverride = memberPermMap.has(key);
                              const val = memberPermMap.get(key);

                              return (
                                <tr key={f.key} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" } as any}>
                                  <td style={{ padding: 10 } as any}>
                                    <div className="cc-strong">{f.label}</div>
                                    <div className="cc-small">{f.key}</div>
                                  </td>

                                  <td style={{ padding: 10 } as any}>
                                    {!hasOverride ? (
                                      <div className="cc-small">No override (uses role template)</div>
                                    ) : (
                                      <label className="cc-check">
                                        <input
                                          type="checkbox"
                                          checked={!!val}
                                          onChange={(e) => setMemberOverride(m.user_id, f.key, e.target.checked)}
                                        />
                                        Allowed
                                      </label>
                                    )}
                                  </td>

                                  <td style={{ padding: 10 } as any}>
                                    {!hasOverride ? (
                                      <div className="cc-row">
                                        <button
                                          className="cc-btn cc-btn-primary"
                                          onClick={() => setMemberOverride(m.user_id, f.key, true)}
                                        >
                                          Override: allow
                                        </button>
                                        <button
                                          className="cc-btn"
                                          onClick={() => setMemberOverride(m.user_id, f.key, false)}
                                        >
                                          Override: deny
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="cc-row">
                                        <button className="cc-btn" onClick={() => clearMemberOverride(m.user_id, f.key)}>
                                          Clear override
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
