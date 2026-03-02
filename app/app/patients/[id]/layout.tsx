// app/app/patients/[id]/layout.tsx
import type { ReactNode } from "react";
import PatientLayoutClient from "./PatientLayoutClient";

export default async function PatientLayout({
  children,
  params,
}: {
  children: ReactNode;
  // Next.js versions can type params as Promise for dynamic segments
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  const patientId = resolved?.id;

  // No params in Root layout types here, only in this segment.
  return <PatientLayoutClient patientId={patientId}>{children}</PatientLayoutClient>;
}