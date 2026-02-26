import ProfileClient from "./ProfileClient";

export default function ProfilePage({ params }: { params: { patientId: string } }) {
  return <ProfileClient patientId={params.patientId} />;
}