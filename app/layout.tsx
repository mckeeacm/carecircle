import PatientVaultLayoutClient from "./PatientVaultLayoutClient";

export default function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return <PatientVaultLayoutClient patientId={params.id}>{children}</PatientVaultLayoutClient>;
}