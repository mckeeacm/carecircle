// app/app/account/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type MembershipRow = {
  patient_id: string;
  role: string;
};

type CircleRow = {
  id: string;
  display_name: string;
};

export default function AccountPage() {
  const supabase = supabaseBrowser();

  const [uid, setUid] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [eligible, setEligible] = useState<Array<{ circle: CircleRow; role: string }>>([]);
  const [debug, setDebug] = useState<string[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setMsg(null);
      setDebug([]);
      setEligible([]);

      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const userId = data.user?.id ?? "";
        if (!userId) throw new Error("not_authenticated");

        if (!mounted) return;
        setUid(userId);

        // memberships
        debugLog("Loading patient_members roles for current user...");
        const { data: mems, error: memErr } = await supabase
          .from("patient_members")
          .select("patient_id, role")
          .eq("user_id", userId);

        if (memErr) throw memErr;

        const rows = (mems ?? []) as MembershipRow[];
        const eligibleRows = rows.filter((r) =>
          ["patient", "legal_guardian", "guardian"].includes(String(r.role))
        );

        const pids = eligibleRows.map((r) => r.patient_id).filter(Boolean);
        debugLog(`Eligible circles for Permissions: ${pids.length}`);

        if (pids.length === 0) {
          setEligible([]);
          return;
        }

        // circles
        const { data: circles, error: cErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", pids);

        if (cErr) throw cErr;

        const circleMap = new Map<string, CircleRow>();
        for (const c of (circles ?? []) as CircleRow[]) circleMap.set(c.id, c);

        const merged = eligibleRows
          .map((r) => {
            const circle = circleMap.get(r.patient_id);
            if (!circle) return null;
            return { circle, role: r.role };
          })
          .filter(Boolean) as Array<{ circle: CircleRow; role: string }>;

        if (!mounted) return;
        setEligible(merged);
      } catch (e: any) {
        if (!mounted) return;
        setMsg(e?.message ?? "account_load_failed");
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  async function signOut() {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (e: any) {
      setMsg(e?.message ?? "sign_out_failed");
    } finally {
      setBusy(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    textDecoration: "none",
    color: "inherit",
  };

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Account</h1>

      <div style={{ marginBottom: 12, opacity: 0.9 }}>
        <div>
          <strong>User:</strong> <code>{uid || "(loading...)"}</code>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Link href="/app/hub" style={btnStyle}>
          Go to Hub
        </Link>

        <Link href="/app/onboarding" style={btnStyle}>
          Manage circles
        </Link>

        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          style={{ padding: "10px 12px", border: "1px solid #ccc", borderRadius: 8 }}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>

      {/* ✅ Permissions section (only for patient / legal guardian / guardian) */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: "1px solid #e5e5e5",
          background: "rgba(0,0,0,0.02)",
          marginTop: 12,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Permissions</div>

        {eligible.length === 0 ? (
          <div style={{ opacity: 0.85 }}>
            No circles where you are the patient or legal guardian.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {eligible.map(({ circle, role }) => (
              <div
                key={circle.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "white",
                }}
              >
                <div style={{ fontWeight: 800 }}>{circle.display_name}</div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  role: <code>{role}</code> • pid: <code>{circle.id}</code>
                </div>

                <div style={{ marginTop: 10 }}>
                  <Link href={`/app/patients/${circle.id}/permissions`} style={btnStyle}>
                    Open permissions
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && (
        <p style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
          {msg}
        </p>
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