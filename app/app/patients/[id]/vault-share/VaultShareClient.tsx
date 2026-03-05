"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";
import { unwrapVaultKeyForMe, wrapVaultKeyForRecipient, type WrappedKeyV1 } from "@/lib/e2ee/vaultShares";

type Props = {
  pid: string;
};

type Member = {
  user_id: string;
  role?: string | null;
  nickname?: string | null;
  is_controller?: boolean | null;
};

type PublicKeyRow = {
  user_id: string;
  public_key: string;
  algorithm: string;
};

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function VaultShareClient({ pid }: Props) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [uid, setUid] = useState<string>("");

  const [members, setMembers] = useState<Member[]>([]);
  const [publicKeys, setPublicKeys] = useState<Record<string, PublicKeyRow>>({});
  const [shares, setShares] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setMsg(null);

    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      setMsg(sessErr.message);
      return;
    }

    const me = sessionData.session?.user;
    if (!me?.id) {
      setMsg("Please sign in.");
      return;
    }

    setUid(me.id);

    // circle members
    const { data: mem, error: memErr } = await supabase
      .from("patient_members")
      .select("user_id, role, nickname, is_controller")
      .eq("patient_id", pid)
      .order("created_at", { ascending: true });

    if (memErr) {
      setMsg(memErr.message);
      return;
    }

    const memberRows = (mem ?? []) as Member[];
    setMembers(memberRows);

    const userIds = memberRows.map((m) => m.user_id).filter(Boolean);

    if (userIds.length === 0) {
      setPublicKeys({});
      setShares({});
      return;
    }

    // public keys
    const { data: pks, error: pkErr } = await supabase
      .from("user_public_keys")
      .select("user_id, public_key, algorithm")
      .in("user_id", userIds);

    if (pkErr) {
      setMsg(pkErr.message);
      return;
    }

    const pkMap: Record<string, PublicKeyRow> = {};
    (pks ?? []).forEach((p: any) => (pkMap[p.user_id] = p as PublicKeyRow));
    setPublicKeys(pkMap);

    // existing shares (controller view)
    const { data: sh, error: shErr } = await supabase
      .from("patient_vault_shares")
      .select("user_id")
      .eq("patient_id", pid);

    if (shErr) {
      // If your RLS blocks controller SELECT here, you can swap to an RPC later.
      // For now, show unknown/empty.
      setShares({});
      return;
    }

    const shareMap: Record<string, boolean> = {};
    (sh ?? []).forEach((s: any) => (shareMap[s.user_id] = true));
    setShares(shareMap);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  async function loadMyVaultKey(): Promise<Uint8Array> {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw sessErr;

    const me = sessionData.session?.user;
    if (!me?.id) throw new Error("not_authenticated");

    // Controller must already have their own share row
    const { data: share, error: shareErr } = await supabase
      .from("patient_vault_shares")
      .select("wrapped_key")
      .eq("patient_id", pid)
      .eq("user_id", me.id)
      .maybeSingle();

    if (shareErr) throw shareErr;
    if (!share?.wrapped_key) {
      throw new Error("Controller vault share missing. Open Vault and unlock it first on this device.");
    }

    const wrapped = share.wrapped_key as WrappedKeyV1;

    // ✅ SAFE keypair extraction (no destructuring)
    const kp: any = await getOrCreateDeviceKeypair();

    const myPublicKey: Uint8Array =
      kp?.publicKey ?? kp?.public_key ?? kp?.pk;

    const myPrivateKey: Uint8Array =
      kp?.secretKey ?? kp?.secret_key ?? kp?.sk;

    if (!myPublicKey || !myPrivateKey) {
      throw new Error("device_keypair_missing_keys");
    }

    return unwrapVaultKeyForMe({
      wrapped,
      myPublicKey,
      myPrivateKey,
    });
  }

  async function shareTo(userId: string) {
    setBusy(userId);
    setMsg(null);

    try {
      // Sanity: must be signed in
      const { data: sessionData } = await supabase.auth.getSession();
      const me = sessionData.session?.user;
      if (!me?.id) throw new Error("not_authenticated");

      const pk = publicKeys[userId];
      if (!pk) throw new Error("This member has not enabled E2EE yet (no public key).");

      if (pk.algorithm !== "crypto_box_seal") {
        throw new Error(`Incompatible public key algorithm for member: ${pk.algorithm}`);
      }

      // Load vault key (controller unwrap)
      const vaultKey = await loadMyVaultKey();

      // Wrap to member
      const wrapped = await wrapVaultKeyForRecipient({
        vaultKey,
        recipientPublicKey: b64ToBytes(pk.public_key),
      });

      // Upsert share (requires a unique constraint on patient_id+user_id).
      // If you don’t have that unique constraint, tell me and I’ll swap this
      // to insert + update fallback.
      const { error } = await supabase
        .from("patient_vault_shares")
        .upsert(
          { patient_id: pid, user_id: userId, wrapped_key: wrapped },
          { onConflict: "patient_id,user_id" }
        );

      if (error) throw error;

      setMsg("Vault shared.");
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_share");
    } finally {
      setBusy(null);
    }
  }

  const missing = members.filter((m) => !shares[m.user_id]);

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault sharing</h1>
            <div className="cc-subtle cc-wrap">Circle: {pid}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${pid}/vault`}>
              Vault
            </Link>
            <Link className="cc-btn" href={`/app/patients/${pid}/vault-init`}>
              Vault init
            </Link>
            <Link className="cc-btn" href="/app/account">
              Account
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <div className="cc-strong">Members</div>
              <div className="cc-subtle">
                Share the vault key to members who have enabled E2EE. This creates/updates their row in{" "}
                <code>patient_vault_shares</code>.
              </div>
            </div>

            <button className="cc-btn" onClick={refresh} disabled={!!busy}>
              Refresh
            </button>
          </div>

          {members.length === 0 ? (
            <div className="cc-small cc-subtle">No members found.</div>
          ) : (
            <div className="cc-stack">
              {members.map((m) => {
                const hasShare = !!shares[m.user_id];
                const pk = publicKeys[m.user_id];
                const hasKey = !!pk;
                const keyOk = pk?.algorithm === "crypto_box_seal";

                return (
                  <div key={m.user_id} className="cc-panel-soft cc-row-between">
                    <div className="cc-wrap">
                      <div className="cc-strong">{m.nickname ?? m.user_id}</div>
                      <div className="cc-small cc-wrap">{m.user_id}</div>
                      <div className="cc-small">
                        Public key:{" "}
                        <b>
                          {hasKey ? (keyOk ? "OK" : `incompatible (${pk.algorithm})`) : "missing"}
                        </b>{" "}
                        • Vault share: <b>{hasShare ? "present" : "missing"}</b>
                      </div>
                    </div>

                    <div className="cc-row">
                      {!hasShare && hasKey && keyOk ? (
                        <button
                          className="cc-btn cc-btn-primary"
                          onClick={() => shareTo(m.user_id)}
                          disabled={busy === m.user_id}
                        >
                          {busy === m.user_id ? "Sharing…" : "Share vault"}
                        </button>
                      ) : null}

                      {hasShare ? (
                        <button
                          className="cc-btn"
                          onClick={() => shareTo(m.user_id)}
                          disabled={busy === m.user_id}
                        >
                          {busy === m.user_id ? "Re-sharing…" : "Re-share"}
                        </button>
                      ) : null}

                      {!hasKey ? (
                        <span className="cc-small cc-subtle">
                          Ask them to enable E2EE in Account
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {missing.length > 0 ? (
          <div className="cc-panel">
            <div className="cc-strong">Members needing vault access</div>
            <div className="cc-small cc-subtle">{missing.length} member(s) have no vault share yet.</div>
          </div>
        ) : null}

        <div className="cc-small cc-subtle">
          Note: If sharing fails with “Controller vault share missing”, open <b>Vault</b> first and unlock it on this device.
        </div>
      </div>
    </div>
  );
}