import TodayClient from "./TodayClient";

export default function Page({ params }: { params: { id: string } }) {
  return <TodayClient patientId={params.id} />;
}