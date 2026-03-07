"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
};

type Patient = {
  id: string;
  display_name: string | null;
};

type PermissionMap = Record<string, boolean>;

export default function HubClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [circles, setCircles] = useState<CircleMembership[]>([]);
  const [patients, setPatients] = useState<Record<string, Patient>>({});
  const [permissions, setPermissions] = useState<Record<string, PermissionMap>>({});

  async function load() {
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;

    if (!uid) {
      setLoading(false);
      return;
    }

    const { data: memberships } = await supabase
      .from("patient_members")
      .select("patient_id, role, nickname, is_controller")
      .eq("user_id", uid);

    const ms = memberships ?? [];
    setCircles(ms);

    const ids = ms.map((m) => m.patient_id);

    if (ids.length > 0) {
      const { data: pts } = await supabase
        .from("patients")
        .select("id, display_name")
        .in("id", ids);

      const map: Record<string, Patient> = {};
      (pts ?? []).forEach((p) => (map[p.id] = p));
      setPatients(map);

      const perms: Record<string, PermissionMap> = {};

      for (const pid of ids) {
        const { data } = await supabase.rpc("permissions_get", { pid });
        perms[pid] = data ?? {};
      }

      setPermissions(perms);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function allowed(pid: string, key: string, controller: boolean) {
    if (controller) return true;
    return permissions?.[pid]?.[key] === true;
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container">
          <h1 className="cc-h1">Hub</h1>
          <div className="cc-subtle">Loading circles…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Hub</h1>
            <div className="cc-subtle">All circles you’re a member of</div>
          </div>

          <Link className="cc-btn" href="/app/account">
            Account
          </Link>
        </div>

        {circles.map((m) => {
          const pid = m.patient_id;
          const controller = m.is_controller === true;
          const perms = permissions[pid] ?? {};

          return (
            <div key={pid} className="cc-card cc-card-pad cc-stack">
              <div className="cc-row-between">
                <div>
                  <div className="cc-strong">
                    {patients[pid]?.display_name ?? "My Circle"}
                  </div>

                  <div className="cc-small cc-subtle">{pid}</div>

                  <div className="cc-small">
                    role: <b>{m.role ?? "—"}</b>
                    {controller ? " • controller" : ""}
                  </div>
                </div>

                <div className="cc-pill cc-pill-primary">
                  Perms: loaded
                </div>
              </div>

              <div className="cc-grid-3">
                <Link
                  className={`cc-btn ${allowed(pid, "summary_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/today`}
                >
                  Today
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "summary_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/summary`}
                >
                  Summary
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "profile_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/profile`}
                >
                  Profile
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "meds_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/medications`}
                >
                  Medication logs
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "journals_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/journals`}
                >
                  Journals
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "appointments_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/appointments`}
                >
                  Appointments
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "dm_view", controller) ? "" : "cc-btn-disabled"}`}
                  href={`/app/patients/${pid}/dm`}
                >
                  DMs
                </Link>

                <Link
                  className={`cc-btn ${allowed(pid, "permissions_manage", controller) ? "cc-btn-primary" : "cc-btn-disabled"}`}
                  href={`/app/account/permissions?pid=${pid}`}
                >
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
    </div>
  );
}