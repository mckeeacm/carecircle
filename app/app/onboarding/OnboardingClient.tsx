"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type CircleMembership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string;
};

type PatientRow = {
  id: string;
  display_name: string | null;
  created_by: string;
  created_at: string;
};

type StepId = "invite" | "circle" | "vault" | "permissions" | "finish";

type InviteAcceptResult = {
  patient_id: string;
  role: string;
  already_member: boolean;
};

function safeBool(v: unknown) {
  return v === true;
}

const INVITE_TOKEN_LS_KEY = "cc:invite_token_v1";

function buildSignInUrl(nextPath: string) {
  // Your app currently redirects unauth users to "/".
  // We preserve onboarding continuation via next=.
  const u = new URL("/", window.location.origin);
  u.searchParams.set("next", nextPath);
  return u.pathname + u.search;
}

function readStoredInviteToken() {
  try {
    const t = localStorage.getItem(INVITE_TOKEN_LS_KEY);
    return (t ?? "").trim() || null;
  } catch {
    return null;
  }
}

function storeInviteToken(t: string) {
  try {
    localStorage.setItem(INVITE_TOKEN_LS_KEY, t);
  } catch {
    // ignore
  }
}

function clearStoredInviteToken() {
  try {
    localStorage.removeItem(INVITE_TOKEN_LS_KEY);
  } catch {
    // ignore
  }
}

