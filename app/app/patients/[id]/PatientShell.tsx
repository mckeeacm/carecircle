"use client";

import { PatientVaultProvider, PatientVaultGate } from "@/lib/e2ee/PatientVaultProvider";
import JournalsClient from "./journals/JournalsClient";
// (next)
// import DMClient from "./dm/DMClient";
// import SobrietyClient from "./sobriety/SobrietyClient";

export default function PatientShell({
  patientId,
  patientName,
  role,
  nickname,
}: {
  patientId: string;
  patientName: string;
  role: string;
  nickname: string | null;
}) {
  return (
    <div>
      <div style={{ padding: 16, borderBottom: "1px solid #eee" }}>
        <h1 style={{ margin: 0 }}>{patientName}</h1>
        <div style={{ opacity: 0.8 }}>
          Role: {role}
          {nickname ? ` • Nickname: ${nickname}` : ""}
        </div>
      </div>

      <PatientVaultProvider patientId={patientId}>
        <div style={{ padding: 16 }}>
          <PatientVaultGate>
            {/* Encrypted features (vaultKey available) */}
            <JournalsClient />

            {/* Next features in order */}
            {/* <SobrietyClient /> */}
            {/* <DMClient /> */}
          </PatientVaultGate>
        </div>
      </PatientVaultProvider>
    </div>
  );
}