import { Suspense } from "react";
import { notFound } from "next/navigation";
import VaultInitClient from "./VaultInitClient";

export default function Page({ params }: { params: { id: string } }) {
  const pid = (params?.id ?? "").trim();
  if (!pid) return notFound();

  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">
            Loading vault setup…
          </div>
        </div>
      }
    >
      <VaultInitClient pid={pid} />
    </Suspense>
  );
}