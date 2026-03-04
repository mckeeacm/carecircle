import SobrietyClient from "./SobrietyClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <SobrietyClient patientId={resolved.id} />;
}