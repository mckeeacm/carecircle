"use client";

import type { ReactNode } from "react";
import { PatientVaultProvider } from "@/lib/e2ee/PatientVaultProvider";

export default function PatientVaultLayoutClient({
  patientId,
  children,
}: {
  patientId: string;
  children: ReactNode;
}) {
  return <PatientVaultProvider patientId={patientId}>{children}</PatientVaultProvider>;
}