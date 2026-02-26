"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type PatientRow = {
  id: string;
  display_name: string | null;
};

type PatientProfileRow = {
  patient_id: string;

  communication_notes_encrypted: CipherEnvelopeV1 | null;
  allergies_encrypted: CipherEnvelopeV1 | null;
  safety_notes_encrypted: CipherEnvelopeV1 | null;

  created_at: string;
  updated_at: string;
};

type AppointmentRow = {
  id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string | null;
  title: string | null;
  location: string | null;
  provider: string | null;

  notes_encrypted: CipherEnvelopeV1 | null;

  status: string | null;
  created_by: string;
  created_at: string;
};

type MedicationRow = {
  id: string;
  patient_id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
  active: boolean | null;
  created_by: string;
  created_at: string;
};

type MedicationLogRow = {
  id: string;
  patient_id: string;
  medication_id: string;
  status: string | null;
  note: string | null; // still plaintext in DB today
  created_by: string;
  created_at: string;
};

type JournalRow = {
  id: string;
  patient_id: string;
  journal_type: string;
  occurred_at: string | null;
  created_by: string;
  created_at: string;
  shared_to_circle: boolean | null;
  pain_level: number | null;
  include_in_clinician_summary: boolean | null;

  content_encrypted: CipherEnvelopeV1 | null;
  mood_encrypted: CipherEnvelopeV1 | null;
};

type SobrietyRow = {
  id: string;
  patient_id: string;
  occurred_at: string | null;
  status: string | null;
  substance: string | null;
  intensity: number | null;
  note_encrypted: CipherEnvelopeV1 | null;
  created_by: string;
  created_at: string;
};

