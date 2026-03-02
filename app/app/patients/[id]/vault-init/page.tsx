"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import VaultInitButton from "./VaultInitButton";

export default function VaultInitPage() {
  // ✅ Reliable in Client Components, works with your current /app/... route segment
  const params = useParams();

  // Next returns params values as string | string[] | undefined
  const pid = useMemo(() => {
    const raw = (params as any)?.id;
    if (!raw) return "";
    if (Array.isArray(raw)) return raw[0] ?? "";
    return String(raw);
  }, [params]);

  const disabledReason = !pid ? "missing pid (route param [id])" : null;

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>
        Vault Initialisation
      </h1>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e5e5",
          background: "rgba(0,0,0,0.02)",
          marginBottom: 14,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {`Route (current structure): /app/patients/[id]/vault-init
Detected id param: ${pid || "(empty)"}
Status: ${disabledReason ? `disabled — ${disabledReason}` : "ready"}`}
      </div>

      <VaultInitButton patientId={pid} disabled={!pid} />
    </div>
  );
}