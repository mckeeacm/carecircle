"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

type TodayOverview = {
  circles: number;
  upcoming_appt_circles: number;
  active_meds: number;
  taken_today: number;
  journals_today_total: number;
  journals_today_shared: number;
  error?: string;
};

export default function TodayPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<TodayOverview | null>(null);

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
    return data.user;
  }

  async function loadToday() {
    setLoading("Loading Today…");
    const user = await requireAuth();
    if (!user) return;

    const r = await supabase.rpc("today_overview");
    if (r.error) return setPageError(r.error.message);

    const data = (r.data ?? {}) as TodayOverview;
    if (data.error) return setPageError(data.error);

    setOverview({
      circles: data.circles ?? 0,
      upcoming_appt_circles: data.upcoming_appt_circles ?? 0,
      active_meds: data.active_meds ?? 0,
      taken_today: data.taken_today ?? 0,
      journals_today_total: data.journals_today_total ?? 0,
      journals_today_shared: data.journals_today_shared ?? 0,
    });

    setOk("Up to date.");
  }

  useEffect(() => {
    loadToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pills = overview
    ? [
        { label: `Circles: ${overview.circles}` },
        { label: `With upcoming appt: ${overview.upcoming_appt_circles}` },
        { label: `Meds taken today: ${overview.taken_today}/${overview.active_meds}` },
        { label: `Journals today: ${overview.journals_today_total} (shared ${overview.journals_today_shared})` },
      ]
    : [];

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Today</h1>
              <div className="cc-subtle">At-a-glance dashboard for your circles.</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/account`}>⚙️ Account</Link>
              <button
                className="cc-btn"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
              >
                🚪 Sign out
              </button>
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

          <div className="cc-panel" style={{ marginTop: 12 } as any}>
            <div className="cc-row" style={{ flexWrap: "wrap" } as any}>
              {pills.map((p, i) => (
                <span key={i} className="cc-pill">{p.label}</span>
              ))}
              <div style={{ flex: 1 } as any} />
              <button className="cc-btn" onClick={loadToday}>↻ Refresh</button>
            </div>

            <div className="cc-small" style={{ marginTop: 10 } as any}>
              Tip: patient cards are compact — tap Open for full dashboard.
            </div>
          </div>
        </div>

        {/* Patient list (simple + reliable; your existing patient_members query is fine) */}
        <PatientList base={base} setPageError={setPageError} setLoading={setLoading} setOk={setOk} />
        <div className="cc-spacer-24" />
      </div>
    </main>
  );
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
  if (r === "guardian" || r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

function PatientList(props: {
  base: string;
  setPageError: (msg: string) => void;
  setLoading: (msg: string) => void;
  setOk: (msg: string) => void;
}) {
  const { base } = props;
  const [patients, setPatients] = useState<Array<{ patient_id: string; role: string; nickname: string | null; display_name: string }>>([]);

  useEffect(() => {
    (async () => {
      props.setLoading("Loading your circles…");
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        window.location.href = "/";
        return;
      }

      const q = await supabase
        .from("patient_members")
        .select("patient_id,role,nickname,patients:patients(id,display_name)")
        .eq("user_id", data.user.id)
        .order("created_at", { ascending: false });

      if (q.error) return props.setPageError(q.error.message);

      const mapped =
        (q.data ?? [])
          .filter((r: any) => r.patients?.id)
          .map((r: any) => ({
            patient_id: r.patient_id,
            role: r.role,
            nickname: r.nickname ?? null,
            display_name: r.patients.display_name,
          })) ?? [];

      setPatients(mapped);
      props.setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cc-card cc-card-pad">
      <div className="cc-row-between">
        <div>
          <h2 className="cc-h2">Your patients</h2>
          <div className="cc-subtle">Most important info first — open to manage journals, meds, DMs and permissions.</div>
        </div>
      </div>

      {patients.length === 0 ? (
        <div className="cc-panel" style={{ marginTop: 12 } as any}>
          <div className="cc-strong">No patients yet.</div>
          <div className="cc-subtle" style={{ marginTop: 6 } as any}>
            You’ll see circles here once you’re added as a member.
          </div>
        </div>
      ) : (
        <div className="cc-stack" style={{ marginTop: 12 } as any}>
          {patients.map((p) => (
            <div key={p.patient_id} className="cc-panel-soft">
              <div className="cc-row-between">
                <div>
                  <div className="cc-strong">
                    {p.nickname ? `${p.nickname} — ` : ""}{p.display_name}
                  </div>
                  <div className="cc-small">
                    You: <b>{humanRole(p.role)}</b>
                  </div>
                </div>

                <div className="cc-row">
                  <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${p.patient_id}`}>Open</Link>
                  <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=journals`}>📝 Journals</Link>
                  <Link className="cc-btn" href={`${base}/patients/${p.patient_id}?tab=dm`}>💬 DMs</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
