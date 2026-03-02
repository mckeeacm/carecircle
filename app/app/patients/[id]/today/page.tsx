// app/app/patients/[id]/today/page.tsx
import TodayClient from "./TodayClient";

export default function TodayPage() {
  // Server component wrapper: keeps browser-only code out of the server render.
  return <TodayClient />;
}