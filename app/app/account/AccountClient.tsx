"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { registerMyPublicKey } from "@/lib/e2ee/registerPublicKey";
import MobileShell from "@/app/components/MobileShell";

type Membership = {
  patient_id: string;
  role: string;
  nickname: string | null;
  is_controller: boolean;
};

type PatientRow = { id: string; display_name: string };

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
  const [inviteEmailByPid, setInviteEmailByPid] = useState<Record<string, string>>({});
  const [inviteNicknameByPid, setInviteNicknameByPid] = useState<Record<string, string>>({});
  const [inviteUrlByPid, setInviteUrlByPid] = useState<Record<string, string>>({});
  const [inviteSentEmailByPid, setInviteSentEmailByPid] = useState<Record<string, string>>({});

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
    if (error) {
      setMsg(error.message);
      return;
    }

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
    const emailSeed: Record<string, string> = {};
    const inviteNickSeed: Record<string, string> = {};

    for (const pid of pids) {
      roleSeed[pid] = roleSeed[pid] ?? "family";
      daysSeed[pid] = daysSeed[pid] ?? 7;
      usesSeed[pid] = usesSeed[pid] ?? 1;
      emailSeed[pid] = emailSeed[pid] ?? "";
      inviteNickSeed[pid] = inviteNickSeed[pid] ?? "";
    }

    setInviteRoleByPid((prev) => ({ ...roleSeed, ...prev }));
    setInviteDaysByPid((prev) => ({ ...daysSeed, ...prev }));
    setInviteMaxUsesByPid((prev) => ({ ...usesSeed, ...prev }));
    setInviteEmailByPid((prev) => ({ ...emailSeed, ...prev }));
    setInviteNicknameByPid((prev) => ({ ...inviteNickSeed, ...prev }));
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
        "E2EE enabled on this device. If you still can’t decrypt for a circle, ask the controller to open Vault setup again so you receive a vault share."
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

      setMsg("Your display name has been updated for this circle.");
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

    const inviteEmail = (inviteEmailByPid[patientId] ?? "").trim();
    const inviteNickname = (inviteNicknameByPid[patientId] ?? "").trim();
    const role = (inviteRoleByPid[patientId] ?? "family").trim().toLowerCase();
    const days = Number(inviteDaysByPid[patientId] ?? 7);
    const maxUses = Number(inviteMaxUsesByPid[patientId] ?? 1);

    if (!inviteEmail) {
      setMsg("Please enter the invitee email.");
      return;
    }

    setInviteBusyPid(patientId);
    setInviteUrlByPid((prev) => ({ ...prev, [patientId]: "" }));

    try {
      const { data: auth, error: authErr } = await supabase.auth.getSession();
      if (authErr) throw authErr;

      const accessToken = auth.session?.access_token;
      if (!accessToken) throw new Error("missing_auth_session");

      const res = await fetch("/api/circle-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          patientId,
          role,
          expiresInDays: days,
          maxUses,
          inviteeEmail: inviteEmail,
          inviteeNickname: inviteNickname || null,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error ?? "failed_to_create_invite");
      }

      const inviteUrl = json?.inviteUrl ?? "";
      const emailSent = json?.emailSent === true;
      const emailError = json?.emailError ?? null;

      setInviteUrlByPid((prev) => ({ ...prev, [patientId]: inviteUrl }));
      setInviteSentEmailByPid((prev) => ({ ...prev, [patientId]: inviteEmail }));

      if (emailSent) {
        setMsg(
          inviteNickname
            ? `Invite created for ${inviteNickname}. Email sent to ${inviteEmail}.`
            : `Invite created. Email sent to ${inviteEmail}.`
        );
      } else {
        setMsg(
          inviteNickname
            ? `Invite created for ${inviteNickname}. Email send failed, but the individual invite link is ready. ${emailError ? `(${emailError})` : ""}`
            : `Invite created. Email send failed, but the individual invite link is ready. ${emailError ? `(${emailError})` : ""}`
        );
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_invite");
    } finally {
      setInviteBusyPid(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied.");
    } catch {}
  }

  const controllerMemberships = memberships.filter((m) => m.is_controller);

  return (
    <MobileShell
      title="Account"
      subtitle={email || "Your CareCircle account"}
      rightSlot={
        <Link className="cc-btn" href="/app/hub">
          Hub
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">Message</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">E2EE device setup</h2>
              <div className="cc-subtle">
                Your account needs a public key before a controller can give this device vault access.
              </div>
            </div>

            <span className="cc-pill cc-pill-primary">
              {hasPublicKey === true
                ? "Public key: OK"
                : hasPublicKey === false
                ? "Public key: missing"
                : "Public key: unknown"}
            </span>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-subtle">
              If encrypted pages say the vault key is unavailable, enable E2EE here first, then reopen Vault setup for the
              relevant circle.
            </div>
          </div>

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={enableE2EEOnThisDevice}
              disabled={e2eeBusy || hasPublicKey === true}
            >
              {hasPublicKey === true ? "Enabled" : e2eeBusy ? "Enabling…" : "Enable E2EE on this device"}
            </button>

            <button className="cc-btn" onClick={loadAccount}>
              Refresh
            </button>
          </div>

          {hasPublicKey === false ? (
            <div className="cc-small cc-subtle">
              After enabling E2EE, ask the circle controller to reopen <b>Vault setup</b> so you receive a row in{" "}
              <code>patient_vault_shares</code>.
            </div>
          ) : null}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Permissions</h2>
              <div className="cc-subtle">Manage feature access for a circle from one place.</div>
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-subtle">
              Use permissions to manage who can view or manage journals, appointments, profile, medication logs, messaging,
              and more. Controllers should always have full management access.
            </div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href="/app/account/permissions">
              Open permissions
            </Link>
          </div>
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Your circles</h2>
            <div className="cc-subtle">Manage your display name, vault access, and circle tools.</div>
          </div>
        </div>

        {memberships.length === 0 ? (
          <div className="cc-small">No circles yet.</div>
        ) : (
          <div className="cc-stack">
            {memberships.map((m) => {
              const p = patientsById[m.patient_id];
              const nicknameBusy = nicknameBusyPid === m.patient_id;
              const pidOk = isUuid(m.patient_id);

              return (
                <div
                  key={m.patient_id}
                  className="cc-panel-soft cc-stack"
                  style={{ padding: 16, borderRadius: 20 }}
                >
                  <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="cc-wrap">
                      <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                      <div className="cc-small cc-subtle">
                        Role: <b>{m.role}</b>
                        {m.is_controller ? " • Controller" : ""}
                      </div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {pidOk ? (
                        <>
                          <Link className="cc-btn" href={`/app/patients/${m.patient_id}/vault-init`}>
                            Vault setup
                          </Link>
                          <Link className="cc-btn" href={`/app/account/permissions?pid=${m.patient_id}`}>
                            Permissions
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="cc-field">
                    <div className="cc-label">Your display name in this circle</div>
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
                        disabled={nicknameBusy}
                      >
                        {nicknameBusy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>

                  <div className="cc-small cc-subtle">
                    Open Vault setup to load your wrapped key locally on this device. Your nickname is reflected in member and
                    permissions lists.
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
              Controllers can create an email invite and a backup individual invite link.
            </div>
          </div>
        </div>

        {controllerMemberships.length === 0 ? (
          <div className="cc-small">You’re not a controller for any circles, so you can’t create invite links.</div>
        ) : (
          <div className="cc-stack">
            {controllerMemberships.map((m) => {
              const pidOk = isUuid(m.patient_id);
              const p = patientsById[m.patient_id];
              const role = inviteRoleByPid[m.patient_id] ?? "family";
              const days = inviteDaysByPid[m.patient_id] ?? 7;
              const maxUses = inviteMaxUsesByPid[m.patient_id] ?? 1;
              const inviteeEmail = inviteEmailByPid[m.patient_id] ?? "";
              const inviteeNickname = inviteNicknameByPid[m.patient_id] ?? "";
              const url = inviteUrlByPid[m.patient_id] ?? "";
              const sentEmail = inviteSentEmailByPid[m.patient_id] ?? "";
              const busy = inviteBusyPid === m.patient_id;

              return (
                <div
                  key={`invite:${String(m.patient_id)}`}
                  className="cc-panel-soft cc-stack"
                  style={{ padding: 16, borderRadius: 20 }}
                >
                  <div className="cc-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div className="cc-wrap">
                      <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                      <div className="cc-small cc-subtle">
                        Controller invite tools
                        {!pidOk ? " • invalid patient id" : ""}
                      </div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <Link className="cc-btn" href={`/app/account/permissions?pid=${m.patient_id}`}>
                        Permissions
                      </Link>
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={() => createInvite(m.patient_id)}
                        disabled={busy || !pidOk}
                      >
                        {busy ? "Creating…" : "Invite member"}
                      </button>
                    </div>
                  </div>

                  <div className="cc-grid-2">
                    <div className="cc-field">
                      <div className="cc-label">Invitee email</div>
                      <input
                        className="cc-input"
                        type="email"
                        value={inviteeEmail}
                        disabled={!pidOk}
                        onChange={(e) =>
                          setInviteEmailByPid((prev) => ({ ...prev, [m.patient_id]: e.target.value }))
                        }
                        placeholder="name@example.com"
                      />
                    </div>

                    <div className="cc-field">
                      <div className="cc-label">Invitee nickname</div>
                      <input
                        className="cc-input"
                        value={inviteeNickname}
                        disabled={!pidOk}
                        onChange={(e) =>
                          setInviteNicknameByPid((prev) => ({ ...prev, [m.patient_id]: e.target.value }))
                        }
                        placeholder="How they should appear in the circle"
                      />
                    </div>
                  </div>

                  <div className="cc-grid-3">
                    <div className="cc-field">
                      <div className="cc-label">Role</div>
                      <select
                        className="cc-select"
                        value={role}
                        onChange={(e) =>
                          setInviteRoleByPid((prev) => ({ ...prev, [m.patient_id]: e.target.value }))
                        }
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
                          setInviteDaysByPid((prev) => ({
                            ...prev,
                            [m.patient_id]: Number(e.target.value || 7),
                          }))
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
                          setInviteMaxUsesByPid((prev) => ({
                            ...prev,
                            [m.patient_id]: Number(e.target.value || 1),
                          }))
                        }
                      />
                    </div>
                  </div>

                  {url ? (
                    <div className="cc-panel" style={{ padding: 14 }}>
                      <div className="cc-small cc-subtle">Invitee email</div>
                      <div className="cc-strong">{sentEmail || inviteeEmail || "—"}</div>

                      <div className="cc-spacer-12" />

                      <div className="cc-small cc-subtle">Individual backup invite link</div>
                      <div className="cc-row-between" style={{ gap: 12, alignItems: "flex-start" }}>
                        <div className="cc-wrap" style={{ fontSize: 13, flex: 1 }}>
                          {url}
                        </div>
                        <button className="cc-btn" onClick={() => copy(url)}>
                          Copy link
                        </button>
                      </div>

                      <div className="cc-spacer-12" />
                      <div className="cc-small cc-subtle">
                        This link is unique to this invite. The email invite is attempted automatically as part of the same
                        action.
                      </div>
                    </div>
                  ) : (
                    <div className="cc-small cc-subtle">
                      Enter email and nickname, then invite the member. This creates a unique invite link and attempts to send
                      the email automatically.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">Sign out</h2>
            <div className="cc-subtle">Sign out of this device when you’re finished.</div>
          </div>
        </div>

        <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-small cc-subtle">
            This signs you out of your CareCircle session on this device.
          </div>
        </div>

        <div className="cc-row">
          <button className="cc-btn cc-btn-danger" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </MobileShell>
  );
}