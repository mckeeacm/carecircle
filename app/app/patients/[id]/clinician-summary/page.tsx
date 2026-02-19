"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ClinicianSummaryPage() {
  const { id } = useParams();
  const pid = String(id ?? "");

  const [profile, setProfile] = useState<any>(null);
  const [meds, setMeds] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);

  useEffect(() => {
    if (!pid) return;

    async function load() {
      const prof = await supabase.from("patient_profiles").select("*").eq("patient_id", pid).single();
      if (!prof.error) setProfile(prof.data);

      const meds = await supabase.from("medications").select("*").eq("patient_id", pid).eq("active", true);
      if (!meds.error) setMeds(meds.data ?? []);

      const j = await supabase
        .from("journal_entries")
        .select("*")
        .eq("patient_id", pid)
        .eq("include_in_clinician_summary", true)
        .order("occurred_at", { ascending: false })
        .limit(10);

      if (!j.error) setJournals(j.data ?? []);
    }

    load();
  }, [pid]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <h1 className="cc-h1">Clinician Summary</h1>
        </div>

        <Section title="Care profile">
          <div><b>Communication:</b> {profile?.communication_notes ?? "—"}</div>
          <div><b>Allergies:</b> {profile?.allergies ?? "—"}</div>
          <div><b>Safety:</b> {profile?.safety_notes ?? "—"}</div>
        </Section>

        <Section title="Active medications">
          {meds.length === 0 ? "None" : meds.map(m => (
            <div key={m.id}>
              <b>{m.name}</b> — {m.dosage ?? "—"} ({m.schedule_text ?? "—"})
            </div>
          ))}
        </Section>

        <Section title="Recent clinician notes">
          {journals.length === 0 ? "None" : journals.map(j => (
            <div key={j.id}>
              <b>{new Date(j.occurred_at).toLocaleDateString()}</b>
              <div>{j.content}</div>
            </div>
          ))}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="cc-card cc-card-pad">
      <h2 className="cc-h2">{title}</h2>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
