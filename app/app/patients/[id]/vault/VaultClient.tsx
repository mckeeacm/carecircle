// app/app/patients/[id]/vault/VaultClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";

type PatientRow = { id: string; display_name: string };
type MembershipRow = { patient_id: string; role: string; nickname: string | null; is_controller: boolean };

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function VaultClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [email, setEmail] = useState<string>("");
  const [uid, setUid] = useState<string>("");
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [membership, setMembership] = useState<MembershipRow | null>(null);

  const [hasShareRow, setHasShareRow] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      if (!patientId || !isUuid(patientId)) throw new Error(`invalid patientId: ${String(patientId)}`);

      // auth
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!auth.user) throw new Error("not_authenticated");

      setUid(auth.user.id);
      setEmail(auth.user.email ?? "");

      // patient label
      const { data: p, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name")
        .eq("id", patientId)
        .single();
      if (pErr) throw pErr;
      setPatient(p as PatientRow);

      // membership (role/controller)
      const { data: m, error: mErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller")
        .eq("patient_id", patientId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (mErr) throw mErr;
      setMembership((m ?? null) as MembershipRow | null);

      // vault share row exists?
      // NOTE: If RLS blocks this select, we treat it as "unknown/false" but don't crash the page.
      try {
        const { data: s, error: sErr } = await supabase
          .from("patient_vault_shares")
          .select("id")
          .eq("patient_id", patientId)
          .eq("user_id", auth.user.id)
          .limit(1);

        if (sErr) {
          // don’t hard-fail — just show info
          setHasShareRow(false);
        } else {
          setHasShareRow((s ?? []).length > 0);
        }
      } catch {
        setHasShareRow(false);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_vault_page");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function clearLocalVaultCache() {
    try {
      // We don’t know your exact storage keys, so we clear a few common/predictable ones.
      // This is safe: it only removes local cached secrets, never server data.
      const keys = [
        `cc:vaultKey:${patientId}`,
        `cc_vaultKey_${patientId}`,
        `vaultKey:${patientId}`,
        `patientVaultKey:${patientId}`,
      ];

      for (const k of keys) localStorage.removeItem(k);

      // Clear decrypt cache too (again: only local).
      // If your decrypt cache uses different keys, this won’t hurt.
      const prefixCandidates = ["cc:decrypt:", "decryptCache:", "cc:cache:"];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.includes(patientId) && prefixCandidates.some((p) => k.startsWith(p))) {
          localStorage.removeItem(k);
        }
      }

      setMsg("Local vault cache cleared. Now open Vault again (or Vault init) to re-load.");
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_clear_local_cache");
    }
  }

  const isController = membership?.is_controller === true;

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault</h1>
            <div className="cc-subtle">{patient?.display_name ?? patientId}</div>
            <div className="cc-small cc-wrap">{email || "—"}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href={`/app/patients/${patientId}/today`}>
              Today
            </Link>
            <Link className="cc-btn" href={`/app/patients/${patientId}/summary`}>
              Summary
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
            <div className="cc-status-error-title">Message</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Vault status</h2>
              <div className="cc-subtle">
                This page helps you restore E2EE access on this device when other pages say “Vault key not available”.
              </div>
            </div>

            <div className="cc-row">
              <button className="cc-btn" onClick={refresh} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button className="cc-btn cc-btn-danger" onClick={clearLocalVaultCache}>
                Clear local vault cache (device)
              </button>
            </div>
          </div>

          <div className="cc-grid-3">
            <div className="cc-panel-soft">
              <div className="cc-kicker">Membership</div>
              <div className="cc-strong">{membership ? "OK" : "Not a member (or blocked by RLS)"}</div>
              <div className="cc-small">
                role: <b>{membership?.role ?? "—"}</b>
                {membership?.is_controller ? " • controller" : ""}
              </div>
            </div>

            <div className="cc-panel-soft">
              <div className="cc-kicker">Vault share row (server)</div>
              <div className="cc-strong">{hasShareRow ? "Found" : "Not found / blocked"}</div>
              <div className="cc-small cc-subtle">
                If this says “Not found”, the controller may need to initialise / re-share the vault.
              </div>
            </div>

            <div className="cc-panel-soft">
              <div className="cc-kicker">Vault key loaded (this device)</div>
              <div className="cc-strong">{vaultKey ? "Yes" : "No"}</div>
              <div className="cc-small cc-subtle">
                If “No”, encrypted notes/DMs/journals can’t decrypt or be saved on this device.
              </div>
            </div>
          </div>

          {!vaultKey ? (
            <div className="cc-status cc-status-loading">
              <div className="cc-strong">Vault key not available on this device</div>
              <div className="cc-subtle">
                Next steps:
                <ul style={{ margin: "8px 0 0 18px" }}>
                  <li>Try clearing the local vault cache, then refresh.</li>
                  <li>
                    If you are a controller: run <b>Vault init</b> to (re)issue shares.
                  </li>
                  <li>If you are not a controller: ask the controller to (re)share vault access.</li>
                </ul>
              </div>

              <div className="cc-row" style={{ marginTop: 10 }}>
                <Link className="cc-btn cc-btn-primary" href={`/app/patients/${patientId}/vault-init`}>
                  Vault init
                </Link>
              </div>
            </div>
          ) : (
            <div className="cc-status cc-status-ok">
              <div className="cc-strong">Vault key loaded</div>
              <div className="cc-subtle">This device should be able to decrypt and create encrypted content.</div>
            </div>
          )}

          <div className="cc-spacer-12" />

          <div className="cc-panel">
            <div className="cc-strong">What this page does (and doesn’t) do</div>
            <div className="cc-subtle" style={{ marginTop: 6 }}>
              - It checks membership + whether a vault share row exists for you in <code>patient_vault_shares</code>.
              <br />
              - It shows whether <code>usePatientVault()</code> currently has a <code>vaultKey</code> loaded on this device.
              <br />
              - It can clear local cached keys so your app re-attempts loading.
              <br />
              - <b>It does not generate keys</b> — Vault init is where your E2EE share creation/wrapping flow will live.
            </div>

            {isController ? (
              <div className="cc-small" style={{ marginTop: 10 }}>
                Controller: <b>yes</b> — you can initialise/re-share vault access.
              </div>
            ) : (
              <div className="cc-small" style={{ marginTop: 10 }}>
                Controller: <b>no</b> — you’ll need a controller to initialise/re-share vault access.
              </div>
            )}

            <div className="cc-small" style={{ marginTop: 6 }}>
              uid: <span className="cc-wrap">{uid || "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}