import { Suspense } from "react";
import VaultInitClient from "./VaultInitClient";

export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">
            Loading vault initialisation…
          </div>
        </div>
      }
    >
      <VaultInitClient pid={params.id} />
    </Suspense>
  );
}