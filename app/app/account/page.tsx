"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { BubbleTour } from "@/app/_components/BubbleTour";
import { accountEncryptionSteps } from "@/lib/tours";
import { restartAllTours } from "@/lib/tourReset";

type E2EEKeyRow = {
  id: string;
  device_label: string | null;
  created_at: string;
};

export default function AccountPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [hasPublicKey, setHasPublicKey] = useState(false);
  const [deviceKeys, setDeviceKeys] = useState<E2EEKeyRow[]>([]);
  const [vaultShareCount, setVaultShareCount] = useState(0);

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const user = auth.user;
      if (!user) {
        router.push("/login");
        return;
      }

      setEmail(user.email ?? null);
      setUserId(user.id);

      const { data: pk } = await supabase.from("user_public_keys").select("user_id").eq("user_id", user.id).limit(1);
      setHasPublicKey(!!pk && pk.length > 0);

      const { data: keys } = await supabase
        .from("user_e2ee_keys")
        .select("id, device_label, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      setDeviceKeys((keys ?? []) as E2EEKeyRow[]);

      const { data: shares } = await supabase.from("patient_vault_shares").select("id").eq("user_id", user.id);
      setVaultShareCount(shares?.length ?? 0);
    } catch (e: any) {
      setMsg(e?.message ?? "failed_to_load_account");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  function clearLocalDecryptCache() {
    try {
      localStorage.removeItem("carecircle_decrypt_cache");
      setMsg("Local decrypt cache cleared.");
    } catch {
      setMsg("Unable to clear local cache.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const encryptionIncomplete = !hasPublicKey || deviceKeys.length === 0;

  if (loading) {
    return (
      <div style={page}>
        <div style={shell}>
          <div style={card}>Loading account…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={shell}>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>Account</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={secondaryBtn} onClick={() => router.push("/hub")}>Back to Hub</button>
            <button
              style={secondaryBtn}
              onClick={() => {
                restartAllTours();
                location.reload();
              }}
            >
              Restart tour
            </button>
          </div>
        </div>

        {msg && <div style={infoBox}>{msg}</div>}

        <div style={card}>
          <div style={sectionTitle}>Account</div>
          <Row label="Email" value={email ?? "—"} />
          <Row label="User ID" value={userId ?? "—"} />
          <div style={{ marginTop: 12 }}>
            <button onClick={signOut} style={secondaryBtn}>Sign out</button>
          </div>
        </div>

        <div style={card}>
          <div style={sectionTitle}>Encryption status</div>

          <div id="public-key-status" style={{ marginBottom: 10 }}>
            <Row label="Public key registered" value={hasPublicKey ? "Yes" : "No"} />
          </div>

          <div id="device-keys-section" style={{ marginBottom: 10 }}>
            <Row label="Device keys" value={`${deviceKeys.length}`} />
          </div>

          <div id="vault-share-count" style={{ marginBottom: 10 }}>
            <Row label="Vault shares" value={`${vaultShareCount}`} />
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button id="clear-cache-btn" onClick={clearLocalDecryptCache} style={secondaryBtn}>
              Clear local decrypt cache
            </button>
            <button onClick={() => router.push("/hub")} style={secondaryBtn}>
              Manage circles
            </button>
          </div>

          {encryptionIncomplete ? (
            <div style={{ marginTop: 12, ...warnBox }}>
              Encryption is not fully configured on this account/device yet. Journals and messages may not decrypt until E2EE is set up.
            </div>
          ) : (
            <div style={{ marginTop: 12, ...okBox }}>
              Encryption is active on this device.
            </div>
          )}
        </div>

        <div style={card}>
          <div style={sectionTitle}>Registered devices</div>
          {deviceKeys.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No device keys found.</div>
          ) : (
            deviceKeys.map((k) => (
              <div key={k.id} style={deviceCard}>
                <div style={{ fontWeight: 900 }}>{k.device_label ?? "Unnamed device"}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Created {new Date(k.created_at).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>

        <BubbleTour
          tourId="account-encryption-v1"
          steps={accountEncryptionSteps}
          autoStart={true}
          forceOpen={encryptionIncomplete}
          // when encryption is incomplete, forceOpen bypasses "done"
          // once fixed, it behaves like a normal tour
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 900 }}>{value}</div>
    </div>
  );
}

/* styles */
const page: React.CSSProperties = { minHeight: "100vh", background: "linear-gradient(180deg, #fbfbfb 0%, #f6f6f6 100%)" };
const shell: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: 18 };

const card: React.CSSProperties = { border: "1px solid #eaeaea", borderRadius: 16, padding: 16, background: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,0.04)", marginBottom: 14 };
const sectionTitle: React.CSSProperties = { fontSize: 12, opacity: 0.75, fontWeight: 900, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.8 };

const secondaryBtn: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 900, cursor: "pointer" };

const deviceCard: React.CSSProperties = { border: "1px solid #eee", borderRadius: 12, padding: 10, marginBottom: 8 };

const infoBox: React.CSSProperties = { border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 12, background: "#fafafa", fontWeight: 800 };

const warnBox: React.CSSProperties = { border: "1px solid #f3d6a0", borderRadius: 12, padding: 12, background: "#fff8e7", fontWeight: 900 };
const okBox: React.CSSProperties = { border: "1px solid #cfe9cf", borderRadius: 12, padding: 12, background: "#e7ffe7", fontWeight: 900 };