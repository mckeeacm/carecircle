import { Suspense } from "react";
import PermissionsClient from "./PermissionsClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">Loading permissions…</div>
        </div>
      }
    >
      <PermissionsClient />
    </Suspense>
  );
}