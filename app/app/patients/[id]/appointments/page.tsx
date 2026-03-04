import AppointmentsClient from "./AppointmentsClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <AppointmentsClient patientId={resolved.id} />;
}