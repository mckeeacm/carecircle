"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

type Props = {
  patientId: string;
  title?: string;
  children: React.ReactNode;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Single source of truth for ALL app routes.
 * If you ever move /app to /(protected) etc, change it here once.
 */
export function ccPath(path: string) {
  // Ensure one leading slash
  const p = path.startsWith("/") ? path : `/${path}`;
  return `/app${p}`;
}

/**
 * Patient sub-routes (always under /app/patients/:id/*)
 */
export function patientPath(patientId: string, subPath: string = "") {
  const cleaned = subPath ? (subPath.startsWith("/") ? subPath : `/${subPath}`) : "";
  return ccPath(`/patients/${patientId}${cleaned}`);
}

const NAV = [
  { key: "today", label: "Today", sub: "today" },
  { key: "journals", label: "Journals", sub: "journals" },
  { key: "dm", label: "Messages", sub: "dm" },
  { key: "med_logs", label: "Medication logs", sub: "medication-logs" },
  { key: "profile", label: "Profile", sub: "profile" },
  { key: "permissions", label: "Permissions", sub: "permissions" },
  { key: "summary", label: "Clinician summary", sub: "summary" },
  { key: "vault", label: "Vault", sub: "vault" },
  { key: "vault_init", label: "Vault init", sub: "vault-init" },
] as const;

export default function PatientShell({ patientId, title, children }: Props) {
  const pathname = usePathname();

  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#fff" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
              <Link href={ccPath("/hub")} style={{ textDecoration: "none" }}>
                ← Back to Hub
              </Link>
            </div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{title ?? "Patient"}</h1>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Patient ID: {patientId}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link
              href={ccPath("/account")}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                textDecoration: "none",
                color: "#111",
              }}
            >
              Account
            </Link>
          </div>
        </div>

        {/* Nav */}
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 14,
            border: "1px solid #eee",
            background: "#fafafa",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {NAV.map((item) => {
            const href = patientPath(patientId, item.sub);
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={item.key}
                href={href}
                className={cx(active && "active")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: active ? "1px solid #111" : "1px solid #ddd",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#111",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ marginTop: 18 }}>{children}</div>
      </div>
    </main>
  );
}