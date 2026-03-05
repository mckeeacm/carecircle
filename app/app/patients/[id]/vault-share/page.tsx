import { Suspense } from "react";
import VaultShareClient from "./VaultShareClient";

export default function Page({ params }: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">
            Loading vault sharing…
          </div>
        </div>
      }
    >
      <VaultShareClient pid={params.id} />
    </Suspense>
  );
}