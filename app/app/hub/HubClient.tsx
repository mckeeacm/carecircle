// app/app/hub/HubClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleRow = {
  id: string;
  display_name: string;
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

type PermCtx = {
  loaded: boolean;
  my_role: string | null;
  is_controller: boolean;
  roleMap: Record<string, boolean>; // feature_key -> allowed for my role
  memberMap: Record<string, boolean>; // feature_key -> allowed override for me
  raw?: PermGet;
};

function truthy(v: unknown): boolean {
  return v === true;
}

export default function HubClient() {
  const supabase = supabaseBrowser();

  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [circles, setCircles] = useState<CircleRow[]>([]);
  const [permByPid, setPermByPid] = useState<Record<string, PermCtx>>({});
  const [debug, setDebug] = useState<string[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  // Canonical feature keys from your DB seed
  const FEATURE = useMemo(
    () => ({
      today: "summary_view", // until you add a dedicated today_view
      summary: "summary_view",
      profile: "profile_view",
      meds: "meds_view",
      journals: "journals_view",
    }),
    []
  );

  function computePermCtx(payload: PermGet, uid: string): PermCtx {
    const me = (payload.members ?? []).find((m) => m.user_id === uid);
    const my_role = me?.role ?? null;
    const is_controller = truthy(me?.is_controller);

    const roleMap: Record<string, boolean> = {};
    const memberMap: Record<string, boolean> = {};

    if (my_role) {
      for (const rp of payload.role_perms ?? []) {
        if (rp.role === my_role) roleMap[rp.feature_key] = truthy(rp.allowed);
      }
    }

    for (const mp of payload.member_perms ?? []) {
      if (mp.user_id === uid) memberMap[mp.feature_key] = truthy(mp.allowed);
    }

    return { loaded: true, my_role, is_controller, roleMap, memberMap, raw: payload };
  }

  function allowed(ctx: PermCtx | undefined, feature_key: string): boolean {
    if (!ctx?.loaded) return false;
    // Controller gets management access implicitly in your system, but for view features we still honour keys.
    // Member override wins
    if (feature_key in ctx.memberMap) return ctx.memberMap[feature_key] === true;
    return ctx.roleMap[feature_key] === true;
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setBusy(true);
      setMsg(null);
      setDebug([]);
      setCircles([]);
      setPermByPid({});

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const uid = auth.user?.id;
        if (!uid) {
          setMsg("not_authenticated");
          return;
        }

        debugLog("Loading patient_members for current user...");
        const { data: memberships, error: memErr } = await supabase
          .from("patient_members")
          .select("patient_id")
          .eq("user_id", uid);

        if (memErr) throw memErr;

        const patientIds = Array.from(
          new Set((memberships ?? []).map((m: any) => m.patient_id as string).filter(Boolean))
        );

        debugLog(`Memberships found: ${patientIds.length}`);

        if (patientIds.length === 0) {
          setCircles([]);
          return;
        }

        debugLog("Loading patients display_name...");
        const { data: patients, error: patErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", patientIds);

        if (patErr) throw patErr;

        const circleRows = (patients ?? []) as CircleRow[];

        debugLog("Loading permissions per circle (permissions_get)...");
        const nextPerms: Record<string, PermCtx> = {};

        for (const c of circleRows) {
          // payload key MUST be pid
          const { data, error } = await supabase.rpc("permissions_get", { pid: c.id });

          if (error) {
            debugLog(`permissions_get ERROR pid=${c.id}: ${error.message}`);
            nextPerms[c.id] = {
              loaded: false,
              my_role: null,
              is_controller: false,
              roleMap: {},
              memberMap: {},
            };
            continue;
          }

          const payload = data as PermGet;
          const ctx = computePermCtx(payload, uid);

          debugLog(
            `permissions_get OK pid=${c.id} my_role=${ctx.my_role ?? "null"} controller=${String(ctx.is_controller)} roleKeys=${Object.keys(
              ctx.roleMap
            ).length} memberKeys=${Object.keys(ctx.memberMap).length}`
          );

          nextPerms[c.id] = ctx;
        }

        if (!mounted) return;
        setCircles(circleRows);
        setPermByPid(nextPerms);
      } catch (e: any) {
        if (!mounted) return;
        setMsg(e?.message ?? "hub_load_failed");
      } finally {
        if (mounted) setBusy(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [supabase, FEATURE]);

  const topBtnStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    textDecoration: "none",
    color: "inherit",
  };

  const circleBtnStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "8px 10px",
    border: "1px solid #ccc",
    borderRadius: 8,
    textDecoration: "none",
    color: "inherit",
    fontSize: 13,
  };

  const disabledBtnStyle: React.CSSProperties = {
    ...circleBtnStyle,
    opacity: 0.5,
    pointerEvents: "none",
  };

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Hub</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Link href="/app/account" style={topBtnStyle}>
          Account
        </Link>
        <Link href="/app/onboarding" style={topBtnStyle}>
          Manage circles
        </Link>
      </div>

      {busy && <p>Loading…</p>}

      {!busy && msg && (
        <p style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>{msg}</p>
      )}

      {!busy && !msg && circles.length === 0 && (
        <p style={{ opacity: 0.85 }}>No circles yet. Go to “Manage circles”.</p>
      )}

      {!busy && !msg && circles.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {circles.map((c) => {
            const ctx = permByPid[c.id];

            const canToday = allowed(ctx, FEATURE.today);
            const canSummary = allowed(ctx, FEATURE.summary);
            const canProfile = allowed(ctx, FEATURE.profile);
            const canMeds = allowed(ctx, FEATURE.meds);
            const canJournals = allowed(ctx, FEATURE.journals);

            return (
              <div
                key={c.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                  background: "rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ fontWeight: 800 }}>{c.display_name}</div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  <code>{c.id}</code>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Perms:{" "}
                  <code>
                    {ctx?.loaded ? `loaded (role=${ctx.my_role ?? "null"})` : "unknown"}
                  </code>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <Link
                    href={`/app/patients/${c.id}/today`}
                    style={canToday ? circleBtnStyle : disabledBtnStyle}
                  >
                    Today
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/summary`}
                    style={canSummary ? circleBtnStyle : disabledBtnStyle}
                  >
                    Summary
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/profile`}
                    style={canProfile ? circleBtnStyle : disabledBtnStyle}
                  >
                    Profile
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/medication-logs`}
                    style={canMeds ? circleBtnStyle : disabledBtnStyle}
                  >
                    Medication logs
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/journals`}
                    style={canJournals ? circleBtnStyle : disabledBtnStyle}
                  >
                    Journals
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        id="debug"
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          background: "rgba(0,0,0,0.02)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          maxHeight: 260,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {debug.length ? debug.join("\n") : "Debug log will appear here."}
      </div>
    </div>
  );
}