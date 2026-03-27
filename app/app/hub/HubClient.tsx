"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import MobileShell from "@/app/components/MobileShell";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { t } from "@/lib/i18n";

type Membership = {
  patient_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
};

type PatientRow = {
  id: string;
  display_name: string | null;
};

type PermGet = {
  roles?: string[];
  members?: {
    user_id: string;
    role: string | null;
    nickname: string | null;
    is_controller: boolean | null;
    email?: string | null;
  }[];
  role_perms?: { patient_id: string; role: string; feature_key: string; allowed: boolean }[];
  member_perms?: { patient_id: string; user_id: string; feature_key: string; allowed: boolean }[];
};

function truthy(v: unknown) {
  return v === true;
}

function hasRolePermission(data: PermGet | null, role: string, key: string): boolean {
  const rp = data?.role_perms?.find((r) => r.role === role && r.feature_key === key);
  return rp ? truthy(rp.allowed) : false;
}

function getMemberOverride(data: PermGet | null, userId: string, key: string): boolean | null {
  const mp = data?.member_perms?.find((m) => m.user_id === userId && m.feature_key === key);
  return mp ? truthy(mp.allowed) : null;
}

function effectiveAllowed(
  data: PermGet | null,
  userId: string,
  role: string,
  key: string,
  isController: boolean
): boolean {
  if (isController) return true;
  const ov = getMemberOverride(data, userId, key);
  if (ov !== null) return ov;
  return hasRolePermission(data, role, key);
}

export default function HubClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { languageCode } = useUserLanguage();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, PatientRow>>({});
  const [permsByPid, setPermsByPid] = useState<Record<string, PermGet | null>>({});
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      setMemberships([]);
      setPatientsById({});
      setPermsByPid({});

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const uid = auth.user?.id;
        if (!uid) throw new Error("not_authenticated");
        setUserId(uid);

        const { data: pm, error: pmErr } = await supabase
          .from("patient_members")
          .select("patient_id, role, nickname, is_controller")
          .eq("user_id", uid);

        if (pmErr) throw pmErr;

        const ms = (pm ?? []) as Membership[];
        setMemberships(ms);

        if (ms.length > 0) {
          setOpenPatientId(ms[0].patient_id);
        }

        const pids = Array.from(new Set(ms.map((m) => m.patient_id)));
        if (pids.length === 0) {
          setLoading(false);
          return;
        }

        const { data: pts, error: pErr } = await supabase
          .from("patients")
          .select("id, display_name")
          .in("id", pids);

        if (pErr) throw pErr;

        const map: Record<string, PatientRow> = {};
        for (const p of (pts ?? []) as PatientRow[]) {
          map[p.id] = p;
        }
        setPatientsById(map);

        const nextPerms: Record<string, PermGet | null> = {};
        for (const pid of pids) {
          const { data, error } = await supabase.rpc("permissions_get", { pid });
          if (error) {
            nextPerms[pid] = null;
          } else {
            nextPerms[pid] = data as PermGet;
          }
        }
        setPermsByPid(nextPerms);
      } catch (e: any) {
        setMsg(e?.message ?? "failed_to_load_hub");
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  function togglePatient(pid: string) {
    setOpenPatientId((current) => (current === pid ? null : pid));
  }

  return (
    <MobileShell
      title={t(languageCode, "screen.hub")}
      subtitle={t(languageCode, "hub.subtitle")}
      hideBottomNav
      compactHeader
      rightSlot={
        <Link className="cc-btn" href="/app/account">
          {t(languageCode, "nav.account")}
        </Link>
      }
    >
      {msg ? (
        <div className="cc-status cc-status-error">
          <div className="cc-status-error-title">{t(languageCode, "common.error")}</div>
          <div className="cc-wrap">{msg}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="cc-card cc-card-pad">
          <div className="cc-subtle">{t(languageCode, "hub.loading_circles")}</div>
        </div>
      ) : memberships.length === 0 ? (
        <div className="cc-card cc-card-pad">
          <div className="cc-strong">{t(languageCode, "hub.no_circles_title")}</div>
          <div className="cc-subtle">{t(languageCode, "hub.no_circles_subtitle")}</div>
        </div>
      ) : (
        <div className="cc-stack">
          {memberships.map((m) => {
            const p = patientsById[m.patient_id];
            const perms = permsByPid[m.patient_id] ?? null;
            const role = m.role ?? "family";
            const isController = m.is_controller === true;
            const isOpen = openPatientId === m.patient_id;

            const canToday = true;
            const canSummary = effectiveAllowed(perms, userId, role, "summary_view", isController);

            return (
              <div
                key={m.patient_id}
                className="cc-card cc-card-pad"
                style={{
                  overflow: "hidden",
                  padding: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => togglePatient(m.patient_id)}
                  aria-expanded={isOpen}
                  aria-controls={`circle-panel-${m.patient_id}`}
                  style={{
                    width: "100%",
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    margin: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 14,
                      padding: "18px 18px 16px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 14,
                          flexShrink: 0,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 18,
                          fontWeight: 700,
                          background: "rgba(255,255,255,0.58)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                          border: "1px solid rgba(255,255,255,0.45)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        {(p?.display_name ?? "C").trim().charAt(0).toUpperCase()}
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          className="cc-strong"
                          style={{
                            fontSize: "1rem",
                            lineHeight: 1.2,
                            marginBottom: 4,
                          }}
                        >
                          {p?.display_name ?? t(languageCode, "hub.my_circle")}
                        </div>

                        <div className="cc-small cc-subtle" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <span>
                            {m.nickname
                              ? `${t(languageCode, "hub.you_label")}: ${m.nickname}`
                              : `${t(languageCode, "permissions.role_label")}: ${role}`}
                          </span>
                          {isController ? (
                            <span
                              className="cc-pill cc-pill-primary"
                              style={{ padding: "2px 8px", fontSize: "0.72rem" }}
                            >
                              {t(languageCode, "hub.controller")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div
                      aria-hidden="true"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.42)",
                        border: "1px solid rgba(255,255,255,0.42)",
                        backdropFilter: "blur(8px)",
                        fontSize: 18,
                        lineHeight: 1,
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 0.18s ease",
                      }}
                    >
                      {"›"}
                    </div>
                  </div>
                </button>

                {isOpen ? (
                  <div
                    id={`circle-panel-${m.patient_id}`}
                    style={{
                      borderTop: "1px solid rgba(255,255,255,0.35)",
                      padding: "0 18px 18px",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
                    }}
                  >
                    <div
                      className="cc-small cc-subtle"
                      style={{
                        paddingTop: 12,
                        paddingBottom: 12,
                      }}
                    >
                      {t(languageCode, "hub.open_circle")}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 10,
                        alignItems: "start",
                      }}
                    >
                      <Link
                        className={`cc-btn ${canToday ? "cc-btn-primary" : "cc-btn-disabled"}`}
                        href={`/app/patients/${m.patient_id}/today`}
                        style={{ width: "100%", minHeight: 0 }}
                      >
                        {t(languageCode, "hub.today_button")}
                      </Link>

                      <Link
                        className={`cc-btn ${canSummary ? "" : "cc-btn-disabled"}`}
                        href={`/app/patients/${m.patient_id}/summary`}
                        style={{ width: "100%", minHeight: 0 }}
                      >
                        {t(languageCode, "hub.summary_button")}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </MobileShell>
  );
}

