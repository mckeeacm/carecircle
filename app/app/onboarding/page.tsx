import { Suspense } from "react";
import OnboardingClient from "./OnboardingClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="cc-page"><div className="cc-container cc-card cc-card-pad">Loading onboarding…</div></div>}>
      <OnboardingClient />
    </Suspense>
  );
}