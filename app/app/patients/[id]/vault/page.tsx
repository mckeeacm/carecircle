import VaultClient from "./VaultClient";

export default function Page({ params }: { params: { id: string } }) {
  return <VaultClient patientId={params.id} />;
}