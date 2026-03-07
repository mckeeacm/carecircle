"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import MobileShell from "@/app/components/MobileShell";

type Membership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
};

type PatientRow = {
  id: string;
  display_name: string | null;
};

type PermGet = {
  roles?: string[];
  members?: {
    user_id: string;
    role: string | null;
    nickname: string | null;
    is_controller: boolean | null;
    email?: string | null;
  }[];
  role_perms?: { patient_id: string; role: string; feature_key: string; allowed: boolean }[];
  member_perms?: { patient_id: string; user_id: string; feature_key: string; allowed: boolean }[];
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

function effectiveAllowed(
  data: PermGet | null,
  userId: string,
  role: string,
  key: string,
  isController: boolean
): boolean {
  if (isController) return true;
  const ov = getMemberOverride(data, userId, key);
  if (ov !== null) return ov;
  return hasRolePermission(data, role, key);
}

export default function HubClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [permsByPid, setPermsByPid] = useState<Record<string, PermGet | null>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      setMemberships([]);
      setPatientsById({});
      setPermsByPid({});

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const uid = auth.user?.id;
        if (!uid) throw new Error("not_authenticated");
        setUserId(uid);

        const { data: pm, error: pmErr } = await supabase
          .from("patient_members")
          .select("patient_id, role, nickname, is_controller")
          .eq("user_id", uid);

        if (pmErr) throw pmErr;

        const ms = (pm ?? []) as Membership[];
        setMemberships(ms);

        const pids = Array.from(new Set(ms.map((m) => m.patient_id)));
        if (pids.length === 0) {
          setLoading(false);
          return;
        }

        const { data: pts, error: pErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", pids);

        if (pErr) throw pErr;

        const map: Record<string, PatientRow> = {};
        for (const p of (pts ?? []) as PatientRow[]) map[p.id] = p;
        setPatientsById(map);

        const nextPerms: Record<string, PermGet | null> = {};
        for (const pid of pids) {
          const { data, error } = await supabase.rpc("permissions_get", { pid });
          if (error) {
            nextPerms[pid] = null;
          } else {
            nextPerms[pid] = data as PermGet;
          }
        }
        setPermsByPid(nextPerms);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_hub");
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  return (
    <MobileShell
      title="Hub"
      subtitle="All circles you’re a member of"
      rightSlot={
        <Link className="cc-btn" href="/app/account">
          Account
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">Error</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="cc-card cc-card-pad">
          <div className="cc-subtle">Loading circles…</div>
        </div>
      ) : memberships.length === 0 ? (
        <div className="cc-card cc-card-pad">
          <div className="cc-strong">No circles yet</div>
          <div className="cc-subtle">You aren’t a member of any patient circles.</div>
        </div>
      ) : (
        <div className="cc-stack">
          {memberships.map((m) => {
            const p = patientsById[m.patient_id];
            const perms = permsByPid[m.patient_id] ?? null;
            const role = m.role ?? "family";
            const isController = m.is_controller === true;

            const canToday = true;
            const canSummary = effectiveAllowed(perms, userId, role, "summary_view", isController);
            const canProfile = effectiveAllowed(perms, userId, role, "profile_view", isController);
            const canMeds = effectiveAllowed(perms, userId, role, "meds_view", isController);
            const canJournals = effectiveAllowed(perms, userId, role, "journals_view", isController);
            const canAppointments = effectiveAllowed(perms, userId, role, "appointments_view", isController);
            const canDm = effectiveAllowed(perms, userId, role, "dm_view", isController);
            const canPerms = effectiveAllowed(perms, userId, role, "permissions_manage", isController);

            return (
              <div key={m.patient_id} className="cc-card cc-card-pad cc-stack">
                <div className="cc-row-between">
                  <div className="cc-wrap">
                    <div className="cc-strong">{p?.display_name ?? "My Circle"}</div>
                    <div className="cc-small cc-wrap">{m.patient_id}</div>
                    <div className="cc-small">
                      role: <b>{role}</b>
                      {isController ? " • controller: true" : ""}
                    </div>
                  </div>

                  <div className="cc-row">
                    <span className="cc-pill cc-pill-primary">Perms: loaded</span>
                  </div>
                </div>

                <div className="cc-grid-3">
                  <Link className={`cc-btn ${canToday ? "cc-btn-primary" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/today`}>
                    Today
                  </Link>

                  <Link className={`cc-btn ${canSummary ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/summary`}>
                    Summary
                  </Link>

                  <Link className={`cc-btn ${canProfile ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/profile`}>
                    Profile
                  </Link>

                  <Link className={`cc-btn ${canMeds ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/medication-logs`}>
                    Medication logs
                  </Link>

                  <Link className={`cc-btn ${canJournals ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/journals`}>
                    Journals
                  </Link>

                  <Link className={`cc-btn ${canAppointments ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/appointments`}>
                    Appointments
                  </Link>

                  <Link className={`cc-btn ${canDm ? "" : "cc-btn-disabled"}`} href={`/app/patients/${m.patient_id}/dm`}>
                    DMs
                  </Link>

                  <Link className={`cc-btn ${canPerms ? "cc-btn-secondary" : "cc-btn-disabled"}`} href={`/app/account/permissions?pid=${m.patient_id}`}>
                    Permissions
                  </Link>
                </div>

                <div className="cc-small cc-subtle">
                  Buttons are enabled only if your effective permission allows that feature.
                </div>
              </div>
            );
          })}
        </div>
      )}
    </MobileShell>
  );
}