import JournalsClient from "./JournalsClient";

type PageProps = {
  params: { id: string };
};

export default function Page({ params }: PageProps) {
  return <JournalsClient patientId={params.id} />;
}