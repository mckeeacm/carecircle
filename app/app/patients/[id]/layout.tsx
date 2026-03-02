import type { ReactNode } from "react";
import PatientVaultLayoutClient from "./PatientVaultLayoutClient";

export default function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  return <PatientVaultLayoutClient patientId={params.id}>{children}</PatientVaultLayoutClient>;
}