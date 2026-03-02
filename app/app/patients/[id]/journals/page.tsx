import JournalsClient from "./JournalsClient";

export default function Page({ params }: { params: { id: string } }) {
  return <JournalsClient patientId={params.id} />;
}