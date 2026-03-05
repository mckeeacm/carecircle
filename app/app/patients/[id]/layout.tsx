import React from "react";
import { PatientVaultProvider } from "@/lib/e2ee/PatientVaultProvider";

export default function PatientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  // IMPORTANT: segment is [id] not [pid]
  const patientId = params.id;

  // Provider at layout level => persists across /today /dm /journals etc.
  return <PatientVaultProvider patientId={patientId}>{children}</PatientVaultProvider>;
}