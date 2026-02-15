"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type ThreadRow = {
  id: string;
  patient_id: string;
  created_at: string;
};

type MemberRow = { user_id: string; role: string };

type PatientRow = { id: string; display_name: string };

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

export default function MessagesIndexPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [authedUserId, setAuthedUserId] = useState<string | null>(null);

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patientId, setPatientId] = useState<string>("");

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);

  const [startWithUserId, setStartWithUserId] = useState<string>("");

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setAuthedUserId(data.user.id);
    return data.user;
  }

  async function loadMyPatients() {
    const user = await requireAuth();
    if (!user) return;

    const q = await supabase
      .from("patient_members")
      .select("patient_id, patients:patients(id,display_name)")
      .eq("user_id", user.id);

    if (q.error) return setPageError(q.error.message);

    const list: PatientRow[] = (q.data ?? [])
      .map((r: any) => r.patients)
      .filter(Boolean);

    setPatients(list);
    if (!patientId && list.length) setPatientId(list[0].id);
  }

  async function loadMembers(pid: string) {
    const q = await supabase.from("patient_members").select("user_id,role").eq("patient_id", pid);
    if (q.error) return setPageError(q.error.message);
    setMembers((q.data ?? []) as MemberRow[]);
  }

  async function loadThreads(pid: string) {
    // This is RLS-filtered to only threads you’re a member of, and only if dm_view is allowed.
    const q = await supabase.from("dm_threads").select("id,patient_id,created_at").eq("patient_id", pid).order("created_at", { ascending: false });
    if (q.error) return setPageError(q.error.message);
    setThreads((q.data ?? []) as ThreadRow[]);
  }

  async function createThread() {
    if (!patientId) return;
    if (!startWithUserId) return setPageError("Choose someone to message.");

    setLoading("Creating chat…");

    const { data, error } = await supabase.rpc("create_dm_thread_1to1", {
      p_patient_id: patientId,
      p_other_user_id: startWithUserId,
    });

    if (error) return setPageError(error.message);

    const threadId = String(data);
    setStartWithUserId("");
    await loadThreads(patientId);
    setOk("Chat created ✅");
    window.location.href = `/app/messages/${threadId}`;
  }

  useEffect(() => {
    (async () => {
      setLoading("Loading…");
      await loadMyPatients();
      setOk("Ready.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!patientId) return;
      setLoading("Loading messages…");
      await loadMembers(patientId);
      await loadThreads(patientId);
      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const otherMembers = useMemo(() => {
    return members.filter((m) => m.user_id !== authedUserId);
  }, [members, authedUserId]);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Messages</h1>
              <p className="cc-subtle">
                Private 1:1 messages (kept out of the circle journal).
              </p>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href="/app/today">← Back to Today</Link>
              <Link className="cc-btn" href="/app/account/permissions">🔐 Permissions</Link>
            </div>
          </div>

          <div className="cc-spacer-12" />

          <div className="cc-row">
            <div className="cc-field" style={{ minWidth: 280 }}>
              <div className="cc-label">Patient</div>
              <select className="cc-select" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </div>

            <div className="cc-field" style={{ minWidth: 320 }}>
              <div className="cc-label">Start a chat with</div>
              <select className="cc-select" value={startWithUserId} onChange={(e) => setStartWithUserId(e.target.value)}>
                <option value="">Choose a member…</option>
                {otherMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.role} — {m.user_id}
                  </option>
                ))}
              </select>
            </div>

            <button className="cc-btn cc-btn-primary" onClick={createThread} disabled={!startWithUserId}>
              Start chat
            </button>
          </div>
        </div>

        {status.kind !== "idle" && (
          <div className={`cc-status cc-card ${status.kind === "ok" ? "cc-status-ok" : status.kind === "error" ? "cc-status-error" : "cc-status-loading"}`}>
            <div>
              {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
              {status.msg}
            </div>
            {error ? <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div> : null}
          </div>
        )}

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">Your chats</h2>
          {threads.length === 0 ? (
            <p className="cc-subtle">No chats yet.</p>
          ) : (
            <div className="cc-stack">
              {threads.map((t) => (
                <Link key={t.id} className="cc-panel-soft" href={`/app/messages/${t.id}`}>
                  <div className="cc-row-between">
                    <div>
                      <div className="cc-strong">Thread</div>
                      <div className="cc-small">{t.id}</div>
                    </div>
                    <div className="cc-small">{new Date(t.created_at).toLocaleString()}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
