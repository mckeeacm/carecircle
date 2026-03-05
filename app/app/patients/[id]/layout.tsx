import React from "react";
import { PatientVaultProvider } from "@/lib/e2ee/PatientVaultProvider";

export default async function PatientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PatientVaultProvider patientId={id}>
      {children}
    </PatientVaultProvider>
  );
}