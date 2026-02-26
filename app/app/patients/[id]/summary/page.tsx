"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type PatientRow = {
  id: string;
  display_name: string | null;
  created_at: string;
};

type ProfileRow = {
  patient_id: string;
  communication_notes: string | null;
  allergies: string | null;
  safety_notes: string | null;
  created_at: string;
  updated_at: string;
};

type AppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  title: string | null;
  location: string | null;
  provider: string | null;
  notes: string | null;
  status: string | null;
  created_at: string;
};

type MedicationRow = {
  id: string;
  name: string | null;
  dosage: string | null;
  schedule_text: string | null;
  active: boolean | null;
  created_at: string;
};

type JournalRow = {
  id: string;
  journal_type: string;
  occurred_at: string | null;
  created_at: string;
  shared_to_circle: boolean;
  pain_level: number | null;
  include_in_clinician_summary: boolean | null;
  // NOTE: content/mood are encrypted in your new approach, but we do NOT assume columns here.
  // This page is "structured summary", so we only show safe metadata unless you later add encrypted fields + vault.
};

export default function ClinicianSummaryPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const params = useParams();
  const patientId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([]);
  const [activeMeds, setActiveMeds] = useState<MedicationRow[]>([]);
  const [recentSharedJournals, setRecentSharedJournals] = useState<JournalRow[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMsg(null);

      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) {
          router.push("/login");
          return;
        }

        // Patient basic
        const { data: p, error: pErr } = await supabase
          .from("patients")
          .select("id, display_name, created_at")
          .eq("id", patientId)
          .maybeSingle();
        if (pErr) throw pErr;
        setPatient((p ?? null) as PatientRow | null);

        // Patient profile (sensitive fields are plaintext in DB currently; if you later encrypt these columns,
        // we can swap to encrypted reads using the vaultKey.)
        const { data: prof, error: profErr } = await supabase
          .from("patient_profiles")
          .select("patient_id, communication_notes, allergies, safety_notes, created_at, updated_at")
          .eq("patient_id", patientId)
          .maybeSingle();
        if (profErr) throw profErr;
        setProfile((prof ?? null) as ProfileRow | null);

        // Upcoming appointments
        const nowIso = new Date().toISOString();
        const { data: appts, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, ends_at, title, location, provider, notes, status, created_at")
          .eq("patient_id", patientId)
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(10);
        if (aErr) throw aErr;
        setUpcomingAppointments((appts ?? []) as AppointmentRow[]);

        // Active meds
        const { data: meds, error: mErr } = await supabase
          .from("medications")
          .select("id, name, dosage, schedule_text, active, created_at")
          .eq("patient_id", patientId)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(20);
        if (mErr) throw mErr;
        setActiveMeds((meds ?? []) as MedicationRow[]);

        // Recent shared journals (metadata only; content is encrypted elsewhere in your plan)
        const { data: js, error: jErr } = await supabase
          .from("journal_entries")
          .select(
            "id, journal_type, occurred_at, created_at, shared_to_circle, pain_level, include_in_clinician_summary"
          )
          .eq("patient_id", patientId)
          .eq("shared_to_circle", true)
          .order("created_at", { ascending: false })
          .limit(20);
        if (jErr) throw jErr;
        setRecentSharedJournals((js ?? []) as JournalRow[]);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_summary");
      } finally {
        setLoading(false);
      }
    }

    if (patientId) load();
  }, [patientId, router, supabase]);

  if (loading) {
    return (
      <div style={page}>
        <div style={shell}>
          <div style={card}>Loading summary…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={shell}>
        <div style={topRow}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>
              Clinician summary
            </div>
            <div style={{ marginTop: 6, fontWeight: 900 }}>
              {patient?.display_name ?? patientId}
            </div>
          </div>

          <button style={secondaryBtn} onClick={() => router.push(`/patients/${patientId}`)}>
            Back
          </button>
        </div>

        {msg && <div style={errorBox}>{msg}</div>}

        <div style={grid}>
          <div style={card}>
            <div style={sectionTitle}>Safety & communication</div>
            <Field label="Communication notes" value={profile?.communication_notes} />
            <Field label="Allergies" value={profile?.allergies} />
            <Field label="Safety notes" value={profile?.safety_notes} />
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
              Last updated: {profile?.updated_at ? new Date(profile.updated_at).toLocaleString() : "—"}
            </div>
          </div>

          <div style={card}>
            <div style={sectionTitle}>Upcoming appointments</div>
            {upcomingAppointments.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No upcoming appointments.</div>
            ) : (
              upcomingAppointments.map((a) => (
                <div key={a.id} style={listItem}>
                  <div style={{ fontWeight: 900 }}>{a.title ?? "Appointment"}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {new Date(a.starts_at).toLocaleString()}
                    {a.location ? ` • ${a.location}` : ""}
                    {a.provider ? ` • ${a.provider}` : ""}
                  </div>
                  {a.status ? <div style={{ fontSize: 12, opacity: 0.7 }}>Status: {a.status}</div> : null}
                </div>
              ))
            )}
          </div>

          <div style={card}>
            <div style={sectionTitle}>Active medications</div>
            {activeMeds.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No active medications.</div>
            ) : (
              activeMeds.map((m) => (
                <div key={m.id} style={listItem}>
                  <div style={{ fontWeight: 900 }}>{m.name ?? "Medication"}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {m.dosage ?? "—"}
                    {m.schedule_text ? ` • ${m.schedule_text}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={card}>
            <div style={sectionTitle}>Recent shared journal entries</div>
            {recentSharedJournals.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No shared journal entries.</div>
            ) : (
              recentSharedJournals.map((j) => (
                <div key={j.id} style={listItem}>
                  <div style={{ fontWeight: 900 }}>{j.journal_type}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {new Date(j.created_at).toLocaleString()}
                    {j.pain_level != null ? ` • pain ${j.pain_level}` : ""}
                    {j.include_in_clinician_summary ? " • marked for summary" : ""}
                  </div>
                </div>
              ))
            )}
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
              Note: journal content is end-to-end encrypted and may not be shown here unless you enable decrypt with vault access.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 800, whiteSpace: "pre-wrap" }}>{value?.trim() ? value : "—"}</div>
    </div>
  );
}

/* styles */
const page: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #fbfbfb 0%, #f6f6f6 100%)",
};

const shell: React.CSSProperties = {
  maxWidth: 1040,
  margin: "0 auto",
  padding: 18,
};

const topRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
  marginBottom: 16,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 14,
};

const card: React.CSSProperties = {
  border: "1px solid #eaeaea",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
  boxShadow: "0 6px 24px rgba(0,0,0,0.04)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  fontWeight: 900,
  marginBottom: 12,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const listItem: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 10,
  marginBottom: 8,
  background: "#fff",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const errorBox: React.CSSProperties = {
  border: "1px solid #c33",
  borderRadius: 14,
  padding: 12,
  background: "#fff5f5",
  color: "#900",
  fontWeight: 800,
};