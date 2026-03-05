import { Suspense } from "react";
import VaultInitClient from "./VaultInitClient";

function normaliseId(raw: unknown): string {
  if (!raw) return "";
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw);
}

export default function Page({ params }: { params: { id?: string | string[] } }) {
  const pid = normaliseId(params?.id);

  return (
    <Suspense
      fallback={
        <div className="cc-page">
          <div className="cc-container cc-card cc-card-pad">Loading vault setup…</div>
        </div>
      }
    >
      <VaultInitClient pid={pid} />
    </Suspense>
  );
}