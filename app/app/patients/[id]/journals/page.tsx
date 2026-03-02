// app/app/patients/[id]/journals/page.tsx
import JournalsClient from "./JournalsClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <JournalsClient patientId={resolved.id} />;
}