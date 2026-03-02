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
  const [permsByPid, setPermsByPid] = useState<Record<string, PermissionLookup | null>>({});
  const [rawPermsByPid, setRawPermsByPid] = useState<Record<string, any>>({});
  const [debug, setDebug] = useState<string[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  function normalisePermissions(data: any): PermissionLookup {
    const lookup: PermissionLookup = {};
    if (!data) return lookup;

    if (Array.isArray(data)) {
      for (const k of data) if (typeof k === "string") lookup[k] = true;
      return lookup;
    }

    if (typeof data === "object") {
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
          if (typeof v === "number") lookup[k] = v === 1;
        }
      }
    }

    return lookup;
  }

  // Candidate keys (we’ll tighten once we see real payload)
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
    for (const k of keys) if (lookup[k] === true) return true;
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
      setRawPermsByPid({});

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

        debugLog("Loading patients display_name...");
        const { data: patients, error: patErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", patientIds);

        if (patErr) throw patErr;

        const circleRows = (patients ?? []) as CircleRow[];

        debugLog("Loading permissions per circle (permissions_get)...");
        const permsMap: Record<string, PermissionLookup | null> = {};
        const rawMap: Record<string, any> = {};

        for (const c of circleRows) {
          // RPC payload key MUST be pid
          const { data, error } = await supabase.rpc("permissions_get", { pid: c.id });

          rawMap[c.id] = data;

          if (error) {
            // Don’t break hub; mark perms unknown (null) and log
            permsMap[c.id] = null;
            debugLog(`permissions_get ERROR pid=${c.id}: ${error.message}`);
            // ts-expect-error extra fields
            debugLog(`meta code=${error.code ?? "n/a"} details=${error.details ?? "n/a"} hint=${error.hint ?? "n/a"}`);
          } else {
            const norm = normalisePermissions(data);
            permsMap[c.id] = norm;
            debugLog(`permissions_get OK pid=${c.id} keys=${Object.keys(norm).length}`);
            debugLog(`permissions_get RAW pid=${c.id}: ${JSON.stringify(data)}`);
          }
        }

        if (!mounted) return;
        setCircles(circleRows);
        setPermsByPid(permsMap);
        setRawPermsByPid(rawMap);
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
            const lookupOrNull = permsByPid[c.id];
            const lookup = lookupOrNull ?? {}; // if null -> unknown

            const permsKnown = lookupOrNull !== null;

            // If perms unknown, we still SHOW buttons but disable them (safe, visible, debuggable).
            // If perms known, we enable only if matching keys.
            const canToday = permsKnown ? hasAny(lookup, PERM_KEYS.today) : true;
            const canSummary = permsKnown ? hasAny(lookup, PERM_KEYS.summary) : true;
            const canProfile = permsKnown ? hasAny(lookup, PERM_KEYS.profile) : true;
            const canMeds = permsKnown ? hasAny(lookup, PERM_KEYS.medicationLogs) : true;
            const canJournals = permsKnown ? hasAny(lookup, PERM_KEYS.journals) : true;

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
                  Perms: <code>{permsKnown ? "loaded" : "unknown (RPC error) — buttons shown but disabled until fixed"}</code>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <Link
                    href={`/app/patients/${c.id}/today`}
                    style={permsKnown ? (canToday ? circleBtnStyle : disabledBtnStyle) : disabledBtnStyle}
                  >
                    Today
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/summary`}
                    style={permsKnown ? (canSummary ? circleBtnStyle : disabledBtnStyle) : disabledBtnStyle}
                  >
                    Summary
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/profile`}
                    style={permsKnown ? (canProfile ? circleBtnStyle : disabledBtnStyle) : disabledBtnStyle}
                  >
                    Profile
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/medication-logs`}
                    style={permsKnown ? (canMeds ? circleBtnStyle : disabledBtnStyle) : disabledBtnStyle}
                  >
                    Medication logs
                  </Link>

                  <Link
                    href={`/app/patients/${c.id}/journals`}
                    style={permsKnown ? (canJournals ? circleBtnStyle : disabledBtnStyle) : disabledBtnStyle}
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