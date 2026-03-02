import type { ReactNode } from "react";
import PatientVaultLayoutClient from "./PatientVaultLayoutClient";

type LayoutProps = {
  children: ReactNode;
  params: { id: string } | Promise<{ id: string }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const { id } = await Promise.resolve(params);
  return <PatientVaultLayoutClient patientId={id}>{children}</PatientVaultLayoutClient>;
}