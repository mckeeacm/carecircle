import MedicationLogsClient from "./MedicationLogsClient";

export default function MedicationLogsPage({ params }: { params: { patientId: string } }) {
  return <MedicationLogsClient patientId={params.patientId} />;
}