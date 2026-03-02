// app/app/patients/[id]/medication-logs/page.tsx
import MedicationLogsClient from "./MedicationLogsClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <MedicationLogsClient patientId={resolved.id} />;
}