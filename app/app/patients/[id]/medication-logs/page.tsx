import MedicationLogsClient from "./MedicationLogsClient";

type PageProps = {
  params: { id: string };
};

export default function Page({ params }: PageProps) {
  return <MedicationLogsClient patientId={params.id} />;
}