"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function ub64(s: string) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function sha256(text: string) {
  const enc = new TextEncoder().encode(text);
  const h = await crypto.subtle.digest("SHA-256", enc);
  return b64(h);
}

// Simple device key stored locally (you can later replace with a user passphrase)
function getOrCreateDeviceSecret() {
  const k = "cc_device_secret_v1";
  const existing = typeof window !== "undefined" ? window.localStorage.getItem(k) : null;
  if (existing) return existing;
  const rnd = crypto.getRandomValues(new Uint8Array(32));
  const secret = b64(rnd.buffer);
  window.localStorage.setItem(k, secret);
  return secret;
}

async function deriveAesKey(material: string, salt: string) {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(material), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key: CryptoKey, obj: any) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return { v: 1, alg: "AES-GCM", iv: b64(iv.buffer), ct: b64(ct) };
}

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
}

async function exportPubJwk(pub: CryptoKey) {
  return crypto.subtle.exportKey("jwk", pub);
}
async function exportPrivJwk(priv: CryptoKey) {
  return crypto.subtle.exportKey("jwk", priv);
}

export default function AccountPage() {
  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("…");
  const [userId, setUserId] = useState<string | null>(null);

  const [hasPublicKey, setHasPublicKey] = useState(false);
  const [hasEncPrivKey, setHasEncPrivKey] = useState(false);

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setEmail(data.user.email ?? "Signed in");
    setUserId(data.user.id);
    return data.user;
  }

  async function loadKeyStatus(uid: string) {
    const pub = await supabase.from("user_public_keys").select("user_id").eq("user_id", uid).maybeSingle();
    setHasPublicKey(!pub.error && !!pub.data);

    const priv = await supabase.from("user_e2ee_keys").select("user_id").eq("user_id", uid).maybeSingle();
    setHasEncPrivKey(!priv.error && !!priv.data);
  }

  async function setupE2EE() {
    if (!userId) return;

    try {
      setLoading("Generating encryption keys…");

      const deviceSecret = getOrCreateDeviceSecret();
      // use userId to make per-user salt stable
      const salt = await sha256(`cc_e2ee_salt:${userId}`);
      const aes = await deriveAesKey(deviceSecret, salt);

      const kp = await generateKeyPair();
      const pubJwk = await exportPubJwk(kp.publicKey);
      const privJwk = await exportPrivJwk(kp.privateKey);

      const encPriv = await encryptJson(aes, { kty: privJwk.kty, crv: (privJwk as any).crv, x: (privJwk as any).x, y: (privJwk as any).y, d: (privJwk as any).d });

      // upsert public key
      const up1 = await supabase.from("user_public_keys").upsert(
        { user_id: userId, public_key: pubJwk, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (up1.error) return setPageError(up1.error.message);

      // upsert encrypted private key
      const up2 = await supabase.from("user_e2ee_keys").upsert(
        { user_id: userId, encrypted_private_key: encPriv, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (up2.error) return setPageError(up2.error.message);

      await loadKeyStatus(userId);
      setOk("Encryption keys set up ✅");
    } catch (e: any) {
      setPageError(e?.message ?? "Failed to set up E2EE");
    }
  }

  useEffect(() => {
    (async () => {
      setLoading("Loading account…");
      const u = await requireAuth();
      if (!u) return;
      await loadKeyStatus(u.id);
      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-card cc-card-pad">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Account</h1>
              <div className="cc-subtle">Signed in as {email}</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/today`}>← Today</Link>
              <button
                className="cc-btn"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
              >
                🚪 Sign out
              </button>
            </div>
          </div>

          {status.kind !== "idle" && (
            <div
              className={[
                "cc-status",
                status.kind === "ok"
                  ? "cc-status-ok"
                  : status.kind === "loading"
                    ? "cc-status-loading"
                    : status.kind === "error"
                      ? "cc-status-error"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 } as any}
            >
              <div>
                {status.kind === "error" ? <span className="cc-status-error-title">Something needs attention: </span> : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="cc-card cc-card-pad">
          <h2 className="cc-h2">End-to-end encryption</h2>
          <div className="cc-subtle" style={{ marginTop: 6 } as any}>
            This device can generate and store your encryption keys. You’ll need this device secret (stored in your browser) to decrypt your private key.
          </div>

          <div className="cc-panel" style={{ marginTop: 12 } as any}>
            <div className="cc-row-between">
              <div>
                <div className="cc-strong">Key status</div>
                <div className="cc-small" style={{ marginTop: 6 } as any}>
                  Public key: {hasPublicKey ? "✅ set" : "— not set"}<br />
                  Encrypted private key: {hasEncPrivKey ? "✅ set" : "— not set"}
                </div>
              </div>

              <button className="cc-btn cc-btn-primary" onClick={setupE2EE}>
                🔐 Set up encryption keys
              </button>
            </div>

            <div className="cc-small" style={{ marginTop: 10 } as any}>
              Tip: if you clear browser storage, you’ll lose the device secret and won’t be able to decrypt old data on this device.
              We can add a human passphrase + recovery later.
            </div>
          </div>
        </div>

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}
