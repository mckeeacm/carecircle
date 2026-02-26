"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BubbleTour } from "@/app/_components/BubbleTour";
import { hubControllerSteps, hubMemberSteps } from "@/lib/tours";
import { restartAllTours } from "@/lib/tourReset";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string;
};

type PatientRow = {
  id: string;
  display_name: string | null;
  created_at: string;
};

function safeBool(v: unknown) {
  return v === true;
}

export default function HubPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<CircleMembership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  const [isControllerAnywhere, setIsControllerAnywhere] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        router.push("/login");
        return;
      }

      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ms = (mem ?? []) as CircleMembership[];
      setMemberships(ms);
      setIsControllerAnywhere(ms.some((m) => safeBool(m.is_controller)));

      if (ms.length === 0) {
        router.push("/onboarding");
        return;
      }

      const ids = Array.from(new Set(ms.map((m) => m.patient_id)));
      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name, created_at")
        .in("id", ids);

      if (pErr) throw pErr;

      const map: Record<string, PatientRow> = {};
      (pts ?? []).forEach((p: any) => (map[p.id] = p as PatientRow));
      setPatientsById(map);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_hub");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div style={page}>
        <div style={shell}>
          <div style={card}>Loading hub…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={shell}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
          <div id="hub-title" style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>
            Hub
          </div>
        </div>

        {msg && <div style={errorBox}>{msg}</div>}

        <div style={topBar}>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            You’re in <b>{memberships.length}</b> circle{memberships.length === 1 ? "" : "s"}.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              id="create-circle-btn"
              onClick={() => router.push("/onboarding")}
              style={secondaryBtn}
              title="Create or select circles"
            >
              Create / Select
            </button>

            <button
              id="account-link"
              onClick={() => router.push("/account")}
              style={secondaryBtn}
              title="Account & encryption"
            >
              Account
            </button>

            <button
              onClick={() => {
                restartAllTours();
                location.reload();
              }}
              style={secondaryBtn}
              title="Restart guided tours"
            >
              Restart tour
            </button>
          </div>
        </div>

        <div style={grid}>
          {memberships.map((m) => {
            const p = patientsById[m.patient_id];
            const name = p?.display_name ?? m.patient_id;

            return (
              <div key={m.patient_id} className="circle-card" style={circleCard}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.2 }}>{name}</div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={pill}>Role: <b>{m.role ?? "—"}</b></span>
                      {m.nickname ? <span style={pill}>Nickname: <b>{m.nickname}</b></span> : null}
                      {safeBool(m.is_controller) ? <span style={pillController}>Controller</span> : null}
                    </div>
                  </div>

                  <button onClick={() => router.push(`/patients/${m.patient_id}`)} style={primaryBtn}>
                    Open
                  </button>
                </div>

                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <button style={actionBtn} onClick={() => router.push(`/patients/${m.patient_id}/journals`)}>Journals</button>
                  <button style={actionBtn} onClick={() => router.push(`/patients/${m.patient_id}/dm`)}>Direct messages</button>
                  <button style={actionBtn} onClick={() => router.push(`/patients/${m.patient_id}/medication-logs`)}>Medications</button>
                  <button style={actionBtn} onClick={() => router.push(`/patients/${m.patient_id}/appointments`)}>Appointments</button>
                </div>
              </div>
            );
          })}
        </div>

        <BubbleTour
          tourId={isControllerAnywhere ? "hub-controller-v1" : "hub-member-v1"}
          steps={isControllerAnywhere ? hubControllerSteps : hubMemberSteps}
          autoStart
        />
      </div>
    </div>
  );
}

/* styles */
const page: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(180deg, #fbfbfb 0%, #f6f6f6 100%)" };
const shell: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: 18 };

const card: React.CSSProperties = {
  border: "1px solid #eaeaea",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
  boxShadow: "0 6px 24px rgba(0,0,0,0.04)",
};

const topBar: React.CSSProperties = { ...card, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" };

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginTop: 14 };

const circleCard: React.CSSProperties = { ...card, padding: 14 };

const primaryBtn: React.CSSProperties = { padding: "10px 14px", borderRadius: 12, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 900, cursor: "pointer" };
const secondaryBtn: React.CSSProperties = { padding: "10px 14px", borderRadius: 12, border: "1px solid #ddd", background: "#fff", color: "#111", fontWeight: 900, cursor: "pointer" };
const actionBtn: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, border: "1px solid #eee", background: "#fff", fontWeight: 900, cursor: "pointer", textAlign: "left" };

const pill: React.CSSProperties = { fontSize: 12, padding: "3px 10px", borderRadius: 999, border: "1px solid #ddd", background: "#fafafa", whiteSpace: "nowrap" };
const pillController: React.CSSProperties = { ...pill, background: "#e7ffe7", border: "1px solid #cfe9cf", fontWeight: 900 };

const errorBox: React.CSSProperties = { border: "1px solid #c33", borderRadius: 14, padding: 12, background: "#fff5f5", color: "#900", marginBottom: 12, fontWeight: 700 };