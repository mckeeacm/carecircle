"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { registerMyPublicKey } from "@/lib/e2ee/registerPublicKey";

type Membership = {
  patient_id: string;
  role: string;
  nickname: string | null;
  is_controller: boolean;
};

type PatientRow = { id: string; display_name: string };

type InviteCreateResult = {
  invite_id: string;
  patient_id: string;
  role: string;
  expires_at: string;
  token: string;
};

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export default function AccountClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  const [e2eeBusy, setE2eeBusy] = useState(false);
  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);

  const [inviteBusyPid, setInviteBusyPid] = useState<string | null>(null);
  const [inviteRoleByPid, setInviteRoleByPid] = useState<Record<string, string>>({});
  const [inviteDaysByPid, setInviteDaysByPid] = useState<Record<string, number>>({});
  const [inviteMaxUsesByPid, setInviteMaxUsesByPid] = useState<Record<string, number>>({});
  const [inviteUrlByPid, setInviteUrlByPid] = useState<Record<string, string>>({});

  const [nicknameByPid, setNicknameByPid] = useState<Record<string, string>>({});
  const [nicknameBusyPid, setNicknameBusyPid] = useState<string | null>(null);

  async function refreshHasPublicKey(uid: string) {
    try {
      const { data, error } = await supabase
        .from("user_public_keys")
        .select("user_id")
        .eq("user_id", uid)
        .limit(1);

      if (error) throw error;
      setHasPublicKey((data ?? []).length > 0);
    } catch {
      setHasPublicKey(null);
    }
  }

  async function loadAccount() {
    setMsg(null);

    const { data, error } = await supabase.auth.getUser();
    if (error) return setMsg(error.message);

    const uid = data.user?.id;
    setEmail(data.user?.email ?? "");

    if (!uid) {
      setMsg("not_authenticated");
      return;
    }

    await refreshHasPublicKey(uid);

    const { data: pm, error: pmErr } = await supabase
      .from("patient_members")
      .select("patient_id, role, nickname, is_controller")
      .eq("user_id", uid);

    if (pmErr) {
      setMsg(pmErr.message);
      return;
    }

    const ms = (pm ?? []) as Membership[];
    setMemberships(ms);

    const nicknameSeed: Record<string, string> = {};
    for (const m of ms) {
      nicknameSeed[m.patient_id] = m.nickname ?? "";
    }
    setNicknameByPid(nicknameSeed);

    const pids = Array.from(new Set(ms.map((m) => m.patient_id))).filter((pid) => isUuid(pid));
    if (pids.length === 0) {
      setPatientsById({});
      return;
    }

    const { data: pts, error: pErr } = await supabase
      .from("patients")
      .select("id, display_name")
      .in("id", pids)
      .order("created_at", { ascending: false });

    if (pErr) {
      setMsg(pErr.message);
      return;
    }

    const map: Record<string, PatientRow> = {};
    for (const p of (pts ?? []) as PatientRow[]) map[p.id] = p;
    setPatientsById(map);

    const roleSeed: Record<string, string> = {};
    const daysSeed: Record<string, number> = {};
    const usesSeed: Record<string, number> = {};
    for (const pid of pids) {
      roleSeed[pid] = roleSeed[pid] ?? "family";
      daysSeed[pid] = daysSeed[pid] ?? 7;
      usesSeed[pid] = usesSeed[pid] ?? 1;
    }
    setInviteRoleByPid((prev) => ({ ...roleSeed, ...prev }));
    setInviteDaysByPid((prev) => ({ ...daysSeed, ...prev }));
    setInviteMaxUsesByPid((prev) => ({ ...usesSeed, ...prev }));
  }

  useEffect(() => {
    loadAccount().catch((e: any) => setMsg(e?.message ?? "failed_to_load_account"));
  }, [supabase]);

  async function signOut() {
    setMsg(null);
    const { error } = await supabase.auth.signOut();
    if (error) setMsg(error.message);
  }

  async function enableE2EEOnThisDevice() {
    setMsg(null);
    setE2eeBusy(true);
    try {
      await registerMyPublicKey();
      setHasPublicKey(true);
      setMsg(
        "E2EE enabled on this device (public key registered). If you still can’t decrypt for a circle, ask the controller to open Vault setup again so you get a vault share."
      );
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_register_public_key");
    } finally {
      setE2eeBusy(false);
    }
  }

  async function saveNickname(patientId: string) {
    setMsg(null);
    setNicknameBusyPid(patientId);

    try {
      const nickname = (nicknameByPid[patientId] ?? "").trim() || null;

      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const uid = auth.user?.id;
      if (!uid) throw new Error("not_authenticated");

      const { error } = await supabase
        .from("patient_members")
        .update({ nickname })
        .eq("patient_id", patientId)
        .eq("user_id", uid);

      if (error) throw error;

      setMsg("Your name has been updated for this circle.");
      await loadAccount();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_name");
    } finally {
      setNicknameBusyPid(null);
    }
  }

  async function createInvite(patientId: unknown) {
    setMsg(null);

    if (!isUuid(patientId)) {
      setMsg(`invalid_patient_id_for_invite: ${String(patientId)}`);
      return;
    }

    setInviteBusyPid(patientId);
    setInviteUrlByPid((prev) => ({ ...prev, [patientId]: "" }));

    try {
      const role = (inviteRoleByPid[patientId] ?? "family").trim().toLowerCase();
      const days = Number(inviteDaysByPid[patientId] ?? 7);
      const maxUses = Number(inviteMaxUsesByPid[patientId] ?? 1);

      const { data, error } = await supabase.rpc("patient_invite_create", {
        pid: patientId,
        p_role: role,
        p_expires_in_days: days,
        p_max_uses: maxUses,
      });

      if (error) throw error;

      const res = data as InviteCreateResult;
      const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const inviteUrl = `${origin}/app/onboarding?invite=${encodeURIComponent(res.token)}`;

      setInviteUrlByPid((prev) => ({ ...prev, [patientId]: inviteUrl }));
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_invite");
    } finally {
      setInviteBusyPid(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Account</h1>
            <div className="cc-subtle cc-wrap">{email || "—"}</div>
          </div>
          <div className="cc-row">
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
          <div className="cc-strong">Quick links</div>

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href="/app/hub">
              Go to Hub
            </Link>

            <Link className="cc-btn" href="/app/account/permissions">
              Permissions
            </Link>

            <button className="cc-btn cc-btn-danger" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">E2EE device setup</h2>
              <div className="cc-subtle">
                Your account must have a public key in <code>user_public_keys</code> before a controller can create a vault share
                for you.
              </div>
            </div>

            <div className="cc-row">
              <span className="cc-pill cc-pill-primary">
                {hasPublicKey === true ? "Public key: OK" : hasPublicKey === false ? "Public key: missing" : "Public key: unknown"}
              </span>

              <button
                className="cc-btn cc-btn-secondary"
                onClick={enableE2EEOnThisDevice}
                disabled={e2eeBusy || hasPublicKey === true}
              >
                {hasPublicKey === true ? "Enabled" : e2eeBusy ? "Enabling…" : "Enable E2EE on this device"}
              </button>
            </div>
          </div>

          {hasPublicKey === false ? (
            <div className="cc-panel">
              <div className="cc-small cc-subtle">
                After enabling E2EE, ask the circle controller to open <b>Vault setup</b> again so you receive a row in{" "}
                <code>patient_vault_shares</code>.
              </div>
            </div>
          ) : null}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your display name in each circle</h2>
              <div className="cc-subtle">
                This is stored in <code>patient_members.nickname</code> and is shown in permissions and member lists.
              </div>
            </div>
          </div>

          {memberships.length === 0 ? (
            <div className="cc-small">No circles yet.</div>
          ) : (
            <div className="cc-stack">
              {memberships.map((m) => {
                const p = patientsById[m.patient_id];
                const busy = nicknameBusyPid === m.patient_id;

                return (
                  <div key={`nickname:${m.patient_id}`} className="cc-panel-soft cc-stack">
                    <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                    <div className="cc-small">
                      role: <b>{m.role}</b> • controller: <b>{m.is_controller ? "true" : "false"}</b>
                    </div>

                    <div className="cc-row">
                      <input
                        className="cc-input"
                        value={nicknameByPid[m.patient_id] ?? ""}
                        onChange={(e) =>
                          setNicknameByPid((prev) => ({
                            ...prev,
                            [m.patient_id]: e.target.value,
                          }))
                        }
                        placeholder="Enter the name others should see"
                      />
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={() => saveNickname(m.patient_id)}
                        disabled={busy}
                      >
                        {busy ? "Saving…" : "Save name"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Vault access on this device</h2>
              <div className="cc-subtle">
                If DMs/journals/notes say “Vault key not available”, open Vault setup for that circle to re-load the wrapped key and
                store it locally on this device.
              </div>
            </div>
          </div>

          {memberships.length === 0 ? (
            <div className="cc-small">No circles yet.</div>
          ) : (
            <div className="cc-stack">
              {memberships.map((m) => {
                const p = patientsById[m.patient_id];
                const pidOk = isUuid(m.patient_id);

                return (
                  <div key={String(m.patient_id)} className="cc-panel-soft cc-stack">
                    <div className="cc-row-between">
                      <div className="cc-wrap">
                        <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                        <div className="cc-small cc-wrap">{String(m.patient_id)}</div>
                        <div className="cc-small">
                          role: <b>{m.role}</b> • controller: <b>{m.is_controller ? "true" : "false"}</b>
                        </div>
                      </div>

                      <div className="cc-row">
                        {pidOk ? (
                          <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${m.patient_id}/vault-init`}>
                            Open Vault setup
                          </Link>
                        ) : (
                          <button className="cc-btn cc-btn-secondary" disabled>
                            Open Vault setup
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="cc-small cc-subtle">
                      Open Vault setup to unwrap your share from <code>patient_vault_shares</code>, cache the vault key locally,
                      or share/recreate vault access if you are a controller.
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Invite a circle member</h2>
              <div className="cc-subtle">
                Invites add a member + role. Vault sharing is separate (E2EE): a controller must share the vault key to the new
                member after they join.
              </div>
            </div>
          </div>

          {memberships.filter((m) => m.is_controller).length === 0 ? (
            <div className="cc-small">You’re not a controller for any circles, so you can’t create invite links.</div>
          ) : (
            <div className="cc-stack">
              {memberships
                .filter((m) => m.is_controller)
                .map((m) => {
                  const pidOk = isUuid(m.patient_id);
                  const p = patientsById[m.patient_id];
                  const role = inviteRoleByPid[m.patient_id] ?? "family";
                  const days = inviteDaysByPid[m.patient_id] ?? 7;
                  const maxUses = inviteMaxUsesByPid[m.patient_id] ?? 1;
                  const url = inviteUrlByPid[m.patient_id] ?? "";
                  const busy = inviteBusyPid === m.patient_id;

                  return (
                    <div key={`invite:${String(m.patient_id)}`} className="cc-panel-soft cc-stack">
                      <div className="cc-row-between">
                        <div className="cc-wrap">
                          <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                          <div className="cc-small cc-wrap">{String(m.patient_id)}</div>
                          {!pidOk ? (
                            <div className="cc-small" style={{ color: "crimson" }}>
                              invalid patient_id — can’t create invite
                            </div>
                          ) : null}
                        </div>

                        <button
                          className="cc-btn cc-btn-secondary"
                          onClick={() => createInvite(m.patient_id)}
                          disabled={busy || !pidOk}
                        >
                          {busy ? "Creating…" : "Create invite link"}
                        </button>
                      </div>

                      <div className="cc-grid-3">
                        <div className="cc-field">
                          <div className="cc-label">Role</div>
                          <select
                            className="cc-select"
                            value={role}
                            onChange={(e) => setInviteRoleByPid((prev) => ({ ...prev, [m.patient_id]: e.target.value }))}
                            disabled={!pidOk}
                          >
                            <option value="family">family</option>
                            <option value="carer">carer</option>
                            <option value="professional">professional</option>
                            <option value="clinician">clinician</option>
                          </select>
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">Expires (days)</div>
                          <input
                            className="cc-input"
                            type="number"
                            min={1}
                            value={days}
                            disabled={!pidOk}
                            onChange={(e) =>
                              setInviteDaysByPid((prev) => ({ ...prev, [m.patient_id]: Number(e.target.value || 7) }))
                            }
                          />
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">Max uses</div>
                          <input
                            className="cc-input"
                            type="number"
                            min={1}
                            value={maxUses}
                            disabled={!pidOk}
                            onChange={(e) =>
                              setInviteMaxUsesByPid((prev) => ({ ...prev, [m.patient_id]: Number(e.target.value || 1) }))
                            }
                          />
                        </div>
                      </div>

                      {url ? (
                        <div className="cc-panel">
                          <div className="cc-small cc-subtle">Invite link (share this):</div>
                          <div className="cc-row-between">
                            <div className="cc-wrap" style={{ fontSize: 13 }}>
                              {url}
                            </div>
                            <button className="cc-btn" onClick={() => copy(url)}>
                              Copy
                            </button>
                          </div>
                          <div className="cc-small cc-subtle">
                            After they accept, open <b>Vault setup</b> and share the vault key to them (creates their{" "}
                            <code>patient_vault_shares</code> row).
                          </div>
                        </div>
                      ) : (
                        <div className="cc-small cc-subtle">Create an invite to generate a link.</div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}