// app/app/hub/page.tsx
import HubClient from "./HubClient";

export default function HubPage() {
  // Server component that only renders a client component.
  // Prevents server crashes from browser-only E2EE modules.
  return <HubClient />;
}