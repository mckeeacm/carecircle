import DMClient from "./DMClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <DMClient patientId={resolved.id} />;
}