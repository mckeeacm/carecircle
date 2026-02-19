"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

/* ================= TYPES ================= */

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type Member = {
  user_id: string;
  role: string | null;
  nickname: string | null;
};

type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
};

type FeatureKey = {
  key: string;
  label: string | null;
  desc: string | null;
};

/* ================= HELPERS ================= */

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

function safeStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function humanRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  if (!r) return "Circle member";
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "supporter") return "Carer / support";
  if (r === "support_worker") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "professional_support") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "owner") return "Patient / Guardian";
  if (r === "patient") return "Patient";
  if (r === "guardian") return "Legal guardian";
  if (r === "legal_guardian") return "Legal guardian";
  return role!;
}

// These are the only roles we allow the UI to set.
// If your DB check constraint is different, the update will fail and the error will show.
const ROLE_OPTIONS = [
  { value: "family", label: "Family" },
  { value: "carer", label: "Carer / support" },
  { value: "professional", label: "Professional support" },
  { value: "clinician", label: "Clinician" },
  { value: "guardian", label: "Legal guardian" },
  { value: "patient", label: "Patient" },
];

// Treat these roles as “controller” (always allowed to manage permissions).
function isControllerRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  return r === "patient" || r === "guardian" || r === "legal_guardian" || r === "owner";
}

// Try multiple select lists until one works (because your schema has drifted before).
async function selectWithFallback<T>(
  table: string,
  selects: string[],
  build?: (q: any) => any
): Promise<{ data: T[] | null; error: string | null; usedSelect: string | null }> {
  for (const sel of selects) {
    const q0 = supabase.from(table).select(sel);
    const q = build ? build(q0) : q0;
    const res = await q;
    if (!res.error) return { data: (res.data ?? []) as any, error: null, usedSelect: sel };
  }
  // last attempt to surface error detail
  const last = await (build ? build(supabase.from(table).select(selects[0])) : supabase.from(table).select(selects[0]));
  return { data: null, error: last.error?.message ?? `Failed to select from ${table}`, usedSelect: null };
}

