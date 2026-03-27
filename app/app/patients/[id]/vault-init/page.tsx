import { Suspense } from "react";
import VaultInitClient from "./VaultInitClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">Loading secure access...</div>
        </div>
      }
    >
      <VaultInitClient />
    </Suspense>
  );
}
