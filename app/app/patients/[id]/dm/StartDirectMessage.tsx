"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { loadMyPatientVaultKey } from "@/lib/e2ee/patientVault";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type MemberRow = {
  user_id: string;
  role: string;
  nickname: string | null;
  is_controller: boolean;
};

type ThreadRow = {
  id: string;
  patient_id: string;
  created_by: string;
  created_at: string;
  title_encrypted: CipherEnvelopeV1 | null;
  last_message_at: string | null;
  last_message_preview_encrypted: CipherEnvelopeV1 | null;
};

export default function StartDirectMessage({
  patientId,
  onOpenThread,
}: {
  patientId: string;
  onOpenThread: (threadId: string) => void;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    loadMyPatientVaultKey(patientId).then(setVaultKey).catch((e: any) => setErr(e?.message ?? "no_vault_share"));
  }, [patientId]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setErr("not_authenticated");

      const { data, error } = await supabase
        .from("patient_members")
        .select("user_id, role, nickname, is_controller")
        .eq("patient_id", patientId);

      if (error) return setErr(error.message);

      // Only show other members (not me)
      const list = ((data ?? []) as MemberRow[]).filter((m) => m.user_id !== auth.user!.id);
      setMembers(list);
    })();
  }, [patientId, supabase]);

  async function openOrCreate1to1(other: MemberRow) {
    if (!vaultKey) return setErr("no_vault_share");
    setErr(null);
    setBusyUserId(other.user_id);

    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("not_authenticated");
      const me = auth.user.id;
      const them = other.user_id;

      // 1) Get my thread ids
      const { data: myRows, error: myErr } = await supabase
        .from("dm_thread_members")
        .select("thread_id")
        .eq("user_id", me);
      if (myErr) throw myErr;

      const myThreadIds = (myRows ?? []).map((r: any) => r.thread_id as string);
      if (myThreadIds.length > 0) {
        // 2) Intersect with their membership (only within my threads)
        const { data: bothRows, error: bothErr } = await supabase
          .from("dm_thread_members")
          .select("thread_id")
          .eq("user_id", them)
          .in("thread_id", myThreadIds);
        if (bothErr) throw bothErr;

        const candidateIds = (bothRows ?? []).map((r: any) => r.thread_id as string);

        if (candidateIds.length > 0) {
          // 3) Fetch candidate threads for this patient
          const { data: threads, error: tErr } = await supabase
            .from("dm_threads")
            .select("id, patient_id, created_by, created_at, title_encrypted, last_message_at, last_message_preview_encrypted")
            .eq("patient_id", patientId)
            .in("id", candidateIds);
          if (tErr) throw tErr;

          // 4) Enforce 1:1 by checking member count is exactly 2 (me + them)
          for (const t of (threads ?? []) as ThreadRow[]) {
            const { data: mems, error: mErr } = await supabase
              .from("dm_thread_members")
              .select("user_id")
              .eq("thread_id", t.id);
            if (mErr) throw mErr;

            const ids = (mems ?? []).map((x: any) => x.user_id as string);
            const unique = Array.from(new Set(ids));

            if (unique.length === 2 && unique.includes(me) && unique.includes(them)) {
              onOpenThread(t.id);
              return;
            }
          }
        }
      }

      // 5) No existing 1:1 thread -> create new
      const titlePlain = other.nickname ?? other.user_id; // encrypted anyway
      const titleEnv: CipherEnvelopeV1 = await vaultEncryptString({
        vaultKey,
        plaintext: titlePlain,
        aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId, type: "dm_1to1" },
      });

      const { data: thread, error: createErr } = await supabase
        .from("dm_threads")
        .insert({
          patient_id: patientId,
          created_by: me,
          title_encrypted: titleEnv,
          last_message_at: null,
          last_message_preview_encrypted: null,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;

      const nowIso = new Date().toISOString();
      const { error: addErr } = await supabase.from("dm_thread_members").insert([
        { thread_id: thread.id, user_id: me, added_by: me, added_at: nowIso },
        { thread_id: thread.id, user_id: them, added_by: me, added_at: nowIso },
      ]);
      if (addErr) throw addErr;

      onOpenThread(thread.id);
    } catch (e: any) {
      setErr(e?.message ?? "dm_open_failed");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 10, marginBottom: 12 }}>
      <b>Message a member (1:1)</b>
      {err && <div style={{ marginTop: 6, color: "#a00" }}>{err}</div>}

      <div style={{ marginTop: 10 }}>
        {members.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>No other members found for this circle.</div>
        ) : (
          members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => openOrCreate1to1(m)}
              disabled={!vaultKey || busyUserId === m.user_id}
              style={{ display: "block", width: "100%", textAlign: "left", padding: 10, borderRadius: 10, marginBottom: 8 }}
            >
              {busyUserId === m.user_id ? "Opening…" : (m.nickname ?? m.user_id)}{" "}
              <span style={{ opacity: 0.7, fontSize: 12 }}>• {m.role}{m.is_controller ? " (controller)" : ""}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}