/* ================= PAGE ================= */

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

  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, UserProfile>>({});

  // role templates + overrides
  const [roleDefaults, setRoleDefaults] = useState<Array<{ role: string; feature_key: string; allowed: boolean }>>([]);
  const [memberOverrides, setMemberOverrides] = useState<Array<{ user_id: string; feature_key: string; allowed: boolean }>>(
    []
  );

  // figure out if current authed user is controller for this patient (from patient_members table)
  const [viewerRole, setViewerRole] = useState<string | null>(null);

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

  async function loadFeatures() {
    // Prefer your DB feature_keys table if present.
    const res = await selectWithFallback<any>(
      "feature_keys",
      ["key,label,desc", "key,label,description", "key,name,description", "key"],
      (q) => q.order("key", { ascending: true })
    );

    if (res.error) {
      // fallback hardcoded (so the page still works even if feature_keys is empty/missing)
      setFeatures([
        { key: "profile_view", label: "View care profile", desc: "See communication, allergies, safety notes." },
        { key: "profile_edit", label: "Edit care profile", desc: "Change profile fields." },
        { key: "meds_view", label: "View medications", desc: "See med list and logs." },
        { key: "meds_edit", label: "Edit medications", desc: "Add/edit/archive meds, log taken/missed." },
        { key: "journals_view", label: "View journals", desc: "See patient + circle timeline." },
        { key: "journals_post_circle", label: "Post circle updates", desc: "Create updates/comments in circle feed." },
        { key: "appointments_view", label: "View appointments", desc: "See upcoming/past appointments." },
        { key: "appointments_edit", label: "Edit appointments", desc: "Add/edit/delete appointments." },
        { key: "summary_view", label: "View clinician summary", desc: "Open / generate summary page." },
        { key: "invites_manage", label: "Manage invites", desc: "Create invites / add members." },
        { key: "permissions_manage", label: "Manage permissions", desc: "Change access templates / overrides." },
      ]);
      return;
    }

    const mapped: FeatureKey[] = (res.data ?? []).map((r: any) => ({
      key: String(r.key),
      label: safeStr(r.label ?? r.name ?? null),
      desc: safeStr(r.desc ?? r.description ?? null),
    }));
    setFeatures(mapped.length ? mapped : []);
  }

  async function loadMembersAndViewerRole() {
    const user = await requireAuth();
    if (!user) return;

    // patient_members: we’ll try to read nickname if it exists
    const mRes = await selectWithFallback<any>(
      "patient_members",
      ["user_id,role,nickname", "user_id,role,member_nickname", "user_id,role"],
      (q) => q.eq("patient_id", patientId).order("created_at", { ascending: false })
    );

    if (mRes.error) return setPageError(mRes.error);

    const raw = mRes.data ?? [];
    const mapped: Member[] = raw.map((r: any) => ({
      user_id: String(r.user_id),
      role: safeStr(r.role),
      nickname: safeStr(r.nickname ?? r.member_nickname ?? null),
    }));
    setMembers(mapped);

    // viewer role
    const mine = mapped.find((x) => x.user_id === user.id);
    setViewerRole(mine?.role ?? null);

    // load emails from user_profiles
    const ids = Array.from(new Set(mapped.map((x) => x.user_id)));
    if (!ids.length) {
      setProfilesById({});
      return;
    }

    // user_profiles could be id,email,display_name (your table list includes it)
    const up = await supabase.from("user_profiles").select("id,email,display_name").in("id", ids);
    if (!up.error) {
      const by: Record<string, UserProfile> = {};
      for (const r of up.data ?? []) {
        by[String((r as any).id)] = {
          id: String((r as any).id),
          email: safeStr((r as any).email),
          display_name: safeStr((r as any).display_name),
        };
      }
      setProfilesById(by);
    } else {
      setProfilesById({});
    }
  }

  async function loadRoleDefaults() {
    // canonical in your schema list: patient_role_feature_defaults
    const res = await selectWithFallback<any>(
      "patient_role_feature_defaults",
      ["role,feature_key,allowed", "role,feature_key,is_allowed", "role,feature_key"],
      (q) => q.eq("patient_id", patientId)
    );

    if (res.error) {
      // fallback to other tables you said exist
      const alt = await selectWithFallback<any>(
        "permissions_role_templates",
        ["role,feature_key,allowed", "role,feature_key,is_allowed", "role,feature_key"],
        (q) => q.eq("patient_id", patientId)
      );
      if (alt.error) return setPageError(`Role templates missing: ${alt.error}`);
      setRoleDefaults((alt.data ?? []).map((r: any) => ({ role: String(r.role), feature_key: String(r.feature_key), allowed: !!(r.allowed ?? r.is_allowed) })));
      return;
    }

    setRoleDefaults(
      (res.data ?? []).map((r: any) => ({
        role: String(r.role),
        feature_key: String(r.feature_key),
        allowed: !!(r.allowed ?? r.is_allowed),
      }))
    );
  }

  async function loadMemberOverrides() {
    const res = await selectWithFallback<any>(
      "patient_member_feature_overrides",
      ["user_id,feature_key,allowed", "member_uid,feature_key,allowed", "user_id,feature_key,is_allowed", "user_id,feature_key"],
      (q) => q.eq("patient_id", patientId)
    );

    if (res.error) {
      const alt = await selectWithFallback<any>(
        "permissions_member_overrides",
        ["user_id,feature_key,allowed", "member_uid,feature_key,allowed", "user_id,feature_key,is_allowed", "user_id,feature_key"],
        (q) => q.eq("patient_id", patientId)
      );
      if (alt.error) {
        // Don’t hard fail; overrides just won’t show.
        setMemberOverrides([]);
        return;
      }
      setMemberOverrides(
        (alt.data ?? []).map((r: any) => ({
          user_id: String(r.user_id ?? r.member_uid),
          feature_key: String(r.feature_key),
          allowed: !!(r.allowed ?? r.is_allowed),
        }))
      );
      return;
    }

    setMemberOverrides(
      (res.data ?? []).map((r: any) => ({
        user_id: String(r.user_id ?? r.member_uid),
        feature_key: String(r.feature_key),
        allowed: !!(r.allowed ?? r.is_allowed),
      }))
    );
  }

  async function loadAll() {
    setError(null);
    setLoading("Loading permissions…");

    await loadPatientName();
    await loadFeatures();
    await loadMembersAndViewerRole();
    await loadRoleDefaults();
    await loadMemberOverrides();

    setOk("Up to date.");
  }

  const canManage = useMemo(() => isControllerRole(viewerRole), [viewerRole]);

  const rolePermMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const rp of roleDefaults) m.set(`${String(rp.role).toLowerCase()}::${rp.feature_key}`, !!rp.allowed);
    return m;
  }, [roleDefaults]);

  const memberPermMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const mp of memberOverrides) m.set(`${mp.user_id}::${mp.feature_key}`, !!mp.allowed);
    return m;
  }, [memberOverrides]);

  // Ensure common roles appear even if not currently used
  const roleColumns = useMemo(() => {
    const baseRoles = ["family", "carer", "professional", "clinician", "guardian", "patient"];
    const merged = new Set<string>([
      ...baseRoles,
      ...members.map((m) => (m.role ?? "").toLowerCase()).filter(Boolean),
    ]);
    return Array.from(merged);
  }, [members]);

  async function setRolePermission(role: string, feature_key: string, allowed: boolean) {
    if (!canManage) return setPageError("Only patient / legal guardian can change permissions.");

    setLoading("Saving role template…");

    // Try primary table first; fallback to permissions_role_templates
    const payload = { patient_id: patientId, role, feature_key, allowed };

    let r = await supabase
      .from("patient_role_feature_defaults")
      .upsert(payload as any, { onConflict: "patient_id,role,feature_key" });

    if (r.error) {
      r = await supabase
        .from("permissions_role_templates")
        .upsert(payload as any, { onConflict: "patient_id,role,feature_key" });
    }

    if (r.error) return setPageError(r.error.message);

    await loadAll();
    setOk("Saved ✅");
  }

  async function setMemberOverride(user_id: string, feature_key: string, allowed: boolean) {
    if (!canManage) return setPageError("Only patient / legal guardian can change permissions.");

    setLoading("Saving member override…");

    const payload = { patient_id: patientId, user_id, feature_key, allowed };

    let r = await supabase
      .from("patient_member_feature_overrides")
      .upsert(payload as any, { onConflict: "patient_id,user_id,feature_key" });

    if (r.error) {
      r = await supabase
        .from("permissions_member_overrides")
        .upsert(payload as any, { onConflict: "patient_id,user_id,feature_key" });
    }

    if (r.error) return setPageError(r.error.message);

    await loadAll();
    setOk("Saved ✅");
  }

  async function clearMemberOverride(user_id: string, feature_key: string) {
    if (!canManage) return setPageError("Only patient / legal guardian can change permissions.");

    setLoading("Clearing override…");

    let r = await supabase
      .from("patient_member_feature_overrides")
      .delete()
      .eq("patient_id", patientId)
      .eq("user_id", user_id)
      .eq("feature_key", feature_key);

    if (r.error) {
      r = await supabase
        .from("permissions_member_overrides")
        .delete()
        .eq("patient_id", patientId)
        .eq("user_id", user_id)
        .eq("feature_key", feature_key);
    }

    if (r.error) return setPageError(r.error.message);

    await loadAll();
    setOk("Override cleared ✅");
  }

  async function updateMemberRoleAndNickname(user_id: string, role: string, nickname: string) {
    if (!canManage) return setPageError("Only patient / legal guardian can edit members.");

    setLoading("Saving member…");

    // nickname column may be nickname or member_nickname; try both
    const nick = nickname.trim();

    // 1) try update with nickname
    let r = await supabase
      .from("patient_members")
      .update({ role, nickname: nick || null } as any)
      .eq("patient_id", patientId)
      .eq("user_id", user_id);

    // 2) fallback to member_nickname
    if (r.error) {
      r = await supabase
        .from("patient_members")
        .update({ role, member_nickname: nick || null } as any)
        .eq("patient_id", patientId)
        .eq("user_id", user_id);
    }

    if (r.error) return setPageError(r.error.message);

    await loadAll();
    setOk("Member updated ✅");
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
                Role templates + per-user overrides.{" "}
                {canManage ? "You can manage these." : "You don’t have permission to edit these."}
              </div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/patients/${patientId}`}>
                ← Back to patient
              </Link>
              <button className="cc-btn" onClick={loadAll}>
                Refresh
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

        {/* Circle members (role + nickname) */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Circle members</h2>
              <div className="cc-subtle">Set role + nickname per member. Email comes from user_profiles.</div>
            </div>
          </div>

          {members.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-subtle">No members found.</div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {members.map((m) => {
                const prof = profilesById[m.user_id];
                const email = prof?.email ?? m.user_id;
                const display = prof?.display_name ?? null;
                const controller = isControllerRole(m.role);

                return (
                  <MemberCard
                    key={m.user_id}
                    member={m}
                    email={email}
                    displayName={display}
                    isController={controller}
                    canManage={canManage}
                    onSave={updateMemberRoleAndNickname}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Role templates */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Role templates</h2>
              <div className="cc-subtle">Defaults for members with a given role.</div>
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
                {(features.length ? features : []).map((f) => (
                  <tr key={f.key} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" } as any}>
                    <td style={{ padding: 10 } as any}>
                      <div className="cc-strong">{f.label ?? f.key}</div>
                      {f.desc ? <div className="cc-small">{f.desc}</div> : null}
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
                              disabled={!canManage}
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
            Note: Patient / guardian roles are treated as controllers in the UI.
          </div>
        </div>

        {/* Member overrides */}
        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Per-user overrides</h2>
          <div className="cc-subtle">Overrides take priority over the role template for that person.</div>

          {members.length === 0 ? (
            <p className="cc-subtle" style={{ marginTop: 12 } as any}>
              No members found.
            </p>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {members.map((m) => {
                const prof = profilesById[m.user_id];
                const email = prof?.email ?? m.user_id;
                const controller = isControllerRole(m.role);

                return (
                  <div key={m.user_id} className="cc-panel-green">
                    <div className="cc-row-between">
                      <div style={{ minWidth: 280 } as any}>
                        <div className="cc-strong">
                          {humanRole(m.role)}
                          {controller ? " • controller" : ""}
                        </div>
                        <div className="cc-small" style={{ marginTop: 4 } as any}>
                          {email}
                        </div>
                      </div>

                      <div className="cc-small">
                        {controller
                          ? "Controller members aren’t restricted here (treated as always allowed)."
                          : canManage
                            ? "You can add overrides below."
                            : "You can view only."}
                      </div>
                    </div>

                    {!controller ? (
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
                              {(features.length ? features : []).map((f) => {
                                const key = `${m.user_id}::${f.key}`;
                                const hasOverride = memberPermMap.has(key);
                                const val = memberPermMap.get(key);

                                return (
                                  <tr key={f.key} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" } as any}>
                                    <td style={{ padding: 10 } as any}>
                                      <div className="cc-strong">{f.label ?? f.key}</div>
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
                                            disabled={!canManage}
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
                                            disabled={!canManage}
                                            onClick={() => setMemberOverride(m.user_id, f.key, true)}
                                          >
                                            Override: allow
                                          </button>
                                          <button
                                            className="cc-btn"
                                            disabled={!canManage}
                                            onClick={() => setMemberOverride(m.user_id, f.key, false)}
                                          >
                                            Override: deny
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="cc-row">
                                          <button
                                            className="cc-btn"
                                            disabled={!canManage}
                                            onClick={() => clearMemberOverride(m.user_id, f.key)}
                                          >
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
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}

/* ================= MEMBER CARD ================= */

function MemberCard(props: {
  member: Member;
  email: string;
  displayName: string | null;
  isController: boolean;
  canManage: boolean;
  onSave: (user_id: string, role: string, nickname: string) => Promise<void>;
}) {
  const m = props.member;

  const [role, setRole] = useState<string>(m.role ?? "family");
  const [nickname, setNickname] = useState<string>(m.nickname ?? "");

  useEffect(() => {
    setRole(m.role ?? "family");
    setNickname(m.nickname ?? "");
  }, [m.role, m.nickname]);

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div>
          <div className="cc-strong">{props.displayName ?? props.email}</div>
          <div className="cc-small" style={{ marginTop: 4 } as any}>
            {props.email}
          </div>
          <div className="cc-small" style={{ marginTop: 6 } as any}>
            Current role: <b>{humanRole(m.role)}</b>
            {props.isController ? " • controller" : ""}
          </div>
        </div>

        <div className="cc-row">
          <button
            className="cc-btn cc-btn-primary"
            disabled={!props.canManage}
            onClick={() => props.onSave(m.user_id, role, nickname)}
          >
            Save
          </button>
        </div>
      </div>

      <div className="cc-grid-2" style={{ marginTop: 12 } as any}>
        <div className="cc-field">
          <div className="cc-label">Role</div>
          <select
            className="cc-input"
            value={role}
            disabled={!props.canManage}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="cc-small" style={{ marginTop: 6 } as any}>
            If your DB role constraint rejects this, you’ll see the exact error.
          </div>
        </div>

        <div className="cc-field">
          <div className="cc-label">Nickname</div>
          <input
            className="cc-input"
            value={nickname}
            disabled={!props.canManage}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g. Mum, Support worker, Dr. A"
          />
        </div>
      </div>
    </div>
  );
}
