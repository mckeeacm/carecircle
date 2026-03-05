import { Suspense } from "react";
import VaultInitClient from "./VaultClient";

export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">Loading vault init…</div>
        </div>
      }
    >
      <VaultInitClient pid={params.id} />
    </Suspense>
  );
}