export default function SummaryClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [profile, setProfile] = useState<PatientProfileRow | null>(null);
  const [profilePlain, setProfilePlain] = useState<{ comm: string; allergies: string; safety: string } | null>(null);

  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([]);
  const [apptPlain, setApptPlain] = useState<Record<string, string>>({});

  const [activeMeds, setActiveMeds] = useState<MedicationRow[]>([]);
  const [recentMedLogs, setRecentMedLogs] = useState<MedicationLogRow[]>([]);

  const [summaryJournals, setSummaryJournals] = useState<JournalRow[]>([]);
  const [recentSobriety, setRecentSobriety] = useState<SobrietyRow[]>([]);

  const [journalPlain, setJournalPlain] = useState<Record<string, { mood: string; content: string }>>({});
  const [sobrietyPlain, setSobrietyPlain] = useState<Record<string, string>>({});

  async function loadAll() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .eq("id", patientId)
        .single();
      if (pErr) throw pErr;
      setPatient(p as PatientRow);

      const { data: prof, error: profErr } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted, created_at, updated_at"
        )
        .eq("patient_id", patientId)
        .maybeSingle();
      if (profErr) throw profErr;
      setProfile((prof ?? null) as PatientProfileRow | null);
      setProfilePlain(null); // reset decrypted view on refresh

      const { data: appts, error: aErr } = await supabase
        .from("appointments")
        .select(
          "id, patient_id, starts_at, ends_at, title, location, provider, notes_encrypted, status, created_by, created_at"
        )
        .eq("patient_id", patientId)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(10);
      if (aErr) throw aErr;
      setUpcomingAppointments((appts ?? []) as AppointmentRow[]);
      setApptPlain({}); // reset decrypted view on refresh

      const { data: meds, error: mErr } = await supabase
        .from("medications")
        .select("id, patient_id, name, dosage, schedule_text, active, created_by, created_at")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (mErr) throw mErr;
      setActiveMeds((meds ?? []) as MedicationRow[]);

      const { data: logs, error: lErr } = await supabase
        .from("medication_logs")
        .select("id, patient_id, medication_id, status, note, created_by, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (lErr) throw lErr;
      setRecentMedLogs((logs ?? []) as MedicationLogRow[]);

      const { data: j, error: jErr } = await supabase
        .from("journal_entries")
        .select(
          "id, patient_id, journal_type, occurred_at, created_by, created_at, shared_to_circle, pain_level, include_in_clinician_summary, content_encrypted, mood_encrypted"
        )
        .eq("patient_id", patientId)
        .eq("include_in_clinician_summary", true)
        .order("created_at", { ascending: false })
        .limit(30);
      if (jErr) throw jErr;
      setSummaryJournals((j ?? []) as JournalRow[]);

      const { data: s, error: sErr } = await supabase
        .from("sobriety_logs")
        .select("id, patient_id, occurred_at, status, substance, intensity, note_encrypted, created_by, created_at")
        .eq("patient_id", patientId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30);
      if (sErr) throw sErr;
      setRecentSobriety((s ?? []) as SobrietyRow[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  async function decryptProfile() {
    if (!vaultKey || !profile) return;

    const comm = profile.communication_notes_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "patient_profiles",
          rowId: profile.patient_id,
          column: "communication_notes_encrypted",
          env: profile.communication_notes_encrypted,
          vaultKey,
        })
      : "";

    const allergies = profile.allergies_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "patient_profiles",
          rowId: profile.patient_id,
          column: "allergies_encrypted",
          env: profile.allergies_encrypted,
          vaultKey,
        })
      : "";

    const safety = profile.safety_notes_encrypted
      ? await decryptStringWithLocalCache({
          patientId,
          table: "patient_profiles",
          rowId: profile.patient_id,
          column: "safety_notes_encrypted",
          env: profile.safety_notes_encrypted,
          vaultKey,
        })
      : "";

    setProfilePlain({ comm, allergies, safety });
  }

  async function decryptAppointmentNotes(a: AppointmentRow) {
    if (!vaultKey || !a.notes_encrypted) return;

    const notes = await decryptStringWithLocalCache({
      patientId,
      table: "appointments",
      rowId: a.id,
      column: "notes_encrypted",
      env: a.notes_encrypted,
      vaultKey,
    });

    setApptPlain((prev) => ({ ...prev, [a.id]: notes }));
  }

  async function decryptJournalRow(row: JournalRow) {
    if (!vaultKey) return;
    if (!row.content_encrypted || !row.mood_encrypted) return;

    const mood = await decryptStringWithLocalCache({
      patientId,
      table: "journal_entries",
      rowId: row.id,
      column: "mood_encrypted",
      env: row.mood_encrypted,
      vaultKey,
    });

    const content = await decryptStringWithLocalCache({
      patientId,
      table: "journal_entries",
      rowId: row.id,
      column: "content_encrypted",
      env: row.content_encrypted,
      vaultKey,
    });

    setJournalPlain((prev) => ({ ...prev, [row.id]: { mood, content } }));
  }

  async function decryptSobrietyRow(row: SobrietyRow) {
    if (!vaultKey || !row.note_encrypted) return;

    const note = await decryptStringWithLocalCache({
      patientId,
      table: "sobriety_logs",
      rowId: row.id,
      column: "note_encrypted",
      env: row.note_encrypted,
      vaultKey,
    });

    setSobrietyPlain((prev) => ({ ...prev, [row.id]: note }));
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Clinician summary</h2>
          <div style={{ opacity: 0.8 }}>
            Patient: <b>{patient?.display_name ?? patientId}</b>
          </div>
        </div>

        <button onClick={loadAll} disabled={loading} style={{ padding: "8px 10px", borderRadius: 10 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {msg && (
        <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginTop: 12 }}>
          {msg}
        </div>
      )}

      {!vaultKey && (
        <div style={{ border: "1px solid #f0c", padding: 10, borderRadius: 10, marginTop: 12 }}>
          <b>E2EE vault key not available.</b> Encrypted fields cannot be decrypted on this device.
        </div>
      )}

      {/* Profile (E2EE) */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h3 style={{ margin: 0 }}>Profile notes</h3>
          <span style={pillOk}>E2EE</span>
        </div>

        {!profile ? (
          <div style={{ opacity: 0.7 }}>No profile row.</div>
        ) : (
          <>
            <button
              onClick={decryptProfile}
              disabled={!vaultKey || !!profilePlain}
              style={{ padding: "6px 10px", borderRadius: 10, marginBottom: 10 }}
            >
              {profilePlain ? "Decrypted" : "Decrypt profile"}
            </button>

            {profilePlain ? (
              <div style={{ display: "grid", gap: 10 }}>
                <Field label="Communication notes" value={profilePlain.comm} />
                <Field label="Allergies" value={profilePlain.allergies} />
                <Field label="Safety notes" value={profilePlain.safety} />
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.7 }}>Encrypted. Click decrypt.</div>
            )}
          </>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {/* Upcoming appointments (E2EE notes) */}
        <section style={cardStyle}>
          <div style={cardHeaderStyle}>
            <h3 style={{ margin: 0 }}>Upcoming appointments</h3>
            <span style={pillOk}>notes E2EE</span>
          </div>

          {upcomingAppointments.length === 0 ? (
            <div style={{ opacity: 0.7 }}>None scheduled.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {upcomingAppointments.map((a) => {
                const plain = apptPlain[a.id];
                return (
                  <div key={a.id} style={itemStyle}>
                    <div style={{ fontWeight: 700 }}>{a.title ?? "Appointment"}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {new Date(a.starts_at).toLocaleString()}
                      {a.ends_at ? ` → ${new Date(a.ends_at).toLocaleString()}` : ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {a.provider ? `Provider: ${a.provider}` : ""}
                      {a.location ? ` • ${a.location}` : ""}
                      {a.status ? ` • ${a.status}` : ""}
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => decryptAppointmentNotes(a)}
                        disabled={!vaultKey || !!plain || !a.notes_encrypted}
                        style={{ padding: "6px 10px", borderRadius: 10 }}
                      >
                        {plain ? "Decrypted" : "Decrypt notes"}
                      </button>
                    </div>

                    {plain ? (
                      <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{plain || "—"}</div>
                    ) : (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                        {a.notes_encrypted ? "Encrypted. Click decrypt." : "No notes."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Medications */}
        <section style={cardStyle}>
          <div style={cardHeaderStyle}>
            <h3 style={{ margin: 0 }}>Active medications</h3>
          </div>

          {activeMeds.length === 0 ? (
            <div style={{ opacity: 0.7 }}>None active.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {activeMeds.map((m) => (
                <div key={m.id} style={itemStyle}>
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {m.dosage ? `Dosage: ${m.dosage}` : ""}
                    {m.schedule_text ? ` • ${m.schedule_text}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Recent medication logs</div>
            {recentMedLogs.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No logs.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {recentMedLogs.map((l) => (
                  <div key={l.id} style={itemStyle}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {new Date(l.created_at).toLocaleString()} • med:{l.medication_id}
                      {l.status ? ` • ${l.status}` : ""}
                    </div>
                    {l.note ? (
                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                        <span style={pillWarnInline}>note plaintext (not yet E2EE)</span> {l.note}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Journals for clinician summary (E2EE) */}
      <section style={{ ...cardStyle, marginTop: 12 }}>
        <div style={cardHeaderStyle}>
          <h3 style={{ margin: 0 }}>Clinician summary journals</h3>
          <span style={pillOk}>E2EE</span>
        </div>

        {summaryJournals.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No entries flagged for clinician summary.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {summaryJournals.map((j) => {
              const plain = journalPlain[j.id];
              return (
                <div key={j.id} style={itemStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                      <b>{j.journal_type}</b> • {new Date(j.created_at).toLocaleString()}
                      {j.pain_level != null ? ` • pain:${j.pain_level}` : ""}
                      {j.shared_to_circle ? " • shared" : " • private"}
                    </div>

                    <button
                      onClick={() => decryptJournalRow(j)}
                      disabled={!vaultKey || !!plain || !j.content_encrypted || !j.mood_encrypted}
                      style={{ padding: "6px 10px", borderRadius: 10 }}
                    >
                      {plain ? "Decrypted" : "Decrypt"}
                    </button>
                  </div>

                  {plain ? (
                    <>
                      <div style={{ marginTop: 8 }}>
                        <b>Mood:</b> {plain.mood || "—"}
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{plain.content || "—"}</div>
                    </>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                      Encrypted. Click “Decrypt” on a device with vault access.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sobriety (E2EE note) */}
      <section style={{ ...cardStyle, marginTop: 12 }}>
        <div style={cardHeaderStyle}>
          <h3 style={{ margin: 0 }}>Sobriety logs</h3>
          <span style={pillOk}>note E2EE</span>
        </div>

        {recentSobriety.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No sobriety logs.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {recentSobriety.map((s) => {
              const plain = sobrietyPlain[s.id];
              const when = s.occurred_at ?? s.created_at;
              return (
                <div key={s.id} style={itemStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                      <b>{s.status ?? "—"}</b>
                      {s.substance ? ` • ${s.substance}` : ""}
                      {s.intensity != null ? ` • intensity:${s.intensity}` : ""}
                      {" • "}
                      {new Date(when).toLocaleString()}
                    </div>

                    <button
                      onClick={() => decryptSobrietyRow(s)}
                      disabled={!vaultKey || !!plain || !s.note_encrypted}
                      style={{ padding: "6px 10px", borderRadius: 10 }}
                    >
                      {plain ? "Decrypted" : "Decrypt"}
                    </button>
                  </div>

                  {plain ? (
                    <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{plain || "—"}</div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                      Encrypted note. Click “Decrypt” on a device with vault access.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{value ?? "—"}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
};

const itemStyle: React.CSSProperties = {
  border: "1px solid #f3f3f3",
  borderRadius: 12,
  padding: 10,
};

const pillBase: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #ddd",
  opacity: 0.9,
  whiteSpace: "nowrap",
};

const pillOk: React.CSSProperties = {
  ...pillBase,
  background: "#e7ffe7",
};

const pillWarnInline: React.CSSProperties = {
  ...pillBase,
  background: "#fff3cd",
  marginRight: 6,
};