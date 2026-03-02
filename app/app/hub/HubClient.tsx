// app/app/hub/HubClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleRow = {
  id: string;
  display_name: string;
};

type MembershipRow = {
  patient_id: string;
  role: string;
  is_controller: boolean;
};

type PermissionLookup = Record<string, boolean>;

export default function HubClient() {
  const supabase = supabaseBrowser();

  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [circles, setCircles] = useState<CircleRow[]>([]);
  const [permsByPid, setPermsByPid] = useState<Record<string, PermissionLookup>>({});
  const [debug, setDebug] = useState<string[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  // ---- Permission normalisation (stable, no label assumptions) ----
  function normalisePermissions(data: any): PermissionLookup {
    // permissions_get might return:
    // - string[]: ["journals_read", "dm_read", ...]
    // - object: { journals_read: true, ... }
    // - object: { permissions: { ... } }
    // - object: { allowed: ["..."] }
    const lookup: PermissionLookup = {};

    if (!data) return lookup;

    if (Array.isArray(data)) {
      // assume string[]
      for (const k of data) {
        if (typeof k === "string") lookup[k] = true;
      }
      return lookup;
    }

    if (typeof data === "object") {
      // unwrap common nests
      const maybe =
        (data.permissions && typeof data.permissions === "object" && data.permissions) ||
        (data.allowed && Array.isArray(data.allowed) && data.allowed) ||
        data;

      if (Array.isArray(maybe)) {
        for (const k of maybe) if (typeof k === "string") lookup[k] = true;
        return lookup;
      }

      if (typeof maybe === "object") {
        for (const [k, v] of Object.entries(maybe)) {
          if (typeof v === "boolean") lookup[k] = v;
          // sometimes permissions are 0/1
          if (typeof v === "number") lookup[k] = v === 1;
        }
      }
    }

    return lookup;
  }

  // Multiple candidate keys per feature to avoid drift between environments.
  // SAFE DEFAULT: if none match, feature is hidden.
  const PERM_KEYS = useMemo(
    () => ({
      today: ["today_read", "view_today", "can_view_today", "today:view", "circle_today_read"],
      summary: ["summary_read", "view_summary", "can_view_summary", "summary:view", "circle_summary_read"],
      profile: ["profile_read", "view_profile", "can_view_profile", "profile:view", "circle_profile_read"],
      medicationLogs: [
        "medication_logs_read",
        "medication_read",
        "meds_read",
        "view_medication_logs",
        "medication-logs:view",
      ],
      journals: ["journals_read", "journal_read", "view_journals", "journals:view", "circle_journals_read"],
    }),
    []
  );

  function hasAny(lookup: PermissionLookup, keys: string[]) {
    for (const k of keys) {
      if (lookup[k] === true) return true;
    }
    return false;
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setBusy(true);
      setMsg(null);
      setDebug([]);
      setCircles([]);
      setPermsByPid({});

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const uid = auth.user?.id;
        if (!uid) {
          setMsg("not_authenticated");
          return;
        }

        // memberships
        debugLog("Loading patient_members for current user...");
        const { data: memberships, error: memErr } = await supabase
          .from("patient_members")
          .select("patient_id, role, is_controller")
          .eq("user_id", uid);

        if (memErr) throw memErr;

        const memRows = (memberships ?? []) as MembershipRow[];
        const patientIds = memRows.map((m) => m.patient_id).filter(Boolean);

        debugLog(`Memberships found: ${patientIds.length}`);

        if (patientIds.length === 0) {
          setCircles([]);
          return;
        }

        // circles
        debugLog("Loading patients display_name...");
        const { data: patients, error: patErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", patientIds);

        if (patErr) throw patErr;

        const circleRows = (patients ?? []) as CircleRow[];

        // permissions per circle (RPC must use pid key)
        debugLog("Loading permissions per circle (permissions_get)...");
        const permsPairs = await Promise.all(
          circleRows.map(async (c) => {
            const { data, error } = await supabase.rpc("permissions_get", { pid: c.id });
            if (error) {
              // Don’t hard fail hub; just hide gated buttons for this circle
              debugLog(`permissions_get failed pid=${c.id}: ${error.message}`);
              return [c.id, {} as PermissionLookup] as const;
            }
            return [c.id, normalisePermissions(data)] as const;
          })
        );

        const permsMap: Record<string, PermissionLookup> = {};
        for (const [id, lookup] of permsPairs) permsMap[id] = lookup;

        if (!mounted) return;
        setCircles(circleRows);
        setPermsByPid(permsMap);
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
  }, [supabase]);

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
            const lookup = permsByPid[c.id] ?? {};

            const canToday = hasAny(lookup, PERM_KEYS.today);
            const canSummary = hasAny(lookup, PERM_KEYS.summary);
            const canProfile = hasAny(lookup, PERM_KEYS.profile);
            const canMeds = hasAny(lookup, PERM_KEYS.medicationLogs);
            const canJournals = hasAny(lookup, PERM_KEYS.journals);

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

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  {canToday && (
                    <Link href={`/app/patients/${c.id}/today`} style={circleBtnStyle}>
                      Today
                    </Link>
                  )}

                  {canSummary && (
                    <Link href={`/app/patients/${c.id}/summary`} style={circleBtnStyle}>
                      Summary
                    </Link>
                  )}

                  {canProfile && (
                    <Link href={`/app/patients/${c.id}/profile`} style={circleBtnStyle}>
                      Profile
                    </Link>
                  )}

                  {canMeds && (
                    <Link href={`/app/patients/${c.id}/medication-logs`} style={circleBtnStyle}>
                      Medication logs
                    </Link>
                  )}

                  {canJournals && (
                    <Link href={`/app/patients/${c.id}/journals`} style={circleBtnStyle}>
                      Journals
                    </Link>
                  )}
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
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {debug.length ? debug.join("\n") : "Debug log will appear here."}
      </div>
    </div>
  );
}