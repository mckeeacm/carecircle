// app/app/patients/[id]/summary/SummaryClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type PatientRow = { id: string; display_name: string };

type PatientProfileRow = {
  patient_id: string;
  updated_at: string;
  communication_notes_encrypted: CipherEnvelopeV1 | null;
  allergies_encrypted: CipherEnvelopeV1 | null;
  safety_notes_encrypted: CipherEnvelopeV1 | null;
};

type MedicationRow = {
  id: string;
  name: string;
  dosage: string | null;
  schedule_text: string | null;
};

type AppointmentRow = {
  id: string;
  starts_at: string | null;
  title: string | null;
  location: string | null;
};

type JournalPreview = {
  id: string;
  created_at: string;
  journal_type: string;
  pain_level: number | null;
  shared_to_circle: boolean;
};

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function SummaryClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);

  const [commNotes, setCommNotes] = useState<string>("");
  const [allergies, setAllergies] = useState<string>("");
  const [safetyNotes, setSafetyNotes] = useState<string>("");
  const [profileUpdatedAt, setProfileUpdatedAt] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [sharedJournals, setSharedJournals] = useState<JournalPreview[]>([]);

  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .eq("id", patientId)
        .single();
      if (pErr) throw pErr;
      setPatient(p as PatientRow);

      // Patient profile (encrypted fields)
      const { data: pr, error: prErr } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, updated_at, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted"
        )
        .eq("patient_id", patientId)
        .maybeSingle();
      if (prErr) throw prErr;

      const row = (pr ?? null) as PatientProfileRow | null;
      setProfileUpdatedAt(row?.updated_at ?? null);

      // show placeholders if no vaultKey
      if (!row || !vaultKey) {
        setCommNotes("");
        setAllergies("");
        setSafetyNotes("");
      } else {
        const cn = row.communication_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId,
              column: "communication_notes_encrypted",
              env: row.communication_notes_encrypted,
              vaultKey,
            })
          : "";

        const al = row.allergies_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId,
              column: "allergies_encrypted",
              env: row.allergies_encrypted,
              vaultKey,
            })
          : "";

        const sn = row.safety_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: patientId,
              column: "safety_notes_encrypted",
              env: row.safety_notes_encrypted,
              vaultKey,
            })
          : "";

        setCommNotes(cn || "");
        setAllergies(al || "");
        setSafetyNotes(sn || "");
      }

      // Upcoming appointments (best effort)
      try {
        const { data: a, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, title, location")
          .eq("patient_id", patientId)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(5);
        if (aErr) throw aErr;
        setAppointments((a ?? []) as AppointmentRow[]);
      } catch {
        setAppointments([]);
      }

      // Active meds
      const { data: m, error: mErr } = await supabase
        .from("medications")
        .select("id, name, dosage, schedule_text")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(8);

      if (mErr) throw mErr;
      setMeds((m ?? []) as MedicationRow[]);

      // Recent shared journals (metadata only, no decrypt)
      const { data: j, error: jErr } = await supabase
        .from("journal_entries")
        .select("id, created_at, journal_type, pain_level, shared_to_circle")
        .eq("patient_id", patientId)
        .eq("shared_to_circle", true)
        .order("created_at", { ascending: false })
        .limit(5);

      if (jErr) throw jErr;
      setSharedJournals((j ?? []) as JournalPreview[]);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, !!vaultKey]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Clinician summary</h1>
            <div className="cc-subtle">{patient?.display_name ?? patientId}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
              Today
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/profile`}>
              Profile
            </Link>
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        {!vaultKey ? (
          <div className="cc-status cc-status-loading">
            <div className="cc-strong">Vault key not available on this device</div>
            <div className="cc-subtle">
              Encrypted profile fields won’t display until this device has vault access.
            </div>
          </div>
        ) : null}

        <div className="cc-grid-3">
          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Safety & communication</h2>
            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Communication notes</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {vaultKey ? (commNotes || "—") : "—"}
            </div>

            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Allergies</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {vaultKey ? (allergies || "—") : "—"}
            </div>

            <div className="cc-spacer-12" />

            <div className="cc-small cc-strong">Safety notes</div>
            <div className="cc-panel-soft cc-wrap" style={{ whiteSpace: "pre-wrap" }}>
              {vaultKey ? (safetyNotes || "—") : "—"}
            </div>

            <div className="cc-spacer-12" />
            <div className="cc-small">Last updated: {profileUpdatedAt ? new Date(profileUpdatedAt).toLocaleString() : "—"}</div>
          </div>

          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Upcoming appointments</h2>
            <div className="cc-spacer-12" />
            {appointments.length === 0 ? (
              <div className="cc-small">No upcoming appointments.</div>
            ) : (
              <div className="cc-stack">
                {appointments.map((a) => (
                  <div key={a.id} className="cc-panel-soft">
                    <div className="cc-strong">{a.title ?? "Appointment"}</div>
                    <div className="cc-small">
                      {(a.starts_at ? new Date(a.starts_at).toLocaleString() : "—") + (a.location ? ` • ${a.location}` : "")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cc-card cc-card-pad">
            <h2 className="cc-h2">Active medications</h2>
            <div className="cc-spacer-12" />
            {meds.length === 0 ? (
              <div className="cc-small">No active medications.</div>
            ) : (
              <div className="cc-stack">
                {meds.map((m) => (
                  <div key={m.id} className="cc-panel-soft">
                    <div className="cc-strong">
                      {m.name} {m.dosage ? <span className="cc-subtle">({m.dosage})</span> : null}
                    </div>
                    <div className="cc-small">{m.schedule_text || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <h2 className="cc-h2">Recent shared journal entries</h2>
            <Link className="cc-btn" href={`/app/patients/${patientId}/journals`}>
              Open journals
            </Link>
          </div>

          <div className="cc-spacer-12" />

          {sharedJournals.length === 0 ? (
            <div className="cc-small">No shared journal entries.</div>
          ) : (
            <div className="cc-stack">
              {sharedJournals.map((j) => (
                <div key={j.id} className="cc-panel-soft">
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">{j.journal_type}</div>
                      <div className="cc-small">{new Date(j.created_at).toLocaleString()}</div>
                    </div>
                    <div className="cc-row">
                      {j.pain_level != null ? <span className="cc-pill">pain: {j.pain_level}</span> : null}
                      <span className="cc-pill cc-pill-primary">shared</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="cc-spacer-12" />
          <div className="cc-small cc-subtle">
            Note: journal content is end-to-end encrypted and may not be shown here unless you enable decrypt with vault access.
          </div>
        </div>

        <div className="cc-row">
          <button className="cc-btn" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}