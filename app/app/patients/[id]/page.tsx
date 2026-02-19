"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string;
  display_name: string;
};

export default function PatientOverviewPage() {
  const params = useParams();
  const pid = String(params?.id ?? "");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [medCount, setMedCount] = useState(0);
  const [apptCount, setApptCount] = useState(0);
  const [journalCount, setJournalCount] = useState(0);

  useEffect(() => {
    if (!pid) return;

    async function load() {
      const p = await supabase.from("patients").select("*").eq("id", pid).single();
      if (!p.error) setPatient(p.data);

      const prof = await supabase.from("patient_profiles").select("*").eq("patient_id", pid).single();
      if (!prof.error) setProfile(prof.data);

      const meds = await supabase.from("medications").select("id", { count: "exact" }).eq("patient_id", pid);
      if (!meds.error) setMedCount(meds.count ?? 0);

      const appts = await supabase.from("appointments").select("id", { count: "exact" }).eq("patient_id", pid);
      if (!appts.error) setApptCount(appts.count ?? 0);

      const journals = await supabase.from("journal_entries").select("id", { count: "exact" }).eq("patient_id", pid);
      if (!journals.error) setJournalCount(journals.count ?? 0);
    }

    load();
  }, [pid]);

  if (!patient) return <div className="cc-container">Loading…</div>;

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <h1 className="cc-h1">{patient.display_name}</h1>
          <div className="cc-subtle">Circle overview</div>
        </div>

        <div className="cc-grid-3">
          <Card label="Active meds" value={medCount} />
          <Card label="Appointments" value={apptCount} />
          <Card label="Journal entries" value={journalCount} />
        </div>

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Care profile</h2>
          <div className="cc-small">Communication</div>
          <div>{profile?.communication_notes ?? "—"}</div>

          <div className="cc-small" style={{ marginTop: 12 }}>Allergies</div>
          <div>{profile?.allergies ?? "—"}</div>

          <div className="cc-small" style={{ marginTop: 12 }}>Safety notes</div>
          <div>{profile?.safety_notes ?? "—"}</div>
        </div>

        <div className="cc-row">
          <Link className="cc-btn" href={`./permissions`}>Permissions</Link>
          <Link className="cc-btn" href={`./clinician-summary`}>Clinician summary</Link>
        </div>
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="cc-card cc-card-pad">
      <div className="cc-small">{label}</div>
      <div className="cc-h1">{value}</div>
    </div>
  );
}