export default function OnboardingClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const sp = useSearchParams();

  const inviteTokenFromUrl = (sp.get("invite") ?? "").trim();

  const [uid, setUid] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<CircleMembership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});

  const [selectedPatientId, setSelectedPatientId] = useState<string>("");

  const [hasVaultShare, setHasVaultShare] = useState<boolean>(false);

  // Invite state
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "checking" | "need_auth" | "accepting" | "accepted" | "error"
  >("idle");
  const [inviteResult, setInviteResult] = useState<InviteAcceptResult | null>(null);

  // Create circle form
  const [newCircleName, setNewCircleName] = useState<string>("");

  const selectedMembership = memberships.find((m) => m.patient_id === selectedPatientId) ?? null;
  const selectedPatient = selectedPatientId ? patientsById[selectedPatientId] : null;
  const isController = safeBool(selectedMembership?.is_controller);

  const inviteTokenForFlow = inviteTokenFromUrl || readStoredInviteToken() || "";

  const currentStep: StepId = useMemo(() => {
    if (inviteTokenForFlow) {
      if (inviteStatus === "accepted") {
        // continue normal flow
      } else {
        return "invite";
      }
    }

    if (!selectedPatientId) return "circle";
    if (!hasVaultShare) return "vault";
    if (isController) return "permissions";
    return "finish";
  }, [inviteTokenForFlow, inviteStatus, selectedPatientId, hasVaultShare, isController]);

  const ensureAuthedOrRedirect = useCallback(
    async (nextPath: string) => {
      // Prefer getSession() for “are we signed in?” checks to avoid noisy getUser() errors on first load.
      const { data, error } = await supabase.auth.getSession();
      if (error) return { ok: false as const, userId: null as string | null };

      const session = data.session;
      if (!session?.user?.id) {
        setUid(null);

        // If invite is present (URL or stored), we explicitly show need_auth (not “Auth session missing!”).
        if (inviteTokenForFlow) setInviteStatus("need_auth");

        router.replace(buildSignInUrl(nextPath));
        return { ok: false as const, userId: null as string | null };
      }

      setUid(session.user.id);
      return { ok: true as const, userId: session.user.id };
    },
    [inviteTokenForFlow, router, supabase]
  );

  async function refresh() {
    setLoading(true);
    setMsg(null);

    try {
      // If not signed in, redirect; do not throw “Auth session missing!”
      const auth = await ensureAuthedOrRedirect("/app/onboarding");
      if (!auth.ok || !auth.userId) return;

      const meId = auth.userId;

      const { data: mem, error: memErr } = await supabase
        .from("patient_members")
        .select("patient_id, role, nickname, is_controller, created_at")
        .eq("user_id", meId)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ms = (mem ?? []) as CircleMembership[];
      setMemberships(ms);

      const ids = Array.from(new Set(ms.map((m) => m.patient_id)));

      if (ids.length === 0) {
        setPatientsById({});
        setSelectedPatientId("");
        setHasVaultShare(false);
        return;
      }

      const { data: pts, error: pErr } = await supabase
        .from("patients")
        .select("id, display_name, created_by, created_at")
        .in("id", ids);

      if (pErr) throw pErr;

      const map: Record<string, PatientRow> = {};
      (pts ?? []).forEach((p: any) => (map[p.id] = p as PatientRow));
      setPatientsById(map);

      if (!selectedPatientId) {
        const controller = ms.find((m) => safeBool(m.is_controller));
        setSelectedPatientId(controller?.patient_id ?? ms[0].patient_id);
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_onboarding");
    } finally {
      setLoading(false);
    }
  }

  async function refreshVaultShare(patientId: string, userId: string) {
    setHasVaultShare(false);
    try {
      const { data, error } = await supabase
        .from("patient_vault_shares")
        .select("id")
        .eq("patient_id", patientId)
        .eq("user_id", userId)
        .limit(1);

      if (error) throw error;
      setHasVaultShare((data ?? []).length > 0);
    } catch {
      setHasVaultShare(false);
    }
  }

  const acceptInviteToken = useCallback(
    async (token: string) => {
      if (!token) return;

      setMsg(null);
      setInviteResult(null);
      setInviteStatus("checking");

      // Ensure token is stored (so if we redirect mid-way we can resume)
      storeInviteToken(token);

      // Ensure signed in; if not, redirect and stop here.
      const auth = await ensureAuthedOrRedirect("/app/onboarding");
      if (!auth.ok || !auth.userId) {
        setInviteStatus("need_auth");
        return;
      }

      setInviteStatus("accepting");

      try {
        const { data, error } = await supabase.rpc("patient_invite_accept", {
          p_token: token,
        });

        if (error) throw error;

        const res = data as InviteAcceptResult;
        setInviteResult(res);
        setInviteStatus("accepted");

        // Clear stored token after success (prevents re-accepting on refresh)
        clearStoredInviteToken();

        await refresh();
        setSelectedPatientId(res.patient_id);
        await refreshVaultShare(res.patient_id, auth.userId);

        // Remove token from URL if still present (belt + braces)
        router.replace("/app/onboarding");
      } catch (e: any) {
        // If user is somehow signed out mid-request, treat as need_auth not error spam.
        const m = (e?.message ?? "").toLowerCase();
        if (m.includes("auth session missing") || m.includes("jwt") || m.includes("not authenticated")) {
          setInviteStatus("need_auth");
          setMsg(null);
          router.replace(buildSignInUrl("/app/onboarding"));
          return;
        }

        setInviteStatus("error");
        setMsg(e?.message ?? "failed_to_accept_invite");
      }
    },
    [ensureAuthedOrRedirect, refresh, router, supabase]
  );

  useEffect(() => {
    (async () => {
      // If invite token is in URL, store it immediately and remove from URL to avoid leaks.
      if (inviteTokenFromUrl) {
        storeInviteToken(inviteTokenFromUrl);
        router.replace("/app/onboarding");
        // Do not continue in this render; next render will use stored token.
        return;
      }

      await refresh();

      const stored = readStoredInviteToken();
      if (stored) {
        await acceptInviteToken(stored);
      }
    })().catch((e: any) => setMsg(e?.message ?? "failed_to_load_onboarding"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume after login if the user signs in while this page is open.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN") {
        const stored = readStoredInviteToken();
        if (stored) await acceptInviteToken(stored);
        else await refresh();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [acceptInviteToken, refresh, supabase.auth]);

  useEffect(() => {
    if (!uid || !selectedPatientId) return;
    refreshVaultShare(selectedPatientId, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selectedPatientId]);

  async function createCircle() {
    if (!uid) return;
    const name = newCircleName.trim();
    if (!name) return setMsg("Please enter a circle name.");

    setBusy("create-circle");
    setMsg(null);

    try {
      const pid = crypto.randomUUID();
      const now = new Date().toISOString();

      const { error: pErr } = await supabase.from("patients").insert({
        id: pid,
        display_name: name,
        created_by: uid,
        created_at: now,
      });
      if (pErr) throw pErr;

      const { error: mErr } = await supabase.from("patient_members").insert({
        patient_id: pid,
        user_id: uid,
        role: "family",
        nickname: null,
        is_controller: true,
        created_at: now,
      });
      if (mErr) throw mErr;

      const { error: seedErr } = await supabase.rpc("permissions_seed_defaults", { pid });
      if (seedErr) throw seedErr;

      setNewCircleName("");
      await refresh();
      setSelectedPatientId(pid);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_create_circle");
    } finally {
      setBusy(null);
    }
  }

  async function seedDefaults() {
    if (!selectedPatientId) return;
    setBusy("seed");
    setMsg(null);
    try {
      const { error } = await supabase.rpc("permissions_seed_defaults", { pid: selectedPatientId });
      if (error) throw error;
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_seed_defaults");
    } finally {
      setBusy(null);
    }
  }

  function StepRow({ label, active, done }: { label: string; active: boolean; done: boolean }) {
    return (
      <div className={`cc-panel-soft cc-row ${active ? "cc-panel-blue" : ""}`} style={{ justifyContent: "flex-start" }}>
        <span className={`cc-pill ${done ? "cc-pill-primary" : ""}`} style={{ minWidth: 34, textAlign: "center" }}>
          {done ? "✓" : "•"}
        </span>
        <div style={{ fontWeight: active ? 900 : 800, opacity: done ? 0.9 : 0.85 }}>{label}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-stack">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Onboarding</h1>
              <div className="cc-subtle">Loading…</div>
            </div>
            <div className="cc-row">
              <Link className="cc-btn" href="/app/hub">
                Hub
              </Link>
              <Link className="cc-btn" href="/app/account">
                Account
              </Link>
            </div>
          </div>

          <div className="cc-card cc-card-pad">
            <div className="cc-subtle">Loading onboarding…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Onboarding</h1>
            <div className="cc-subtle">Guided setup with E2EE + permissions.</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
            <Link className="cc-btn" href="/app/account">
              Account
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div className="cc-wrap">{msg}</div>
          </div>
        ) : null}

        <div className="cc-grid-2-125">
          <div className="cc-card cc-card-pad cc-stack">
            <div className="cc-strong">Getting started</div>

            {inviteTokenForFlow ? (
              <StepRow label="Join circle from invite" active={currentStep === "invite"} done={inviteStatus === "accepted"} />
            ) : null}

            <StepRow label="Create or select a circle" active={currentStep === "circle"} done={!!selectedPatientId} />
            <StepRow label="Set up vault access (E2EE)" active={currentStep === "vault"} done={!!selectedPatientId && hasVaultShare} />
            <StepRow label="Permissions & roles" active={currentStep === "permissions"} done={!!selectedPatientId && hasVaultShare && !isController} />
            <StepRow label="Finish" active={currentStep === "finish"} done={false} />

            {selectedPatientId ? (
              <div className="cc-panel">
                <div className="cc-small cc-subtle">Selected circle</div>
                <div className="cc-strong">{selectedPatient?.display_name ?? selectedPatientId}</div>
                <div className="cc-small cc-wrap">{selectedPatientId}</div>
                <div className="cc-small">
                  Role: <b>{selectedMembership?.role ?? "—"}</b>
                  {isController ? " • controller" : ""}
                </div>
              </div>
            ) : null}
          </div>

          <div className="cc-card cc-card-pad cc-stack">
            {currentStep === "invite" ? (
              <>
                <h2 className="cc-h2">Joining a circle…</h2>
                <div className="cc-subtle">You opened an invite link. We’ll add you to the circle and set your role.</div>

                {inviteStatus === "checking" || inviteStatus === "accepting" ? (
                  <div className="cc-status cc-status-loading">
                    <div className="cc-strong">{inviteStatus === "checking" ? "Checking sign-in…" : "Accepting invite…"}</div>
                    <div className="cc-subtle">Please keep this page open.</div>
                  </div>
                ) : null}

                {inviteStatus === "need_auth" ? (
                  <div className="cc-status cc-status-error">
                    <div className="cc-status-error-title">Sign in required</div>
                    <div className="cc-subtle">
                      Please sign in to accept this invite. You’ll be brought back here automatically.
                    </div>
                    <div className="cc-spacer-12" />
                    <button className="cc-btn cc-btn-primary" onClick={() => router.replace(buildSignInUrl("/app/onboarding"))}>
                      Go to sign in
                    </button>
                  </div>
                ) : null}

                {inviteStatus === "error" ? (
                  <>
                    <div className="cc-status cc-status-error">
                      <div className="cc-status-error-title">Invite could not be accepted</div>
                      <div className="cc-wrap">{msg ?? "unknown_error"}</div>
                    </div>

                    <div className="cc-row">
                      <button className="cc-btn cc-btn-primary" onClick={() => acceptInviteToken(readStoredInviteToken() ?? "")}>
                        Try again
                      </button>
                      <button className="cc-btn" onClick={() => router.push("/app/account")}>
                        Open Account
                      </button>
                      <button className="cc-btn" onClick={() => router.push("/app/hub")}>
                        Open Hub
                      </button>
                    </div>
                  </>
                ) : null}

                {inviteStatus === "accepted" && inviteResult ? (
                  <>
                    <div className="cc-status cc-status-ok">
                      <div className="cc-strong">
                        {inviteResult.already_member ? "You’re already a member of this circle." : "You’ve joined the circle!"}
                      </div>
                      <div className="cc-subtle">
                        role: <b>{inviteResult.role}</b>
                      </div>
                    </div>

                    <div className="cc-panel-blue">
                      <div className="cc-strong">Next: vault access</div>
                      <div className="cc-subtle">
                        Joining doesn’t automatically give decryption access. A controller must share the vault key to you.
                        Once they do, open Vault to cache it on this device.
                      </div>
                    </div>

                    <div className="cc-row">
                      <button
                        className="cc-btn"
                        onClick={() => {
                          if (!uid) return;
                          refreshVaultShare(inviteResult.patient_id, uid);
                        }}
                      >
                        Continue
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {currentStep === "circle" ? (
              <>
                <h2 className="cc-h2">Welcome to CareCircle</h2>
                <div className="cc-subtle">A circle is the patient context where journals, meds, appointments and secure notes live.</div>

                {memberships.length > 0 ? (
                  <>
                    <div className="cc-kicker">Select an existing circle</div>
                    <select className="cc-select" value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)}>
                      <option value="" disabled>
                        Select…
                      </option>
                      {memberships.map((m) => (
                        <option key={m.patient_id} value={m.patient_id}>
                          {(patientsById[m.patient_id]?.display_name ?? m.patient_id) + (safeBool(m.is_controller) ? " (controller)" : "")}
                        </option>
                      ))}
                    </select>

                    <div className="cc-spacer-12" />

                    <div className="cc-kicker">Or create a new circle</div>
                    <div className="cc-row">
                      <input
                        className="cc-input"
                        value={newCircleName}
                        onChange={(e) => setNewCircleName(e.target.value)}
                        placeholder="Circle name (e.g. Aisha’s Care)"
                      />
                      <button className="cc-btn cc-btn-primary" onClick={createCircle} disabled={busy === "create-circle"}>
                        {busy === "create-circle" ? "Creating…" : "Create circle"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="cc-kicker">Create your first circle</div>
                    <div className="cc-row">
                      <input
                        className="cc-input"
                        value={newCircleName}
                        onChange={(e) => setNewCircleName(e.target.value)}
                        placeholder="Circle name (e.g. Mum’s Care)"
                      />
                      <button className="cc-btn cc-btn-primary" onClick={createCircle} disabled={busy === "create-circle"}>
                        {busy === "create-circle" ? "Creating…" : "Create circle"}
                      </button>
                    </div>
                    <div className="cc-small cc-subtle">You’ll be set as the controller for this circle.</div>
                  </>
                )}

                {selectedPatientId ? (
                  <div className="cc-row">
                    <button
                      className="cc-btn"
                      onClick={() => {
                        if (!uid) return;
                        refreshVaultShare(selectedPatientId, uid);
                      }}
                    >
                      Continue
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {currentStep === "vault" ? (
              <>
                <h2 className="cc-h2">Secure vault (end-to-end encryption)</h2>
                <div className="cc-subtle">This device needs a vault share to decrypt and create secure content.</div>

                <div className="cc-panel">
                  <div className="cc-strong">What happens here?</div>
                  <div className="cc-subtle">
                    The vault key stays client-side. Controllers initialise + share. Members open Vault to cache their wrapped key for this device.
                  </div>
                </div>

                <div className="cc-row">
                  {isController ? (
                    <button className="cc-btn cc-btn-primary" onClick={() => router.push(`/app/patients/${selectedPatientId}/vault-init`)}>
                      Initialise vault for this circle
                    </button>
                  ) : (
                    <button className="cc-btn cc-btn-primary" onClick={() => router.push(`/app/patients/${selectedPatientId}/vault`)}>
                      Open Vault for this circle
                    </button>
                  )}

                  <button
                    className="cc-btn"
                    onClick={() => uid && selectedPatientId && refreshVaultShare(selectedPatientId, uid)}
                    disabled={!selectedPatientId}
                  >
                    I’ve done it — recheck
                  </button>
                </div>

                {hasVaultShare ? (
                  <div className="cc-status cc-status-ok">
                    <div className="cc-strong">Vault share detected for this circle.</div>
                    <div className="cc-subtle">You can decrypt and create encrypted content on this device.</div>
                  </div>
                ) : (
                  <div className="cc-small cc-subtle">
                    No vault share detected yet (or access blocked by RLS). If you’re not a controller, ask the controller to share the vault key to you.
                  </div>
                )}
              </>
            ) : null}

            {currentStep === "permissions" ? (
              <>
                <h2 className="cc-h2">Permissions & roles</h2>
                <div className="cc-subtle">
                  As controller you can set role defaults and member overrides. Seed defaults first, then fine-tune access.
                </div>

                <div className="cc-panel-blue">
                  <div className="cc-strong">Recommended next step</div>
                  <div className="cc-subtle">Seed defaults (safe + idempotent), then open Account → Permissions.</div>
                </div>

                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={seedDefaults} disabled={busy === "seed"}>
                    {busy === "seed" ? "Seeding…" : "Seed defaults"}
                  </button>

                  <button className="cc-btn" onClick={() => router.push("/app/account")}>
                    Open Account (permissions)
                  </button>

                  <button className="cc-btn" onClick={() => router.push("/app/hub")}>
                    Skip for now
                  </button>
                </div>

                <div className="cc-small cc-subtle">Tip: Role defaults apply first, then per-member overrides.</div>
              </>
            ) : null}

            {currentStep === "finish" ? (
              <>
                <h2 className="cc-h2">All set</h2>
                <div className="cc-subtle">You’re ready to use CareCircle across your circles.</div>

                <div className="cc-row">
                  <button className="cc-btn cc-btn-primary" onClick={() => router.push("/app/hub")}>
                    Go to Hub
                  </button>
                  <button className="cc-btn" onClick={() => router.push("/app/today")}>
                    Go to Today
                  </button>
                </div>

                {!isController ? (
                  <div className="cc-small cc-subtle">You’re not a controller in this circle, so permissions are managed by the controller.</div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="cc-small cc-subtle">Onboarding is guided but reversible — you can always revisit permissions or vault access later.</div>
      </div>
    </div>
  );
}