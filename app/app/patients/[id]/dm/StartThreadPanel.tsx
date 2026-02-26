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

export default function StartThreadPanel({
  patientId,
  onThreadCreated,
}: {
  patientId: string;
  onThreadCreated: (threadId: string) => void;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadMyPatientVaultKey(patientId).then(setVaultKey).catch((e) => setErr(e?.message ?? "no_vault"));
  }, [patientId]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("patient_members")
        .select("user_id, role, nickname, is_controller")
        .eq("patient_id", patientId);

      if (error) return setErr(error.message);
      setMembers((data ?? []) as any);
    })();
  }, [patientId, supabase]);

  async function create() {
    if (!vaultKey) return setErr("no_vault_share");
    setErr(null);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setErr("not_authenticated");

    const picked = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    const userIds = Array.from(new Set([auth.user.id, ...picked])); // always include me

    if (!title.trim()) return setErr("title_required");
    if (userIds.length < 2) return setErr("pick_at_least_one_member");

    const titleEnv: CipherEnvelopeV1 = await vaultEncryptString({
      vaultKey,
      plaintext: title.trim(),
      aad: { table: "dm_threads", column: "title_encrypted", patient_id: patientId },
    });

    const { data: thread, error: thrErr } = await supabase
      .from("dm_threads")
      .insert({
        patient_id: patientId,
        created_by: auth.user.id,
        title_encrypted: titleEnv,
        last_message_at: null,
        last_message_preview_encrypted: null,
      })
      .select("id")
      .single();

    if (thrErr) return setErr(thrErr.message);

    const nowIso = new Date().toISOString();
    const rows = userIds.map((uid) => ({
      thread_id: thread.id,
      user_id: uid,
      added_by: auth.user!.id,
      added_at: nowIso,
    }));

    const { error: memErr } = await supabase.from("dm_thread_members").insert(rows);
    if (memErr) return setErr(memErr.message);

    setTitle("");
    setSelected({});
    onThreadCreated(thread.id);
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 10, marginBottom: 12 }}>
      <b>Start a new thread</b>
      {err && <div style={{ marginTop: 6, color: "#a00" }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thread title (encrypted)" style={{ flex: 1 }} />
        <button onClick={create} disabled={!vaultKey}>Create</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Pick members to include:</div>
        {members.map((m) => (
          <label key={m.user_id} style={{ display: "block", marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={!!selected[m.user_id]}
              onChange={(e) => setSelected((prev) => ({ ...prev, [m.user_id]: e.target.checked }))}
            />{" "}
            {m.nickname ?? m.user_id} • {m.role}{m.is_controller ? " (controller)" : ""}
          </label>
        ))}
      </div>
    </div>
  );
}