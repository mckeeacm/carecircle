// app/app/patients/[id]/PatientLayoutClient.tsx
"use client";

import type { ReactNode } from "react";
import { PatientVaultProvider } from "@/lib/e2ee/PatientVaultProvider";

export default function PatientLayoutClient({
  patientId,
  children,
}: {
  patientId: string;
  children: ReactNode;
}) {
  // PatientVaultProvider should accept patientId (if your current provider doesn’t,
  // add it — this is the cleanest, non-drifting fix).
  return <PatientVaultProvider patientId={patientId}>{children}</PatientVaultProvider>;
}