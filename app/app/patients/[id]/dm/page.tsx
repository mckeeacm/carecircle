import DMClient from "./DMClient";

export default function DMPage({ params }: { params: { patientId: string } }) {
  return <DMClient patientId={params.patientId} />;
}