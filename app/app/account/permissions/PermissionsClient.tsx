"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";

type FeatureKeyRow = {
  key: string;
  label: string | null;
  description: string | null;
};

type PermGet = {
  patient_id: string;
  user_id: string;
  role: string;
  is_controller: boolean;
  role_permissions: Record<string, boolean>;
  member_overrides: Record<string, boolean>;
  effective: Record<string, boolean>;
};

export default function PermissionsClient() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const sp = useSearchParams();

  const [msg, setMsg] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureKeyRow[]>([]);
  const [data, setData] = useState<PermGet | null>(null);

  const [patientId, setPatientId] = useState<string>("");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const pid = sp.get("pid");
    if (pid) setPatientId(pid);
  }, [sp]);

  useEffect(() => {
    loadFeatures();
  }, []);

  async function loadFeatures() {
    const { data, error } = await supabase
      .from("feature_keys")
      .select("key,label,description")
      .order("key");

    if (error) {
      setMsg(error.message);
      return;
    }

    setFeatures(data ?? []);
  }

  async function refresh() {
    if (!patientId) return;

    setLoading(true);
    setMsg(null);

    try {
      const { data, error } = await supabase.rpc("permissions_get", {
        pid: patientId,
      });

      if (error) throw error;

      setData(data as PermGet);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [patientId]);

  function roleAllowed(feature: string) {
    return data?.role_permissions?.[feature] === true;
  }

  function override(feature: string) {
    if (!data) return null;

    if (feature in data.member_overrides)
      return data.member_overrides[feature];

    return null;
  }

  function effective(feature: string) {
    return data?.effective?.[feature] === true;
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">

        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Permissions</h1>
            <div className="cc-subtle">
              Your access in this circle
            </div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">Hub</Link>
            <Link className="cc-btn" href="/app/account">Account</Link>
          </div>
        </div>

        {msg && (
          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Error</div>
            <div>{msg}</div>
          </div>
        )}

        <div className="cc-card cc-card-pad cc-stack">

          <div className="cc-row">
            <div>
              <div className="cc-label">Circle</div>
              <input
                className="cc-input"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
              />
            </div>

            <button
              className="cc-btn"
              onClick={refresh}
              disabled={!patientId || loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

        </div>

        {!data ? (
          <div className="cc-card cc-card-pad">
            No permissions loaded.
          </div>
        ) : (
          <div className="cc-card cc-card-pad cc-stack">

            <div className="cc-row">
              <span className="cc-pill">
                Role: {data.role}
              </span>

              <span className="cc-pill">
                Controller: {data.is_controller ? "yes" : "no"}
              </span>
            </div>

            <div className="cc-table-wrap">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Feature</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Override</th>
                    <th style={thStyle}>Effective</th>
                  </tr>
                </thead>

                <tbody>
                  {features.map((f) => {
                    const r = roleAllowed(f.key);
                    const o = override(f.key);
                    const e = effective(f.key);

                    return (
                      <tr key={f.key}>
                        <td style={tdStyle}>
                          <div className="cc-strong">
                            {f.label ?? f.key}
                          </div>

                          <div className="cc-small cc-subtle">
                            {f.description ?? f.key}
                          </div>
                        </td>

                        <td style={tdCenter}>
                          {r ? "Allowed" : "Denied"}
                        </td>

                        <td style={tdCenter}>
                          {o === null
                            ? "—"
                            : o
                            ? "Allow"
                            : "Deny"}
                        </td>

                        <td style={tdCenter}>
                          <b>{e ? "Allowed" : "Denied"}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.08)",
};

const tdStyle: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
};

const tdCenter: React.CSSProperties = {
  padding: 10,
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  textAlign: "center",
};