"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { BubbleTour, TourStep } from "@/app/app/_components/BubbleTour";

type Circle = {
  patient_id: string;
  patient_name: string | null;
  role: string | null;
};

type Feature = {
  feature_key: string;
  allowed: boolean;
};

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
  return role ?? "Circle member";
}

export default function MemberOnboardingPage() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        window.location.href = "/";
        return;
      }

      const r = await supabase.rpc("my_circles");
      if (r.data) {
        const mapped = (r.data as any[]).map((c) => ({
          patient_id: c.patient_id,
          patient_name: c.patient_name,
          role: c.role,
        }));

        setCircles(mapped);

        if (mapped.length === 1) {
          setSelected(mapped[0].patient_id);
        }
      }

      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;

    (async () => {
      const r = await supabase.rpc("get_effective_features", {
        p_patient_id: selected,
        p_user_id: null, // server defaults to auth.uid()
      });

      if (r.data) setFeatures(r.data as Feature[]);
      else setFeatures([]);
    })();
  }, [selected]);

  const selectedCircle = useMemo(() => circles.find((c) => c.patient_id === selected) ?? null, [circles, selected]);

  const steps: TourStep[] = useMemo(
    () => [
      {
        id: "welcome",
        selector: '[data-tour="welcome"]',
        title: "Welcome",
        body: "You’ve been invited to support a patient. You’ll see what you can access before entering.",
        placement: "bottom",
      },
      {
        id: "pick",
        selector: '[data-tour="circle-list"]',
        title: "Pick the patient",
        body: "Choose which patient you’re supporting. If you only have one, we’ll auto-select it.",
        placement: "bottom",
      },
      {
        id: "permissions",
        selector: selected ? '[data-tour="permissions-panel"]' : '[data-tour="circle-list"]',
        title: "Your permissions",
        body: "This list is your effective access. If something isn’t enabled, you won’t see it inside the CareCircle.",
        placement: "top",
      },
      {
        id: "enter",
        selector: selected ? '[data-tour="enter-button"]' : '[data-tour="circle-list"]',
        title: "Enter CareCircle",
        body: "When you’re ready, open the patient’s CareCircle. You can always come back here later.",
        placement: "top",
      },
      {
        id: "privacy",
        selector: '[data-tour="privacy"]',
        title: "Privacy & security",
        body: "Sensitive fields are encrypted. Access is permission-based. Key actions are audited for transparency.",
        placement: "top",
      },
    ],
    [selected]
  );

  if (loading) {
    return (
      <main className="cc-page">
        <div className="cc-container">
          <div className="cc-card cc-card-pad">Loading…</div>
        </div>
      </main>
    );
  }

  return (
    <main className="cc-page">
      {/* Subtle tooltip tour */}
      <BubbleTour tourId="circle-member-onboarding-v1" steps={steps} autoStart />

      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad" data-tour="welcome">
          <h1 className="cc-h1">Welcome to the CareCircle</h1>
          <div className="cc-subtle">You’ve been invited to support a patient.</div>
        </div>

        <div className="cc-card cc-card-pad" data-tour="circle-list">
          <div className="cc-row-between">
            <div>
              <div className="cc-strong">Your circles</div>
              <div className="cc-subtle">Select a patient to view what you can access.</div>
            </div>
            <div className="cc-small">{circles.length} circle{circles.length === 1 ? "" : "s"}</div>
          </div>

          <div className="cc-stack" style={{ marginTop: 12 } as any}>
            {circles.length === 0 ? (
              <div className="cc-panel">
                <div className="cc-strong">No circles found</div>
                <div className="cc-subtle" style={{ marginTop: 6 } as any}>
                  This usually means your invite hasn’t been accepted yet, or membership is still provisioning.
                </div>
              </div>
            ) : (
              circles.map((c) => {
                const active = selected === c.patient_id;

                return (
                  <div key={c.patient_id} className={active ? "cc-panel-green" : "cc-panel"}>
                    <div className="cc-row-between">
                      <div>
                        <div className="cc-strong">{c.patient_name ?? "Unnamed patient"}</div>
                        <div className="cc-small">Role: {humanRole(c.role)}</div>
                      </div>

                      <button
                        className={`cc-btn ${active ? "cc-btn-secondary" : ""}`}
                        onClick={() => setSelected(c.patient_id)}
                      >
                        {active ? "Selected" : "Select"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Permissions panel */}
        <div className="cc-card cc-card-pad" data-tour="permissions-panel">
          <div className="cc-row-between">
            <div>
              <div className="cc-strong">What you can do</div>
              <div className="cc-subtle">
                {selectedCircle
                  ? `For: ${selectedCircle.patient_name ?? "Unnamed patient"}`
                  : "Select a patient above to see your permissions."}
              </div>
            </div>

            {selectedCircle ? (
              <span className="cc-pill cc-pill-primary">You: {humanRole(selectedCircle.role)}</span>
            ) : null}
          </div>

          <div className="cc-panel-soft" style={{ marginTop: 12 } as any}>
            {!selectedCircle ? (
              <div className="cc-subtle">Pick a patient to see permissions.</div>
            ) : features.length === 0 ? (
              <div className="cc-subtle">No features returned yet. (This can happen briefly right after joining.)</div>
            ) : (
              <div className="cc-stack" style={{ gap: 6 } as any}>
                {features.map((f) => (
                  <div key={f.feature_key} className="cc-row-between">
                    <div className="cc-small">{f.feature_key}</div>
                    <div className="cc-small">{f.allowed ? "✔ Allowed" : "✖ Not allowed"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cc-spacer-12" />

          {selectedCircle ? (
            <Link
              data-tour="enter-button"
              href={`/app/patients/${selectedCircle.patient_id}?tab=overview`}
              className="cc-btn cc-btn-primary"
            >
              Enter CareCircle →
            </Link>
          ) : (
            <button className="cc-btn cc-btn-primary" disabled>
              Enter CareCircle →
            </button>
          )}
        </div>

        <div className="cc-card cc-card-pad" data-tour="privacy">
          <div className="cc-strong">Privacy & Security</div>
          <div className="cc-subtle" style={{ marginTop: 6 } as any}>
            Sensitive data is encrypted. Access is permission-based. All important actions are logged for transparency.
          </div>
        </div>
      </div>
    </main>
  );
}
