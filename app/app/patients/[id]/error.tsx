"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Patient route crashed</h2>

      <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700 }}>Error</div>
        <div style={{ whiteSpace: "pre-wrap" }}>{error.message}</div>
        {error.digest ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>digest: {error.digest}</div>
        ) : null}
      </div>

      <button onClick={reset} style={{ marginTop: 12, padding: "8px 10px", borderRadius: 10 }}>
        Retry
      </button>
    </div>
  );
}