"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type PatientRow = {
  id: string;
  display_name: string;
  created_at: string | null;
};

type MemberRow = {
  patient_id: string;
  user_id: string;
  role: string | null;
  nickname: string | null;
  is_controller: boolean | null;
  created_at: string | null;
  patients: PatientRow | null;
};

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

function humanRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  if (!r) return "Circle member";
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "support_worker") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "professional_support") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "owner") return "Patient / Guardian";
  if (r === "guardian") return "Legal guardian";
  if (r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(iso));
}

export default function PatientsPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState<string>("…");

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setEmail(data.user.email ?? data.user.id);
    return data.user;
  }

  async function load() {
    const user = await requireAuth();
    if (!user) return;

    setLoading("Loading your circles…");

    const q = await supabase
      .from("patient_members")
      .select("patient_id,user_id,role,nickname,is_controller,created_at,patients:patients(id,display_name,created_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (q.error) return setPageError(q.error.message);

    const data = (q.data ?? []) as unknown as MemberRow[];
    setRows(data.filter((r) => !!r.patients?.id));
    setOk("Up to date.");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Patients</h1>
              <div className="cc-subtle">Signed in as <b>{email}</b></div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/today`}>🗓️ Today</Link>
              <button className="cc-btn" onClick={load}>↻ Refresh</button>
            </div>
          </div>

          {status.kind !== "idle" && (
            <div
              className={[
                "cc-status",
                status.kind === "ok"
                  ? "cc-status-ok"
                  : status.kind === "loading"
                    ? "cc-status-loading"
                    : status.kind === "error"
                      ? "cc-status-error"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 } as any}
            >
              <div>
                {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* At-a-glance summary (compact, no new colours) */}
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">At a glance</h2>
              <div className="cc-subtle">Your circles, with role + nickname.</div>
            </div>
            <div className="cc-row">
              <span className="cc-pill">Circles: <b>{rows.length}</b></span>
              <span className="cc-pill">Controllers: <b>{rows.filter((r) => !!r.is_controller).length}</b></span>
            </div>
          </div>
        </div>

        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <h2 className="cc-h2">Your circles</h2>
              <div className="cc-subtle">Open a circle to view Overview, Meds, Journals, Appointments, Permissions.</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="cc-panel" style={{ marginTop: 12 } as any}>
              <div className="cc-strong">No circles yet.</div>
              <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                You’ll see circles here once you’re added as a member.
              </div>
            </div>
          ) : (
            <div className="cc-stack" style={{ marginTop: 12 } as any}>
              {rows.map((m) => {
                const p = m.patients!;
                const nick = (m.nickname ?? "").trim();

                return (
                  <div key={`${m.patient_id}:${m.user_id}`} className="cc-panel-soft">
                    <div className="cc-row-between" style={{ alignItems: "flex-start" } as any}>
                      <div>
                        <div className="cc-strong" style={{ display: "flex", gap: 10, alignItems: "center" } as any}>
                          <span>{p.display_name}</span>
                          {m.is_controller ? <span className="cc-pill">controller</span> : null}
                        </div>

                        <div className="cc-small" style={{ marginTop: 6 } as any}>
                          You: <b>{humanRole(m.role)}</b>
                          {nick ? <> • Nickname: <b>{nick}</b></> : null}
                        </div>

                        {p.created_at ? (
                          <div className="cc-small" style={{ marginTop: 4 } as any}>
                            Created: {fmt(p.created_at)}
                          </div>
                        ) : null}
                      </div>

                      <div className="cc-row">
                        <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${m.patient_id}`}>
                          Open
                        </Link>
                        <Link className="cc-btn" href={`${base}/patients/${m.patient_id}?tab=meds`}>
                          💊
                        </Link>
                        <Link className="cc-btn" href={`${base}/patients/${m.patient_id}?tab=journals`}>
                          📝
                        </Link>
                        <Link className="cc-btn" href={`${base}/patients/${m.patient_id}?tab=appointments`}>
                          📅
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
