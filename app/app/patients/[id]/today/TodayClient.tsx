"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type JournalRow = {
  id: string;
  created_at: string;
  journal_type: string;
  shared_to_circle: boolean;
};

type AppointmentRow = {
  id: string;
  starts_at: string;
  title: string | null;
};

type MedicationRow = {
  id: string;
  name: string;
  dosage: string;
  schedule_text: string;
  active: boolean;
  created_at: string;
};

type MedicationLogRow = {
  id: string;
  medication_id: string;
  status: string;
  created_at: string;
  note_encrypted: CipherEnvelopeV1 | null;
};

export default function TodayClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [appts, setAppts] = useState<AppointmentRow[]>([]);
  const [meds, setMeds] = useState<MedicationRow[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLogRow[]>([]);
  const [medById, setMedById] = useState<Record<string, MedicationRow>>({});
  const [notePlainByLogId, setNotePlainByLogId] = useState<Record<string, string>>({});

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  async function decryptMedLogNote(l: MedicationLogRow) {
    if (!vaultKey) return;
    if (!l.note_encrypted) return;
    if (notePlainByLogId[l.id] != null) return;

    const plain = await decryptStringWithLocalCache({
      patientId,
      table: "medication_logs",
      rowId: l.id,
      column: "note_encrypted",
      env: l.note_encrypted,
      vaultKey,
    });

    setNotePlainByLogId((prev) => ({ ...prev, [l.id]: plain }));
  }

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setMsg(null);
      setDebug([]);
      setJournals([]);
      setAppts([]);
      setMeds([]);
      setMedLogs([]);
      setMedById({});
      setNotePlainByLogId({});

      try {
        // Auth + membership check (label-stable)
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const uid = auth.user?.id;
        if (!uid) throw new Error("not_authenticated");

        const { data: pm, error: pmErr } = await supabase
          .from("patient_members")
          .select("role, is_controller")
          .eq("patient_id", patientId)
          .eq("user_id", uid)
          .maybeSingle();

        if (pmErr) throw pmErr;
        if (!pm) throw new Error("not_a_circle_member");

        debugLog(`Membership ok role=${pm.role ?? "null"} controller=${String(pm.is_controller)}`);

        // DMs (best-effort; will work after RLS recursion fix)
        debugLog("Loading dm_threads for this circle...");
        const { error: dmErr } = await supabase
          .from("dm_threads")
          .select("id")
          .eq("patient_id", patientId)
          .limit(1);

        if (dmErr) debugLog(`dm_threads error: ${dmErr.message}`);
        else debugLog("dm_threads ok");

        // Journals
        debugLog("Loading newest journal_entries...");
        const { data: j, error: jErr } = await supabase
          .from("journal_entries")
          .select("id, created_at, journal_type, shared_to_circle")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (jErr) throw jErr;
        if (!mounted) return;
        setJournals((j ?? []) as any);
        debugLog(`journal_entries loaded: ${(j ?? []).length}`);

        // Appointments next 24h (only if your table actually exists with starts_at/title)
        const start = new Date();
        const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
        debugLog(`Loading appointments in next 24h window: ${start.toISOString()} -> ${end.toISOString()}`);

        const { data: a, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, title")
          .eq("patient_id", patientId)
          .gte("starts_at", start.toISOString())
          .lte("starts_at", end.toISOString())
          .order("starts_at", { ascending: true })
          .limit(10);

        if (aErr) {
          debugLog(`appointments error: ${aErr.message}`);
        } else {
          if (!mounted) return;
          setAppts((a ?? []) as any);
          debugLog(`appointments loaded: ${(a ?? []).length}`);
        }

        // Medications (confirmed schema)
        debugLog("Loading active medications...");
        const { data: m, error: mErr } = await supabase
          .from("medications")
          .select("id, name, dosage, schedule_text, active, created_at")
          .eq("patient_id", patientId)
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(25);

        if (mErr) {
          debugLog(`medications error: ${mErr.message}`);
        } else {
          const list = (m ?? []) as any as MedicationRow[];
          const map: Record<string, MedicationRow> = {};
          for (const row of list) map[row.id] = row;
          if (!mounted) return;
          setMeds(list);
          setMedById(map);
          debugLog(`medications loaded: ${list.length}`);
        }

        // Medication logs (confirmed schema)
        debugLog("Loading recent medication_logs...");
        const { data: ml, error: mlErr } = await supabase
          .from("medication_logs")
          .select("id, medication_id, status, created_at, note_encrypted")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(10);

        if (mlErr) {
          debugLog(`medication_logs error: ${mlErr.message}`);
        } else {
          const list = (ml ?? []) as any as MedicationLogRow[];
          if (!mounted) return;
          setMedLogs(list);
          debugLog(`medication_logs loaded: ${list.length}`);
        }

        debugLog("Today load complete.");
      } catch (e: any) {
        if (!mounted) return;
        setMsg(e?.message ?? "today_load_failed");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [supabase, patientId]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Today</h2>

      {msg && <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>{msg}</div>}
      {loading ? <div style={{ opacity: 0.7, marginBottom: 12 }}>Loading…</div> : null}

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <b>Newest journals</b>
        {journals.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>None yet.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {journals.map((j) => (
              <div key={j.id} style={{ border: "1px solid #f3f3f3", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 13 }}>
                  <b>{j.journal_type}</b> • {new Date(j.created_at).toLocaleString()} •{" "}
                  {j.shared_to_circle ? "shared" : "private"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <b>Next 24h appointments</b>
        {appts.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>None in the next 24 hours.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {appts.map((a) => (
              <div key={a.id} style={{ border: "1px solid #f3f3f3", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 13 }}>
                  <b>{a.title ?? "Appointment"}</b> • {new Date(a.starts_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <b>Active medications</b>
        {meds.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>No active medications.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {meds.map((m) => (
              <div key={m.id} style={{ border: "1px solid #f3f3f3", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 13 }}>
                  <b>{m.name}</b>
                  {m.dosage ? ` (${m.dosage})` : ""}
                </div>
                {m.schedule_text ? (
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{m.schedule_text}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <b>Recent medication logs</b>
        {medLogs.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>No logs yet.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {medLogs.map((l) => {
              const med = medById[l.medication_id];
              const plain = notePlainByLogId[l.id];
              return (
                <div key={l.id} style={{ border: "1px solid #f3f3f3", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 13 }}>
                    <b>{l.status ?? "—"}</b> • {new Date(l.created_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    {med ? `${med.name}${med.dosage ? ` (${med.dosage})` : ""}` : `med:${l.medication_id}`}
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => decryptMedLogNote(l)}
                      disabled={!vaultKey || !!plain || !l.note_encrypted}
                      style={{ padding: "6px 10px", borderRadius: 10 }}
                    >
                      {plain ? "Decrypted" : l.note_encrypted ? "Decrypt note" : "No note"}
                    </button>
                  </div>

                  {plain ? (
                    <div style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{plain || "—"}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

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