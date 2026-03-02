"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type DmMessage = {
  id: string;
  thread_id: string;
  created_at: string;
  sender_id?: string | null;
  body_encrypted?: any; // encrypted envelope (json/text depending on your schema)
};

type JournalEntry = {
  id: string;
  created_at: string;
  created_by?: string | null;
  content_encrypted?: any;
  mood_encrypted?: any;
};

type Appointment = {
  id: string;
  starts_at: string;
  title?: string | null;
  location?: string | null;
};

type MedDue = {
  id: string;
  due_at: string;
  status: "due" | "missed";
  note_encrypted?: any;
  name?: string | null;
};

export default function TodayClient() {
  const supabase = supabaseBrowser();
  const params = useParams();

  const pid = useMemo(() => {
    const raw = (params as any)?.id;
    if (!raw) return "";
    if (Array.isArray(raw)) return raw[0] ?? "";
    return String(raw);
  }, [params]);

  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);

  const [dmLatest, setDmLatest] = useState<DmMessage[]>([]);
  const [journalsLatest, setJournalsLatest] = useState<JournalEntry[]>([]);
  const [appointmentsNext24h, setAppointmentsNext24h] = useState<Appointment[]>([]);
  const [medsDue, setMedsDue] = useState<MedDue[]>([]);

  function debugLog(line: string) {
    setDebug((prev) => [...prev, `[${new Date().toISOString()}] ${line}`]);
  }

  // ---------- Time helpers ----------
  function nowIso() {
    return new Date().toISOString();
  }
  function plusHoursIso(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  // ---------- Optional decrypt hook ----------
  // IMPORTANT: We do NOT import unknown modules to avoid build breaks.
  // Wire your real decrypt function here later:
  //   decryptStringWithLocalCache(envelope) -> string
  function tryDecrypt(_envelope: any): string | null {
    return null; // return decrypted plaintext when you wire your E2EE here
  }

  function renderEncryptedPreview(envelope: any) {
    const dec = tryDecrypt(envelope);
    if (dec) return dec;
    return "Encrypted (requires local vault)";
  }

  // ---------- Load ----------
  useEffect(() => {
    let mounted = true;

    async function load() {
      setBusy(true);
      setMsg(null);
      setDebug([]);
      setDmLatest([]);
      setJournalsLatest([]);
      setAppointmentsNext24h([]);
      setMedsDue([]);

      try {
        if (!pid) {
          setMsg("missing_pid_from_route");
          return;
        }

        debugLog(`Today load start pid=${pid}`);

        // Auth
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const uid = auth.user?.id;
        if (!uid) throw new Error("not_authenticated");

        // Membership check (safe; relies on RLS)
        debugLog("Checking membership in patient_members...");
        const { data: memRow, error: memErr } = await supabase
          .from("patient_members")
          .select("patient_id, role, is_controller")
          .eq("patient_id", pid)
          .eq("user_id", uid)
          .maybeSingle();

        if (memErr) throw memErr;
        if (!memRow) throw new Error("not_a_member_of_circle");

        debugLog(`Membership ok role=${memRow.role} controller=${String(memRow.is_controller)}`);

        // ---- 1) Latest DMs (via dm_threads.patient_id) ----
        debugLog("Loading dm_threads for this circle...");
        const { data: threads, error: thErr } = await supabase
          .from("dm_threads")
          .select("id")
          .eq("patient_id", pid);

        if (thErr) {
          debugLog(`dm_threads error: ${thErr.message}`);
        } else {
          const threadIds = (threads ?? []).map((t: any) => t.id).filter(Boolean);
          debugLog(`dm_threads found: ${threadIds.length}`);

          if (threadIds.length > 0) {
            debugLog("Loading newest dm_messages...");
            const { data: msgs, error: dmErr } = await supabase
              .from("dm_messages")
              .select("id, thread_id, created_at, sender_id, body_encrypted")
              .in("thread_id", threadIds)
              .order("created_at", { ascending: false })
              .limit(5);

            if (dmErr) {
              debugLog(`dm_messages error: ${dmErr.message}`);
            } else {
              debugLog(`dm_messages loaded: ${(msgs ?? []).length}`);
              if (mounted) setDmLatest((msgs ?? []) as DmMessage[]);
            }
          }
        }

        // ---- 2) Latest journals ----
        debugLog("Loading newest journal_entries...");
        const { data: journals, error: jErr } = await supabase
          .from("journal_entries")
          .select("id, created_at, created_by, content_encrypted, mood_encrypted")
          .eq("patient_id", pid)
          .order("created_at", { ascending: false })
          .limit(5);

        if (jErr) {
          debugLog(`journal_entries error: ${jErr.message}`);
        } else {
          debugLog(`journal_entries loaded: ${(journals ?? []).length}`);
          if (mounted) setJournalsLatest((journals ?? []) as JournalEntry[]);
        }

        // ---- 3) Appointments next 24h ----
        const from = nowIso();
        const to = plusHoursIso(24);
        debugLog(`Loading appointments in next 24h window: ${from} -> ${to}`);

        const { data: appts, error: aErr } = await supabase
          .from("appointments")
          .select("id, starts_at, title, location")
          .eq("patient_id", pid)
          .gte("starts_at", from)
          .lt("starts_at", to)
          .order("starts_at", { ascending: true })
          .limit(10);

        if (aErr) {
          debugLog(`appointments error: ${aErr.message}`);
        } else {
          debugLog(`appointments loaded: ${(appts ?? []).length}`);
          if (mounted) setAppointmentsNext24h((appts ?? []) as Appointment[]);
        }

        // ---- 4) Meds due/missed (schema-safe probing) ----
        // We try common patterns without crashing:
        // - medication_logs: (patient_id, due_at, taken_at, note_encrypted, name)
        // - meds_logs: same
        // - medication_doses: (patient_id, scheduled_for, taken_at, note_encrypted, medication_name)
        //
        // If none exist, we log the failure and show empty list.
        const candidates: Array<{
          table: string;
          dueCol: string;
          takenCol: string;
          nameCol?: string;
          noteCol?: string;
        }> = [
          { table: "medication_logs", dueCol: "due_at", takenCol: "taken_at", nameCol: "name", noteCol: "note_encrypted" },
          { table: "medication_logs", dueCol: "scheduled_for", takenCol: "taken_at", nameCol: "name", noteCol: "note_encrypted" },
          { table: "medication_doses", dueCol: "scheduled_for", takenCol: "taken_at", nameCol: "medication_name", noteCol: "note_encrypted" },
          { table: "meds_logs", dueCol: "due_at", takenCol: "taken_at", nameCol: "name", noteCol: "note_encrypted" },
        ];

        const dueCutoff = plusHoursIso(24);
        const now = nowIso();

        let medsLoaded = false;

        for (const c of candidates) {
          if (medsLoaded) break;

          const selectCols = [
            "id",
            c.dueCol,
            c.takenCol,
            c.nameCol ? c.nameCol : null,
            c.noteCol ? c.noteCol : null,
          ]
            .filter(Boolean)
            .join(", ");

          debugLog(`Trying meds table=${c.table} select="${selectCols}"`);

          const { data: rows, error: mErr } = await supabase
            .from(c.table)
            .select(selectCols)
            .eq("patient_id", pid)
            .lte(c.dueCol, dueCutoff)
            .order(c.dueCol, { ascending: true })
            .limit(25);

          if (mErr) {
            debugLog(`Meds probe failed on ${c.table}: ${mErr.message}`);
            continue;
          }

          const mapped: MedDue[] = (rows ?? [])
            .map((r: any) => {
              const dueAt = r?.[c.dueCol];
              const takenAt = r?.[c.takenCol];
              if (!dueAt) return null;

              const status: "due" | "missed" =
                !takenAt && String(dueAt) < String(now) ? "missed" : "due";

              if (takenAt) return null; // only due/missed

              return {
                id: r.id,
                due_at: dueAt,
                status,
                note_encrypted: c.noteCol ? r?.[c.noteCol] : undefined,
                name: c.nameCol ? r?.[c.nameCol] : undefined,
              };
            })
            .filter(Boolean) as MedDue[];

          debugLog(`Meds loaded from ${c.table}: ${mapped.length}`);
          if (mounted) setMedsDue(mapped);
          medsLoaded = true;
        }

        if (!medsLoaded) {
          debugLog("No meds table matched expected schema; meds section empty.");
        }

        debugLog("Today load complete.");
      } catch (e: any) {
        const m = e?.message ?? "today_load_failed";
        debugLog(`FAILED: ${m}`);
        if (mounted) setMsg(m);
      } finally {
        if (mounted) setBusy(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [pid, supabase]);

  const btnStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 8,
    textDecoration: "none",
    color: "inherit",
  };

  const cardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #e5e5e5",
    background: "rgba(0,0,0,0.02)",
    marginTop: 12,
  };

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Today</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/app/hub" style={btnStyle}>
          Back to Hub
        </Link>
        <Link href={`/app/patients/${pid}/summary`} style={btnStyle}>
          Summary
        </Link>
        <Link href={`/app/patients/${pid}/dm`} style={btnStyle}>
          DMs
        </Link>
        <Link href={`/app/patients/${pid}/journals`} style={btnStyle}>
          Journals
        </Link>
        <Link href={`/app/patients/${pid}/appointments`} style={btnStyle}>
          Appointments
        </Link>
        <Link href={`/app/patients/${pid}/medication-logs`} style={btnStyle}>
          Meds
        </Link>
      </div>

      <div style={{ marginTop: 12, opacity: 0.85 }}>
        Circle (pid): <code>{pid || "(empty)"}</code>
      </div>

      {busy && <p style={{ marginTop: 12 }}>Loading…</p>}
      {!busy && msg && (
        <p style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}>
          {msg}
        </p>
      )}

      {!busy && !msg && (
        <>
          {/* Newest DMs */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Newest DMs</div>
            {dmLatest.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No recent messages (or no access).</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {dmLatest.map((m) => (
                  <div key={m.id} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {new Date(m.created_at).toLocaleString()} — thread <code>{m.thread_id}</code>
                    </div>
                    <div style={{ marginTop: 6 }}>{renderEncryptedPreview(m.body_encrypted)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Newest Journals */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Newest Journal Entries</div>
            {journalsLatest.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No recent entries (or no access).</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {journalsLatest.map((j) => (
                  <div key={j.id} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{new Date(j.created_at).toLocaleString()}</div>
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Entry</div>
                      <div>{renderEncryptedPreview(j.content_encrypted)}</div>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Mood</div>
                      <div>{renderEncryptedPreview(j.mood_encrypted)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Meds due/missed */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Meds due / missed (next 24h)</div>
            {medsDue.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No due/missed meds found (or schema not matched).</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {medsDue.map((m) => (
                  <div key={m.id} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {m.status.toUpperCase()} — {new Date(m.due_at).toLocaleString()}
                    </div>
                    {m.name && <div style={{ marginTop: 6, fontWeight: 700 }}>{m.name}</div>}
                    {m.note_encrypted !== undefined && (
                      <div style={{ marginTop: 6 }}>{renderEncryptedPreview(m.note_encrypted)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Appointments */}
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Appointments in the next 24h</div>
            {appointmentsNext24h.length === 0 ? (
              <div style={{ opacity: 0.8 }}>No upcoming appointments (or no access).</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {appointmentsNext24h.map((a) => (
                  <div key={a.id} style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {new Date(a.starts_at).toLocaleString()}
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>{a.title ?? "Appointment"}</div>
                    {a.location && <div style={{ marginTop: 4, opacity: 0.85 }}>{a.location}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Debug */}
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
              maxHeight: 320,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {debug.length ? debug.join("\n") : "Debug log will appear here."}
          </div>
        </>
      )}
    </div>
  );
}