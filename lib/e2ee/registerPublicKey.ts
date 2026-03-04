"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { getOrCreateDeviceKeypair } from "@/lib/e2ee/deviceKeys";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Ensures the current user has a row in user_public_keys.
 * Label-stable: user_id, public_key, algorithm
 */
export async function registerMyPublicKey(): Promise<void> {
  const supabase = supabaseBrowser();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");

  const { publicKey } = await getOrCreateDeviceKeypair();

  const row = {
    user_id: uid,
    public_key: bytesToB64(publicKey), // base64 raw bytes
    algorithm: "crypto_box_seal",       // matches your WrappedKeyV1 alg
  };

  // Prefer upsert if you have a unique constraint on user_id.
  // If you don't, this will error — tell me and I’ll switch to insert+fallback.
  const { error } = await supabase.from("user_public_keys").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
}