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

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const uid = data.session?.user?.id;
  if (!uid) throw new Error("not_authenticated");

  const { publicKey } = await getOrCreateDeviceKeypair();

  const row = {
    user_id: uid,
    public_key: bytesToB64(publicKey),
    algorithm: "crypto_box_seal",
  };

  const { error: upsertErr } = await supabase.from("user_public_keys").upsert(row, { onConflict: "user_id" });
  if (upsertErr) throw upsertErr;
}