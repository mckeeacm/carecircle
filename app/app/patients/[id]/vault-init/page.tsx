"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import VaultInitButton from "./VaultInitButton";

export default function VaultInitPage() {
  const params = useParams();

  const pid = useMemo(() => {
    const raw = (params as any)?.id;
    if (!raw) return "";
    if (Array.isArray(raw)) return raw[0] ?? "";
    return String(raw);
  }, [params]);

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
        Set up your encrypted vault
      </h1>

      <p style={{ marginTop: 0, opacity: 0.85, marginBottom: 16 }}>
        This step creates a vault key on your device and shares it securely with circle members using their public keys.
        Sensitive data remains end-to-end encrypted.
      </p>

      <VaultInitButton pid={pid} disabled={!pid} />
    </div>
  );
}