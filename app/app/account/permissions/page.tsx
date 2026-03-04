import { Suspense } from "react";
import PermissionsClient from "./PermissionsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading permissions…</div>}>
      <PermissionsClient />
    </Suspense>
  );
}