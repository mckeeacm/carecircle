// app/app/patients/[id]/today/page.tsx
import TodayClient from "./TodayClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <TodayClient patientId={resolved.id} />;
}