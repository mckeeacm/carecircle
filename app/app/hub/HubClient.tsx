"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleRow = {
  id: string;
  display_name: string;
};

export default function HubClient() {
  const supabase = supabaseBrowser();

  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [circles, setCircles] = useState<CircleRow[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setBusy(true);
      setMsg(null);

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const uid = auth.user?.id;
        if (!uid) {
          setMsg("not_authenticated");
          setCircles([]);
          return;
        }

        // Memberships: patient_members.patient_id
        const { data: memberships, error: memErr } = await supabase
          .from("patient_members")
          .select("patient_id")
          .eq("user_id", uid);

        if (memErr) throw memErr;

        const patientIds = (memberships ?? [])
          .map((m: any) => m.patient_id)
          .filter(Boolean);

        if (patientIds.length === 0) {
          setCircles([]);
          return;
        }

        // Patients: patients.display_name (canonical)
        const { data: patients, error: patErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", patientIds);

        if (patErr) throw patErr;

        if (!mounted) return;
        setCircles((patients ?? []) as CircleRow[]);
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

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Hub</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Link
          href="/app/account"
          style={{
            display: "inline-block",
            padding: "10px 12px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          Account
        </Link>

        <Link
          href="/app/onboarding"
          style={{
            display: "inline-block",
            padding: "10px 12px",
            border: "1px solid #ccc",
            borderRadius: 8,
            textDecoration: "none",
            color: "inherit",
          }}
        >
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
          {circles.map((c) => (
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
                <Link
                  href={`/app/patients/${c.id}/summary`}
                  style={{
                    display: "inline-block",
                    padding: "8px 10px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    textDecoration: "none",
                    color: "inherit",
                    fontSize: 13,
                  }}
                >
                  Summary
                </Link>

                <Link
                  href={`/app/patients/${c.id}/vault`}
                  style={{
                    display: "inline-block",
                    padding: "8px 10px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    textDecoration: "none",
                    color: "inherit",
                    fontSize: 13,
                  }}
                >
                  Vault
                </Link>

                <Link
                  href={`/app/patients/${c.id}/vault-init`}
                  style={{
                    display: "inline-block",
                    padding: "8px 10px",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    textDecoration: "none",
                    color: "inherit",
                    fontSize: 13,
                  }}
                >
                  Vault init
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}