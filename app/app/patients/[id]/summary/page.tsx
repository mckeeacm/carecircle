// app/app/patients/[id]/summary/page.tsx
import SummaryClient from "./SummaryClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <SummaryClient patientId={resolved.id} />;
}