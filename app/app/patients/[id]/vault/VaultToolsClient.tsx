"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

type EmailLookupRow = { user_id: string; email: string };

export default function VaultToolsClient({ patientId }: { patientId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("family");
  const [nickname, setNickname] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function goVaultInit() {
    router.push(`/patients/${patientId}/vault-init`);
  }

  async function addMemberByEmail() {
    const emailTrim = email.trim().toLowerCase();
    const roleTrim = role.trim().toLowerCase();
    const nickTrim = nickname.trim();

    if (!emailTrim.includes("@")) {
      setMsg("Please enter a valid email.");
      return;
    }
    if (!roleTrim) {
      setMsg("Please enter a role.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      // find user by email
      const { data: u, error: uErr } = await supabase
        .from("v_user_emails")
        .select("user_id, email")
        .eq("email", emailTrim)
        .maybeSingle();

      if (uErr) throw uErr;
      if (!u) throw new Error("No user found with that email.");

      const user = u as EmailLookupRow;

      // insert membership (best effort; ignore duplicate)
      const now = new Date().toISOString();
      const { error: insErr } = await supabase.from("patient_members").insert({
        patient_id: patientId,
        user_id: user.user_id,
        role: roleTrim,
        nickname: nickTrim ? nickTrim : null,
        is_controller: false,
        created_at: now,
      });

      if (insErr) {
        const m = (insErr as any)?.message?.toLowerCase?.() ?? "";
        const c = (insErr as any)?.code ?? "";
        const looksDup = c === "23505" || m.includes("duplicate") || m.includes("unique");
        if (!looksDup) throw insErr;
      }

      // set role + nickname through your audited RPC
      const { error: rpcErr } = await supabase.rpc("patient_members_set_role_nickname", {
        pid: patientId,
        member_uid: user.user_id,
        p_role: roleTrim,
        p_nickname: nickTrim,
      });

      if (rpcErr) throw rpcErr;

      // check for public key (so you know if vault-share will work after they init)
      const { data: pk, error: pkErr } = await supabase
        .from("user_public_keys")
        .select("user_id")
        .eq("user_id", user.user_id)
        .limit(1);

      if (!pkErr && (!pk || pk.length === 0)) {
        setMsg(
          "Member added. They don’t have a public key yet — ask them to sign in and initialise E2EE on their device, then you can share the vault from Vault Init."
        );
      } else {
        setMsg("Member added. Next: open Vault Init to share encryption keys.");
      }

      setEmail("");
      setNickname("");
    } catch (e: any) {
      setMsg(e?.message ?? "add_member_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>CareCircle</div>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.2 }}>Vault & Circle Tools</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          Controller-only tools to initialise encryption and add members.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={goVaultInit} disabled={busy} style={primaryBtn}>
          Open Vault Init
        </button>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Initialise and share E2EE keys for this circle.</div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 10 }}>Add member by email</div>

        <div style={{ display: "grid", gap: 10 }}>
          <label style={label}>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@example.com"
              style={input}
              disabled={busy}
            />
          </label>

          <label style={label}>
            Role (plaintext)
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="family / carer / professional / clinician"
              style={input}
              disabled={busy}
            />
          </label>

          <label style={label}>
            Nickname (optional)
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Sister / GP / Support worker"
              style={input}
              disabled={busy}
            />
          </label>

          <button onClick={addMemberByEmail} disabled={busy || !email.trim()} style={secondaryBtn}>
            {busy ? "Working…" : "Add member"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
            After adding a member, open <b>Vault Init</b> to share the vault (requires the member to have a public key in{" "}
            <code>user_public_keys</code>).
          </div>
        </div>
      </div>

      {msg && <div style={msgBox}>{msg}</div>}
    </div>
  );
}

/* ---------- Styles ---------- */

const card: React.CSSProperties = {
  border: "1px solid #eaeaea",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
  boxShadow: "0 6px 24px rgba(0,0,0,0.04)",
};

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 800,
  opacity: 0.8,
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  outline: "none",
  fontSize: 14,
  fontWeight: 650,
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};

const msgBox: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 12,
  background: "#fafafa",
  fontWeight: 800,
};