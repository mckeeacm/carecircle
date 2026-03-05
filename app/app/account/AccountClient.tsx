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

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  const [sharesByPid, setSharesByPid] = useState<Record<string, number>>({});

  const [hasPublicKey, setHasPublicKey] = useState<boolean | null>(null);
  const [e2eeBusy, setE2eeBusy] = useState(false);

  const [inviteBusyPid, setInviteBusyPid] = useState<string | null>(null);
  const [inviteRoleByPid, setInviteRoleByPid] = useState<Record<string, string>>({});
  const [inviteDaysByPid, setInviteDaysByPid] = useState<Record<string, number>>({});
  const [inviteMaxUsesByPid, setInviteMaxUsesByPid] = useState<Record<string, number>>({});
  const [inviteUrlByPid, setInviteUrlByPid] = useState<Record<string, string>>({});

  async function refreshHasPublicKey(uid: string) {
    try {
      const { data } = await supabase
        .from("user_public_keys")
        .select("user_id")
        .eq("user_id", uid)
        .limit(1);

      setHasPublicKey((data ?? []).length > 0);
    } catch {
      setHasPublicKey(null);
    }
  }

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data, error } = await supabase.auth.getSession();
      if (error) return setMsg(error.message);

      const user = data.session?.user;
      const uid = user?.id;

      setEmail(user?.email ?? "");

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

      const pids = Array.from(new Set(ms.map((m) => m.patient_id))).filter(isUuid);

      if (pids.length === 0) return;

      const { data: pts } = await supabase
        .from("patients")
        .select("id, display_name")
        .in("id", pids);

      const map: Record<string, PatientRow> = {};
      for (const p of (pts ?? []) as PatientRow[]) map[p.id] = p;

      setPatientsById(map);

      const { data: shares } = await supabase
        .from("patient_vault_shares")
        .select("patient_id");

      if (shares) {
        const map: Record<string, number> = {};
        for (const s of shares) {
          map[s.patient_id] = (map[s.patient_id] ?? 0) + 1;
        }
        setSharesByPid(map);
      }

      const roleSeed: Record<string, string> = {};
      const daysSeed: Record<string, number> = {};
      const usesSeed: Record<string, number> = {};

      for (const pid of pids) {
        roleSeed[pid] = "family";
        daysSeed[pid] = 7;
        usesSeed[pid] = 1;
      }

      setInviteRoleByPid(roleSeed);
      setInviteDaysByPid(daysSeed);
      setInviteMaxUsesByPid(usesSeed);

    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_account"));
  }, [supabase]);

  async function signOut() {
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
        "E2EE enabled on this device. If you still cannot decrypt circle data, ask the controller to run Vault init again."
      );
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_register_public_key");
    } finally {
      setE2eeBusy(false);
    }
  }

  async function createInvite(patientId: string) {
    setMsg(null);
    setInviteBusyPid(patientId);

    try {
      const role = inviteRoleByPid[patientId] ?? "family";
      const days = inviteDaysByPid[patientId] ?? 7;
      const maxUses = inviteMaxUsesByPid[patientId] ?? 1;

      const { data, error } = await supabase.rpc("patient_invite_create", {
        pid: patientId,
        p_role: role,
        p_expires_in_days: days,
        p_max_uses: maxUses,
      });

      if (error) throw error;

      const res = data as InviteCreateResult;

      const origin = window.location.origin;

      const inviteUrl =
        `${origin}/app/onboarding?invite=${encodeURIComponent(res.token)}`;

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
    } catch {}
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">

        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Account</h1>
            <div className="cc-subtle">{email}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
          </div>
        </div>

        {msg && (
          <div className="cc-status cc-status-error">
            <div className="cc-wrap">{msg}</div>
          </div>
        )}

        {/* E2EE setup */}

        <div className="cc-card cc-card-pad cc-stack">

          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">E2EE device setup</h2>
              <div className="cc-subtle">
                Your account must have a public key before encrypted vault access works.
              </div>
            </div>

            <div className="cc-row">
              <span className="cc-pill">
                {hasPublicKey ? "Public key: OK" : "Public key: missing"}
              </span>

              <button
                className="cc-btn"
                onClick={enableE2EEOnThisDevice}
                disabled={e2eeBusy || hasPublicKey === true}
              >
                {e2eeBusy ? "Enabling…" : "Enable E2EE"}
              </button>
            </div>
          </div>

        </div>

        {/* Circles */}

        <div className="cc-card cc-card-pad cc-stack">

          <h2 className="cc-h2">Your circles</h2>

          {memberships.map((m) => {

            const p = patientsById[m.patient_id];

            return (
              <div key={m.patient_id} className="cc-panel-soft cc-stack">

                <div className="cc-row-between">

                  <div>

                    <div className="cc-strong">
                      {p?.display_name ?? "Circle"}
                    </div>

                    <div className="cc-small">
                      role: {m.role}
                    </div>

                    <div className="cc-small">
                      vault shares: {sharesByPid[m.patient_id] ?? 0}
                    </div>

                  </div>

                  <div className="cc-row">

                    <Link
                      className="cc-btn"
                      href={`/app/patients/${m.patient_id}/vault`}
                    >
                      Vault
                    </Link>

                    {m.is_controller && (
                      <Link
                        className="cc-btn"
                        href={`/app/patients/${m.patient_id}/vault-init`}
                      >
                        Vault init
                      </Link>
                    )}

                  </div>

                </div>

              </div>
            );

          })}

        </div>

        {/* Invites */}

        <div className="cc-card cc-card-pad cc-stack">

          <h2 className="cc-h2">Invite members</h2>

          {memberships
            .filter((m) => m.is_controller)
            .map((m) => {

              const url = inviteUrlByPid[m.patient_id];

              return (
                <div key={m.patient_id} className="cc-panel-soft cc-stack">

                  <div className="cc-row-between">

                    <div>
                      <div className="cc-strong">
                        {patientsById[m.patient_id]?.display_name}
                      </div>
                    </div>

                    <button
                      className="cc-btn"
                      onClick={() => createInvite(m.patient_id)}
                      disabled={inviteBusyPid === m.patient_id}
                    >
                      {inviteBusyPid === m.patient_id
                        ? "Creating…"
                        : "Create invite"}
                    </button>

                  </div>

                  {url && (
                    <div className="cc-panel">

                      <div className="cc-row-between">

                        <div className="cc-wrap">
                          {url}
                        </div>

                        <button
                          className="cc-btn"
                          onClick={() => copy(url)}
                        >
                          Copy
                        </button>

                      </div>

                    </div>
                  )}

                </div>
              );

            })}

        </div>

        <button className="cc-btn cc-btn-danger" onClick={signOut}>
          Sign out
        </button>

      </div>
    </div>
  );
}