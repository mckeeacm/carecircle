"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Membership = {
  patient_id: string;
  role: string;
  nickname: string | null;
  is_controller: boolean;
};

type PatientRow = { id: string; display_name: string };

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

function truthy(v: unknown) {
  return v === true;
}

function hasRolePermission(data: PermGet | null, role: string, key: string): boolean {
  const rp = data?.role_perms?.find((r) => r.role === role && r.feature_key === key);
  return rp ? truthy(rp.allowed) : false;
}

function getMemberOverride(data: PermGet | null, userId: string, key: string): boolean | null {
  const mp = data?.member_perms?.find((m) => m.user_id === userId && m.feature_key === key);
  return mp ? truthy(mp.allowed) : null;
}

function effectiveAllowed(data: PermGet | null, userId: string, role: string, key: string): boolean {
  const ov = getMemberOverride(data, userId, key);
  if (ov !== null) return ov;
  return hasRolePermission(data, role, key);
}

function nowIso() {
  return new Date().toISOString();
}

export default function HubClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [userId, setUserId] = useState<string>("");

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [permsByPid, setPermsByPid] = useState<Record<string, PermGet | null>>({});

  function log(line: string) {
    setDebug((p) => [...p, `[${nowIso()}] ${line}`].slice(-250));
  }

  useEffect(() => {
    (async () => {
      setMsg(null);
      setDebug([]);
      setMemberships([]);
      setPatientsById({});
      setPermsByPid({});

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        setMsg(authErr.message);
        return;
      }
      const uid = auth.user?.id;
      if (!uid) {
        setMsg("not_authenticated");
        return;
      }
      setUserId(uid);

      log("Loading patient_members for current user...");
      const { data: pm, error: pmErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller")
        .eq("user_id", uid);

      if (pmErr) {
        setMsg(pmErr.message);
        return;
      }

      const ms = (pm ?? []) as Membership[];
      setMemberships(ms);
      log(`Memberships found: ${ms.length}`);

      const pids = Array.from(new Set(ms.map((m) => m.patient_id)));
      if (pids.length === 0) return;

      log("Loading patients display_name...");
      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .in("id", pids)
        .order("created_at", { ascending: false });

      if (pErr) {
        setMsg(pErr.message);
        return;
      }

      const map: Record<string, PatientRow> = {};
      for (const p of (pts ?? []) as PatientRow[]) map[p.id] = p;
      setPatientsById(map);

      log("Loading permissions per circle (permissions_get)...");
      const nextPerms: Record<string, PermGet | null> = {};
      for (const pid of pids) {
        const { data, error } = await supabase.rpc("permissions_get", { pid });
        if (error) {
          log(`permissions_get ERROR pid=${pid}: ${error.message}`);
          nextPerms[pid] = null;
        } else {
          nextPerms[pid] = data as PermGet;
          const keys = (data as any)?.role_perms?.length ?? 0;
          log(`permissions_get OK pid=${pid} keys=${keys}`);
        }
      }
      setPermsByPid(nextPerms);
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_hub"));
  }, [supabase]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Hub</h1>
            <div className="cc-subtle">All circles you’re a member of</div>
          </div>
          <div className="cc-row">
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

        {memberships.length === 0 ? (
          <div className="cc-card cc-card-pad">
            <div className="cc-strong">No circles yet</div>
            <div className="cc-subtle">You aren’t a member of any patient circles.</div>
          </div>
        ) : (
          <div className="cc-stack">
            {memberships.map((m) => {
              const p = patientsById[m.patient_id];
              const perms = permsByPid[m.patient_id] ?? null;

              const canSummary = effectiveAllowed(perms, userId, m.role, "summary_view");
              const canProfile = effectiveAllowed(perms, userId, m.role, "profile_view");
              const canMeds = effectiveAllowed(perms, userId, m.role, "meds_view");
              const canJournals = effectiveAllowed(perms, userId, m.role, "journals_view");
              const canAppointments = effectiveAllowed(perms, userId, m.role, "appointments_view");
              const canDm = effectiveAllowed(perms, userId, m.role, "dm_view");
              const canPerms = m.is_controller || m.role === "patient";

              return (
                <div key={m.patient_id} className="cc-card cc-card-pad cc-stack">
                  <div className="cc-row-between">
                    <div className="cc-wrap">
                      <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                      <div className="cc-small cc-wrap">{m.patient_id}</div>
                      <div className="cc-small">
                        role: <b>{m.role}</b> • controller: <b>{m.is_controller ? "true" : "false"}</b>
                      </div>
                    </div>

                    <div className="cc-row">
                      <span className="cc-pill cc-pill-primary">Perms: {perms ? "loaded" : "—"}</span>
                    </div>
                  </div>

                  <div className="cc-row">
                    <Link className="cc-btn cc-btn-primary" href={`/app/patients/${m.patient_id}/today`}>
                      Today
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/summary`} aria-disabled={!canSummary}>
                      <button className="cc-btn" disabled={!canSummary} style={{ padding: 0, border: "none", background: "transparent" }}>
                        Summary
                      </button>
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/profile`}>
                      <button className="cc-btn" disabled={!canProfile} style={{ padding: 0, border: "none", background: "transparent" }}>
                        Profile
                      </button>
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/medication-logs`}>
                      <button className="cc-btn" disabled={!canMeds} style={{ padding: 0, border: "none", background: "transparent" }}>
                        Medication logs
                      </button>
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/journals`}>
                      <button className="cc-btn" disabled={!canJournals} style={{ padding: 0, border: "none", background: "transparent" }}>
                        Journals
                      </button>
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/appointments`}>
                      <button className="cc-btn" disabled={!canAppointments} style={{ padding: 0, border: "none", background: "transparent" }}>
                        Appointments
                      </button>
                    </Link>

                    <Link className="cc-btn" href={`/app/patients/${m.patient_id}/dm`}>
                      <button className="cc-btn" disabled={!canDm} style={{ padding: 0, border: "none", background: "transparent" }}>
                        DMs
                      </button>
                    </Link>

                    {canPerms ? (
                      <Link className="cc-btn cc-btn-secondary" href={`/app/account/permissions?pid=${m.patient_id}`}>
                        Permissions
                      </Link>
                    ) : null}
                  </div>

                  <div className="cc-small cc-subtle">
                    Buttons are enabled only if your effective permission allows that feature.
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="cc-card cc-card-pad">
          <div className="cc-strong">Debug</div>
          <pre className="cc-panel-soft cc-wrap" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {debug.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}