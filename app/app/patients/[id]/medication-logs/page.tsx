import MedicationLogsClient from "./MedicationLogsClient";

export default function Page({ params }: { params: { id: string } }) {
  return <MedicationLogsClient patientId={params.id} />;
}