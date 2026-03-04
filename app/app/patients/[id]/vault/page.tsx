// app/app/patients/[id]/vault/page.tsx
import VaultClient from "./VaultClient";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { id: string } }) {
  return <VaultClient patientId={params.id} />;
}