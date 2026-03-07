"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Membership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
};

type PatientRow = {
  id: string;
  display_name: string | null;
  created_at: string;
};

function safeBool(v: unknown) {
  return v === true;
}

export default function PatientDashboardPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const params = useParams();
  const patientId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [membership, setMembership] = useState<Membership | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  async function load() {
    if (!patientId) return;

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
        .select("patient_id, role, nickname, is_controller")
        .eq("patient_id", patientId)
        .eq("user_id", uid)
        .maybeSingle();

      if (memErr) throw memErr;
      if (!mem) {
        setMsg("You do not have access to this circle.");
        return;
      }

      setMembership(mem as Membership);

      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name, created_at")
        .eq("id", patientId)
        .maybeSingle();

      if (pErr) throw pErr;
      setPatient(p as PatientRow);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_patient");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (loading) {
    return (
      <div style={page}>
        <div style={shell}>
          <div style={card}>Loading patient dashboard…</div>
        </div>
      </div>
    );
  }

  if (msg) {
    return (
      <div style={page}>
        <div style={shell}>
          <div style={errorBox}>{msg}</div>
        </div>
      </div>
    );
  }

  const isController = safeBool(membership?.is_controller);

  return (
    <div style={page}>
      <div style={shell}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
            <div id="patient-name" style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>
              {patient?.display_name ?? patientId}
            </div>

            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={pill}>Role: <b>{membership?.role ?? "—"}</b></span>
              {membership?.nickname ? <span style={pill}>Nickname: <b>{membership.nickname}</b></span> : null}
              {isController ? <span style={pillController}>Controller</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={secondaryBtn} onClick={() => router.push("/hub")}>Back to Hub</button>
          </div>
        </div>

        <div style={grid}>
          <button id="nav-journals" style={cardBtn} onClick={() => router.push(`/patients/${patientId}/journals`)}>
            <div style={btnTitle}>Journals</div>
            <div style={btnDesc}>Encrypted journal entries, mood and pain tracking.</div>
          </button>

          <button id="nav-dm" style={cardBtn} onClick={() => router.push(`/patients/${patientId}/dm`)}>
            <div style={btnTitle}>Direct Messages</div>
            <div style={btnDesc}>1-to-1 encrypted messaging within this circle.</div>
          </button>

          <button id="nav-meds" style={cardBtn} onClick={() => router.push(`/patients/${patientId}/medication-logs`)}>
            <div style={btnTitle}>Medications</div>
            <div style={btnDesc}>Due and overdue doses, taken logs, secure notes.</div>
          </button>

          <button id="nav-appointments" style={cardBtn} onClick={() => router.push(`/patients/${patientId}/appointments`)}>
            <div style={btnTitle}>Appointments</div>
            <div style={btnDesc}>Upcoming and past appointments.</div>
          </button>

          <button id="nav-summary" style={cardBtn} onClick={() => router.push(`/patients/${patientId}/summary`)}>
            <div style={btnTitle}>Clinician Summary</div>
            <div style={btnDesc}>Structured overview designed for professional review.</div>
          </button>

          {isController ? (
            <button id="nav-permissions" style={cardBtnStrong} onClick={() => router.push(`/patients/${patientId}/permissions`)}>
              <div style={btnTitle}>Permissions</div>
              <div style={btnDesc}>Manage roles and per-member overrides.</div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* styles */
const page: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(180deg, #fbfbfb 0%, #f6f6f6 100%)" };
const shell: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: 18 };

const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 16 };

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 };

const card: React.CSSProperties = { border: "1px solid #eaeaea", borderRadius: 16, padding: 16, background: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,0.04)" };

const cardBtn: React.CSSProperties = { ...card, textAlign: "left", cursor: "pointer" };
const cardBtnStrong: React.CSSProperties = { ...cardBtn, border: "1px solid #111" };

const btnTitle: React.CSSProperties = { fontWeight: 900, fontSize: 16 };
const btnDesc: React.CSSProperties = { fontSize: 13, opacity: 0.8, marginTop: 6 };

const pill: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 999, border: "1px solid #ddd", background: "#fafafa" };
const pillController: React.CSSProperties = { ...pill, background: "#e7ffe7", border: "1px solid #cfe9cf", fontWeight: 900 };

const secondaryBtn: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 900, cursor: "pointer" };

const errorBox: React.CSSProperties = { border: "1px solid #c33", borderRadius: 14, padding: 12, background: "#fff5f5", color: "#900", fontWeight: 700 };