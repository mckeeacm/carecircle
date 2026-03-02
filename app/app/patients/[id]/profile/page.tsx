// app/app/patients/[id]/profile/page.tsx
import ProfileClient from "./ProfileClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await Promise.resolve(params);
  return <ProfileClient patientId={resolved.id} />;
}