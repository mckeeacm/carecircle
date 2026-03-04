import DmClient from "./DmClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <DmClient patientId={resolved.id} />;
}