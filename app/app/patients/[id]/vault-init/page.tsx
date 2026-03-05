import { Suspense } from "react";
import { notFound } from "next/navigation";
import VaultInitButton from "./VaultInitButton";

export default function Page({ params }: { params: { id: string } }) {
  if (!params?.id) return notFound();

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
      <div className="cc-page">
        <div className="cc-container cc-stack">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault setup</h1>
          </div>

          <VaultInitButton pid={params.id} />
        </div>
      </div>
    </Suspense>
  );
}