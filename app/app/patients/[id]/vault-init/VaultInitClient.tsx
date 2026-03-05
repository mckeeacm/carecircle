"use client";

import Link from "next/link";
import VaultInitButton from "./VaultInitButton";

export default function VaultInitClient({ pid }: { pid: string }) {
  if (!pid) {
    return (
      <div className="cc-page">
        <div className="cc-container cc-stack">
          <div className="cc-row-between">
            <div>
              <div className="cc-kicker">CareCircle</div>
              <h1 className="cc-h1">Vault setup</h1>
              <div className="cc-subtle">Controller-only.</div>
            </div>

            <div className="cc-row">
              <Link className="cc-btn" href="/app/hub">
                Hub
              </Link>
              <Link className="cc-btn" href="/app/account">
                Account
              </Link>
            </div>
          </div>

          <div className="cc-status cc-status-error">
            <div className="cc-status-error-title">Missing circle ID</div>
            <div className="cc-subtle">
              This page must be opened from a circle route like{" "}
              <code>/app/patients/&lt;id&gt;/vault-init</code>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page">
      <div className="cc-container cc-stack">
        <div className="cc-row-between">
          <div>
            <div className="cc-kicker">CareCircle</div>
            <h1 className="cc-h1">Vault setup</h1>
            <div className="cc-subtle cc-wrap">Circle: {pid}</div>
          </div>

          <div className="cc-row">
            <Link className="cc-btn" href="/app/hub">
              Hub
            </Link>
            <Link className="cc-btn" href="/app/account">
              Account
            </Link>
            <Link className="cc-btn cc-btn-secondary" href={`/app/patients/${pid}/vault`}>
              Vault
            </Link>
          </div>
        </div>

        <div className="cc-card cc-card-pad cc-stack">
          <div className="cc-subtle">
            This creates (or re-shares) the vault key to members who have enabled E2EE on their device.
          </div>

          <VaultInitButton pid={pid} />
        </div>
      </div>
    </div>
  );
}