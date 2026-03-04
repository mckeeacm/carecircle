"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

export default function AccountClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  // invite UI state per circle
  const [inviteBusyPid, setInviteBusyPid] = useState<string | null>(null);
  const [inviteRoleByPid, setInviteRoleByPid] = useState<Record<string, string>>({});
  const [inviteDaysByPid, setInviteDaysByPid] = useState<Record<string, number>>({});
  const [inviteMaxUsesByPid, setInviteMaxUsesByPid] = useState<Record<string, number>>({});
  const [inviteUrlByPid, setInviteUrlByPid] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      setMsg(null);

      const { data, error } = await supabase.auth.getUser();
      if (error) return setMsg(error.message);

      const uid = data.user?.id;
      setEmail(data.user?.email ?? "");

      if (!uid) {
        setMsg("not_authenticated");
        return;
      }

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

      const pids = Array.from(new Set(ms.map((m) => m.patient_id)));
      if (pids.length === 0) return;

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

      // seed defaults for invite form
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
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_account"));
  }, [supabase]);

  async function signOut() {
    setMsg(null);
    const { error } = await supabase.auth.signOut();
    if (error) setMsg(error.message);
  }

  async function createInvite(patientId: string) {
    setMsg(null);
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
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

      // join route suggestion: you can wire this into /app/onboarding later
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
      // ignore (some browsers block clipboard in non-https/local)
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
            <div className="cc-status-error-title">Error</div>
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

        {/* Vault access (device recovery / setup) */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Vault access on this device</h2>
              <div className="cc-subtle">
                If DMs/journals/notes say “Vault key not available”, open the Vault for that circle to re-load the wrapped key
                and store it locally on this device.
              </div>
            </div>
          </div>

          {memberships.length === 0 ? (
            <div className="cc-small">No circles yet.</div>
          ) : (
            <div className="cc-stack">
              {memberships.map((m) => {
                const p = patientsById[m.patient_id];
                return (
                  <div key={m.patient_id} className="cc-panel-soft cc-stack">
                    <div className="cc-row-between">
                      <div className="cc-wrap">
                        <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                        <div className="cc-small cc-wrap">{m.patient_id}</div>
                        <div className="cc-small">
                          role: <b>{m.role}</b> • controller: <b>{m.is_controller ? "true" : "false"}</b>
                        </div>
                      </div>

                      <div className="cc-row">
                        <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${m.patient_id}/vault`}>
                          Open Vault
                        </Link>

                        {m.is_controller ? (
                          <Link className="cc-btn" href={`/app/patients/${m.patient_id}/vault-init`}>
                            Vault init
                          </Link>
                        ) : null}
                      </div>
                    </div>

                    <div className="cc-small cc-subtle">
                      “Open Vault” should unwrap your share from <code>patient_vault_shares</code> and cache the vault key locally for this device.
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Invites (controller-only for stability) */}
        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Invite a circle member</h2>
              <div className="cc-subtle">
                Invites add a member + role. Vault sharing is separate (E2EE): a controller must share the vault key to the new member after they join.
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
                  const p = patientsById[m.patient_id];
                  const role = inviteRoleByPid[m.patient_id] ?? "family";
                  const days = inviteDaysByPid[m.patient_id] ?? 7;
                  const maxUses = inviteMaxUsesByPid[m.patient_id] ?? 1;
                  const url = inviteUrlByPid[m.patient_id] ?? "";
                  const busy = inviteBusyPid === m.patient_id;

                  return (
                    <div key={`invite:${m.patient_id}`} className="cc-panel-soft cc-stack">
                      <div className="cc-row-between">
                        <div className="cc-wrap">
                          <div className="cc-strong">{p?.display_name ?? "Circle"}</div>
                          <div className="cc-small cc-wrap">{m.patient_id}</div>
                        </div>

                        <button className="cc-btn cc-btn-secondary" onClick={() => createInvite(m.patient_id)} disabled={busy}>
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
                            onChange={(e) => setInviteDaysByPid((prev) => ({ ...prev, [m.patient_id]: Number(e.target.value || 7) }))}
                          />
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">Max uses</div>
                          <input
                            className="cc-input"
                            type="number"
                            min={1}
                            value={maxUses}
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
                            After they accept, go to <b>Vault init / Vault</b> and share the vault key to them (creates their <code>patient_vault_shares</code> row).
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