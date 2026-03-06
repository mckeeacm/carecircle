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
  patient_id: string;
  user_id: string;
  role: string;
  is_controller: boolean;
  role_permissions: Record<string, boolean>;
  member_overrides: Record<string, boolean>;
  effective: Record<string, boolean>;
};

function truthy(v: unknown) {
  return v === true;
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
          const shaped = data as PermGet;
          nextPerms[pid] = shaped;
          const effectiveKeys = Object.keys(shaped?.effective ?? {}).length;
          log(`permissions_get OK pid=${pid} effective_keys=${effectiveKeys}`);
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
              const effective = perms?.effective ?? {};

              const canToday = true;
              const canSummary = truthy(effective.summary_view);
              const canProfile = truthy(effective.profile_view);
              const canMeds = truthy(effective.meds_view);
              const canJournals = truthy(effective.journals_view);
              const canAppointments = truthy(effective.appointments_view);
              const canDm = truthy(effective.dm_view);
              const canSobriety = truthy(effective.trackers_view);
              const canPerms = truthy(effective.permissions_manage);

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
                      <span className={`cc-pill ${perms ? "cc-pill-primary" : ""}`}>
                        Perms: {perms ? "loaded" : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="cc-row">
                    <Link className="cc-btn cc-btn-primary" href={`/app/patients/${m.patient_id}/today`}>
                      Today
                    </Link>

                    <button
                      className="cc-btn"
                      disabled={!canSummary}
                      onClick={() => canSummary && (window.location.href = `/app/patients/${m.patient_id}/summary`)}
                    >
                      Summary
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canProfile}
                      onClick={() => canProfile && (window.location.href = `/app/patients/${m.patient_id}/profile`)}
                    >
                      Profile
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canMeds}
                      onClick={() => canMeds && (window.location.href = `/app/patients/${m.patient_id}/medication-logs`)}
                    >
                      Medication logs
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canJournals}
                      onClick={() => canJournals && (window.location.href = `/app/patients/${m.patient_id}/journals`)}
                    >
                      Journals
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canAppointments}
                      onClick={() => canAppointments && (window.location.href = `/app/patients/${m.patient_id}/appointments`)}
                    >
                      Appointments
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canDm}
                      onClick={() => canDm && (window.location.href = `/app/patients/${m.patient_id}/dm`)}
                    >
                      DMs
                    </button>

                    <button
                      className="cc-btn"
                      disabled={!canSobriety}
                      onClick={() => canSobriety && (window.location.href = `/app/patients/${m.patient_id}/sobriety`)}
                    >
                      Sobriety
                    </button>

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