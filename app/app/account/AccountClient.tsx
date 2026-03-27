"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { registerMyPublicKey } from "@/lib/e2ee/registerPublicKey";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import {
  DEFAULT_ACCOUNT_LANGUAGE_CODE,
  SUPPORTED_ACCOUNT_LANGUAGES,
  getLanguageLabel,
  normaliseLanguageCode,
} from "@/lib/languages";
import { t } from "@/lib/i18n";

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
  const { languageCode, setLanguageCode } = useUserLanguage();

  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [preferredLanguageCode, setPreferredLanguageCode] = useState(DEFAULT_ACCOUNT_LANGUAGE_CODE);
  const [languageBusy, setLanguageBusy] = useState(false);

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
    setPreferredLanguageCode(normaliseLanguageCode(data.user?.user_metadata?.preferred_language_code));

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
        "Secure access is now set up on this device. If a circle still does not open here, ask the controller to reopen Secure access for that circle."
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

  async function savePreferredLanguage() {
    setMsg(null);
    setLanguageBusy(true);

    try {
      const languageCode = normaliseLanguageCode(preferredLanguageCode);
      const { error } = await supabase.auth.updateUser({
        data: {
          preferred_language_code: languageCode,
          preferred_language_label: getLanguageLabel(languageCode),
        },
      });

      if (error) throw error;

      setPreferredLanguageCode(languageCode);
      setLanguageCode(languageCode);
      setMsg(`Your language is now set to ${getLanguageLabel(languageCode)}. Translated labels may take a moment to update.`);
      await loadAccount();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_language");
    } finally {
      setLanguageBusy(false);
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
      title={t(languageCode, "screen.account")}
      subtitle={email || t(languageCode, "account.subtitle")}
      rightSlot={
        <Link className="cc-btn" href="/app/hub">
          {t(languageCode, "screen.hub")}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{t(languageCode, "common.message")}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{t(languageCode, "account.language_title")}</h2>
            <div className="cc-subtle">
              {t(languageCode, "account.language_subtitle")}
            </div>
          </div>
        </div>

        <div className="cc-row" style={{ alignItems: "flex-end" }}>
          <div className="cc-field" style={{ minWidth: 260, flex: "1 1 260px" }}>
            <div className="cc-label">{t(languageCode, "common.your_language")}</div>
            <select
              className="cc-select"
              value={preferredLanguageCode}
              onChange={(e) => {
                const next = normaliseLanguageCode(e.target.value);
                setPreferredLanguageCode(next);
                setLanguageCode(next);
              }}
              disabled={languageBusy}
            >
              {SUPPORTED_ACCOUNT_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>

          <button className="cc-btn cc-btn-primary" onClick={savePreferredLanguage} disabled={languageBusy}>
            {languageBusy ? t(languageCode, "common.loading") : t(languageCode, "account.save_language")}
          </button>
        </div>

        <div className="cc-small cc-subtle">
          {t(languageCode, "account.language_note")}
        </div>
      </div>

      <div className="cc-grid-2-125">
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">{t(languageCode, "account.secure_access_title")}</h2>
              <div className="cc-subtle">{t(languageCode, "account.secure_access_subtitle")}</div>
            </div>

            <span className="cc-pill cc-pill-primary">
              {hasPublicKey === true
                ? t(languageCode, "account.secure_access_ready")
                : hasPublicKey === false
                ? t(languageCode, "account.secure_access_not_ready")
                : t(languageCode, "account.secure_access_checking")}
            </span>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-subtle">{t(languageCode, "account.secure_access_help")}</div>
          </div>

          <div className="cc-row">
            <button
              className="cc-btn cc-btn-primary"
              onClick={enableE2EEOnThisDevice}
              disabled={e2eeBusy || hasPublicKey === true}
            >
              {hasPublicKey === true
                ? t(languageCode, "account.secure_access_ready_short")
                : e2eeBusy
                ? t(languageCode, "account.secure_access_setting_up")
                : t(languageCode, "account.secure_access_set_up")}
            </button>

            <button className="cc-btn" onClick={loadAccount}>
              {t(languageCode, "common.refresh")}
            </button>
          </div>

          {hasPublicKey === false ? (
            <div className="cc-small cc-subtle">
              If circle content still stays locked after setup, ask the circle controller to reopen <b>Secure access</b> for
              you.
            </div>
          ) : null}
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">{t(languageCode, "account.permissions_title")}</h2>
              <div className="cc-subtle">{t(languageCode, "account.permissions_subtitle")}</div>
            </div>
          </div>

          <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
            <div className="cc-small cc-subtle">{t(languageCode, "account.permissions_help")}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn cc-btn-primary" href="/app/account/permissions">
              {t(languageCode, "account.open_permissions")}
            </Link>
          </div>
        </div>
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{t(languageCode, "account.circles_title")}</h2>
            <div className="cc-subtle">{t(languageCode, "account.circles_subtitle")}</div>
          </div>
        </div>

        {memberships.length === 0 ? (
          <div className="cc-small">{t(languageCode, "account.no_circles")}</div>
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
                      <div className="cc-strong">{p?.display_name ?? t(languageCode, "account.circle")}</div>
                      <div className="cc-small cc-subtle">
                        {t(languageCode, "account.role")}: <b>{m.role}</b>
                        {m.is_controller ? ` - ${t(languageCode, "account.controller")}` : ""}
                      </div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {pidOk ? (
                        <>
                        <Link className="cc-btn" href={`/app/patients/${m.patient_id}/vault-init`}>
                            {t(languageCode, "account.open_secure_access")}
                          </Link>
                          <Link className="cc-btn" href={`/app/account/permissions?pid=${m.patient_id}`}>
                            {t(languageCode, "account.permissions_title")}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="cc-field">
                    <div className="cc-label">{t(languageCode, "account.display_name_label")}</div>
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
                        placeholder={t(languageCode, "account.display_name_placeholder")}
                      />
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={() => saveNickname(m.patient_id)}
                        disabled={nicknameBusy}
                      >
                        {nicknameBusy ? t(languageCode, "common.loading") : t(languageCode, "common.save")}
                      </button>
                    </div>
                  </div>

                  <div className="cc-small cc-subtle">{t(languageCode, "account.display_name_help")}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="cc-card cc-card-pad cc-stack">
        <div className="cc-row-between">
          <div>
            <h2 className="cc-h2">{t(languageCode, "account.invite_title")}</h2>
            <div className="cc-subtle">{t(languageCode, "account.invite_subtitle")}</div>
          </div>
        </div>

        {controllerMemberships.length === 0 ? (
          <div className="cc-small">{t(languageCode, "account.invite_not_controller")}</div>
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
                      <div className="cc-strong">{p?.display_name ?? t(languageCode, "account.circle")}</div>
                      <div className="cc-small cc-subtle">
                        {t(languageCode, "account.invite_tools")}
                        {!pidOk ? ` - ${t(languageCode, "account.invalid_patient_id")}` : ""}
                      </div>
                    </div>

                    <div className="cc-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <Link className="cc-btn" href={`/app/account/permissions?pid=${m.patient_id}`}>
                        {t(languageCode, "account.permissions_title")}
                      </Link>
                      <button
                        className="cc-btn cc-btn-primary"
                        onClick={() => createInvite(m.patient_id)}
                        disabled={busy || !pidOk}
                      >
                        {busy ? t(languageCode, "common.loading") : t(languageCode, "account.invite_member")}
                      </button>
                    </div>
                  </div>

                  <div className="cc-grid-2">
                    <div className="cc-field">
                      <div className="cc-label">{t(languageCode, "account.invitee_email")}</div>
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
                      <div className="cc-label">{t(languageCode, "account.invitee_nickname")}</div>
                      <input
                        className="cc-input"
                        value={inviteeNickname}
                        disabled={!pidOk}
                        onChange={(e) =>
                          setInviteNicknameByPid((prev) => ({ ...prev, [m.patient_id]: e.target.value }))
                        }
                        placeholder={t(languageCode, "account.invitee_nickname_placeholder")}
                      />
                    </div>
                  </div>

                  <div className="cc-grid-3">
                    <div className="cc-field">
                      <div className="cc-label">{t(languageCode, "account.role")}</div>
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
                      <div className="cc-label">{t(languageCode, "account.expires_days")}</div>
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
                      <div className="cc-label">{t(languageCode, "account.max_uses")}</div>
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
                      <div className="cc-small cc-subtle">{t(languageCode, "account.invitee_email")}</div>
                      <div className="cc-strong">{sentEmail || inviteeEmail || "-"}</div>

                      <div className="cc-spacer-12" />

                      <div className="cc-small cc-subtle">{t(languageCode, "account.backup_link")}</div>
                      <div className="cc-row-between" style={{ gap: 12, alignItems: "flex-start" }}>
                        <div className="cc-wrap" style={{ fontSize: 13, flex: 1 }}>
                          {url}
                        </div>
                        <button className="cc-btn" onClick={() => copy(url)}>
                          {t(languageCode, "account.copy_link")}
                        </button>
                      </div>

                      <div className="cc-spacer-12" />
                      <div className="cc-small cc-subtle">{t(languageCode, "account.backup_link_help")}</div>
                    </div>
                  ) : (
                    <div className="cc-small cc-subtle">{t(languageCode, "account.invite_entry_help")}</div>
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
            <h2 className="cc-h2">{t(languageCode, "account.sign_out_title")}</h2>
            <div className="cc-subtle">{t(languageCode, "account.sign_out_subtitle")}</div>
          </div>
        </div>

        <div className="cc-panel-soft" style={{ padding: 16, borderRadius: 20 }}>
          <div className="cc-small cc-subtle">{t(languageCode, "account.sign_out_help")}</div>
        </div>

        <div className="cc-row">
          <button className="cc-btn cc-btn-danger" onClick={signOut}>
            {t(languageCode, "account.sign_out_button")}
          </button>
        </div>
      </div>
    </MobileShell>
  );
}
