"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { usePatientVault } from "@/lib/e2ee/PatientVaultProvider";
import { vaultEncryptString } from "@/lib/e2ee/vaultCrypto";
import { decryptStringWithLocalCache } from "@/lib/e2ee/decryptWithCache";
import type { CipherEnvelopeV1 } from "@/lib/e2ee/envelope";

type ProfileRow = {
  patient_id: string;
  communication_notes_encrypted: CipherEnvelopeV1 | null;
  allergies_encrypted: CipherEnvelopeV1 | null;
  safety_notes_encrypted: CipherEnvelopeV1 | null;
  created_at: string;
  updated_at: string;
};

export default function ProfileClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { vaultKey } = usePatientVault();

  const [row, setRow] = useState<ProfileRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // plaintext form values (local only)
  const [communicationNotes, setCommunicationNotes] = useState("");
  const [allergies, setAllergies] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      const { data, error } = await supabase
        .from("patient_profiles")
        .select(
          "patient_id, communication_notes_encrypted, allergies_encrypted, safety_notes_encrypted, created_at, updated_at"
        )
        .eq("patient_id", patientId)
        .maybeSingle();

      if (error) throw error;

      const r = (data ?? null) as ProfileRow | null;
      setRow(r);

      // auto-decrypt into form if we can
      if (r && vaultKey) {
        const comm = r.communication_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: r.patient_id,
              column: "communication_notes_encrypted",
              env: r.communication_notes_encrypted,
              vaultKey,
            })
          : "";

        const alg = r.allergies_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: r.patient_id,
              column: "allergies_encrypted",
              env: r.allergies_encrypted,
              vaultKey,
            })
          : "";

        const safety = r.safety_notes_encrypted
          ? await decryptStringWithLocalCache({
              patientId,
              table: "patient_profiles",
              rowId: r.patient_id,
              column: "safety_notes_encrypted",
              env: r.safety_notes_encrypted,
              vaultKey,
            })
          : "";

        setCommunicationNotes(comm);
        setAllergies(alg);
        setSafetyNotes(safety);
      } else {
        // if no row or no vault key, keep as-is
      }
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, vaultKey]);

  async function save() {
    if (!vaultKey) return setMsg("no_vault_share");
    setSaving(true);
    setMsg(null);

    try {
      const commEnv = await vaultEncryptString({
        vaultKey,
        plaintext: communicationNotes,
        aad: { table: "patient_profiles", column: "communication_notes_encrypted", patient_id: patientId },
      });

      const allergiesEnv = await vaultEncryptString({
        vaultKey,
        plaintext: allergies,
        aad: { table: "patient_profiles", column: "allergies_encrypted", patient_id: patientId },
      });

      const safetyEnv = await vaultEncryptString({
        vaultKey,
        plaintext: safetyNotes,
        aad: { table: "patient_profiles", column: "safety_notes_encrypted", patient_id: patientId },
      });

      // upsert by patient_id
      const { error } = await supabase.from("patient_profiles").upsert(
        {
          patient_id: patientId,
          communication_notes_encrypted: commEnv,
          allergies_encrypted: allergiesEnv,
          safety_notes_encrypted: safetyEnv,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "patient_id" }
      );

      if (error) throw error;
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_save_profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>Patient profile</h2>

      {msg && <div style={{ border: "1px solid #c33", padding: 10, borderRadius: 10, marginBottom: 12 }}>{msg}</div>}

      {!vaultKey && (
        <div style={{ border: "1px solid #f0c", padding: 10, borderRadius: 10, marginBottom: 12 }}>
          Vault key not available on this device. You can’t decrypt or save encrypted profile fields.
        </div>
      )}

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          These fields are stored <b>end-to-end encrypted</b> as jsonb ciphertext.
        </div>

        <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Communication notes</label>
        <textarea
          value={communicationNotes}
          onChange={(e) => setCommunicationNotes(e.target.value)}
          rows={4}
          style={{ width: "100%", marginBottom: 10 }}
          placeholder="Encrypted notes…"
          disabled={!vaultKey}
        />

        <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Allergies</label>
        <textarea
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          rows={3}
          style={{ width: "100%", marginBottom: 10 }}
          placeholder="Encrypted allergies…"
          disabled={!vaultKey}
        />

        <label style={{ display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Safety notes</label>
        <textarea
          value={safetyNotes}
          onChange={(e) => setSafetyNotes(e.target.value)}
          rows={4}
          style={{ width: "100%", marginBottom: 10 }}
          placeholder="Encrypted safety notes…"
          disabled={!vaultKey}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={!vaultKey || saving} style={{ padding: "8px 10px", borderRadius: 10 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={refresh} disabled={loading} style={{ padding: "8px 10px", borderRadius: 10 }}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {row && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Updated: {new Date(row.updated_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}