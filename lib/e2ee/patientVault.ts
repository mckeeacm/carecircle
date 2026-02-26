import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "./deviceKeys";
import { unwrapVaultKeyForMe, wrapVaultKeyForRecipient, type WrappedKeyV1 } from "./vaultShares";
import { getSodium } from "./sodium";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function ensureUserPublicKeyRegistered(): Promise<{ userId: string; publicKeyB64: string }> {
  const supabase = supabaseBrowser();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("not_authenticated");

  const { publicKey } = await getOrCreateDeviceKeypair();
  const publicKeyB64 = bytesToB64(publicKey);

  // Clean insert (no assumptions about unique constraints)
  await supabase.from("user_public_keys").delete().eq("user_id", user.id);

  const { error } = await supabase.from("user_public_keys").insert({
    user_id: user.id,
    public_key: publicKeyB64, // base64 raw
    algorithm: "curve25519",
  });

  if (error) throw error;

  return { userId: user.id, publicKeyB64 };
}

export async function loadMyPatientVaultKey(patientId: string): Promise<Uint8Array> {
  const supabase = supabaseBrowser();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("not_authenticated");

  const { data: share, error } = await supabase
    .from("patient_vault_shares")
    .select("wrapped_key")
    .eq("patient_id", patientId)
    .eq("user_id", user.id)
    .single();

  if (error) throw error;
  if (!share?.wrapped_key) throw new Error("no_vault_share");

  const { publicKey, privateKey } = await getOrCreateDeviceKeypair();

  return unwrapVaultKeyForMe({
    wrapped: share.wrapped_key as WrappedKeyV1,
    myPublicKey: publicKey,
    myPrivateKey: privateKey,
  });
}

export async function initialiseVaultForPatient(patientId: string): Promise<void> {
  const supabase = supabaseBrowser();

  const { data: isCtl, error: ctlErr } = await supabase.rpc("is_patient_controller", { patient_id: patientId });
  if (ctlErr) throw ctlErr;
  if (!isCtl) throw new Error("not_controller");

  // Ensure controller has a registered pubkey
  await ensureUserPublicKeyRegistered();

  // Get members
  const { data: members, error: memErr } = await supabase
    .from("patient_members")
    .select("user_id")
    .eq("patient_id", patientId);
  if (memErr) throw memErr;

  const userIds: string[] = (members ?? []).map((m: any) => m.user_id);
  if (userIds.length === 0) throw new Error("no_members_found");

  // Get public keys for members
  const { data: pubKeys, error: pkErr } = await supabase
    .from("user_public_keys")
    .select("user_id, public_key")
    .in("user_id", userIds);
  if (pkErr) throw pkErr;

  const missing = userIds.filter((uid: string) => !(pubKeys ?? []).some((p: any) => p.user_id === uid));
  if (missing.length > 0) throw new Error(`missing_public_keys_for_${missing.length}_members`);

  const sodium = await getSodium();
  const vaultKey = sodium.randombytes_buf(32);

  // Clean existing shares for patient
  const { error: delErr } = await supabase.from("patient_vault_shares").delete().eq("patient_id", patientId);
  if (delErr) throw delErr;

  const rows = await Promise.all(
    (pubKeys ?? []).map(async (p: any) => {
      const recipientPk = b64ToBytes(p.public_key);
      const wrapped = await wrapVaultKeyForRecipient({ vaultKey, recipientPublicKey: recipientPk });
      return { patient_id: patientId, user_id: p.user_id, wrapped_key: wrapped };
    })
  );

  const { error: insErr } = await supabase.from("patient_vault_shares").insert(rows);
  if (insErr) throw insErr;
}

// US spelling alias
export const initializeVaultForPatient = initialiseVaultForPatient;