import AppointmentsClient from "./AppointmentsClient";

export default function AppointmentsPage({ params }: { params: { patientId: string } }) {
  return <AppointmentsClient patientId={params.patientId} />;
}