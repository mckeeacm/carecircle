"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type BottomNavProps = {
  active: "today" | "journal" | "messages" | "profile" | "more";
  patientId?: string;
};

function navClass(active: boolean) {
  return `cc-bottom-nav-item ${active ? "cc-bottom-nav-item-active" : ""}`;
}

export default function BottomNav({ active, patientId }: BottomNavProps) {
  const todayHref = patientId ? `/app/patients/${patientId}/today` : "/app/today";
  const journalHref = patientId ? `/app/patients/${patientId}/journals` : "/app/journal";
  const messagesHref = patientId ? `/app/patients/${patientId}/dm` : "/app/messages";
  const profileHref = patientId ? `/app/patients/${patientId}/profile` : "/app/profile";

  const accountHref = "/app/account";
  const permissionsHref = "/app/account/permissions";
  const vaultHref = patientId ? `/app/patients/${patientId}/vault-init` : "/app/vault";

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }

    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <nav className="cc-bottom-nav" aria-label="Primary navigation">
      <Link className={navClass(active === "today")} href={todayHref}>
        <span className="cc-bottom-nav-icon">◷</span>
        <span className="cc-bottom-nav-label">Today</span>
      </Link>

      <Link className={navClass(active === "journal")} href={journalHref}>
        <span className="cc-bottom-nav-icon">✎</span>
        <span className="cc-bottom-nav-label">Journal</span>
      </Link>

      <Link className={navClass(active === "messages")} href={messagesHref}>
        <span className="cc-bottom-nav-icon">✉</span>
        <span className="cc-bottom-nav-label">Messages</span>
      </Link>

      <Link className={navClass(active === "profile")} href={profileHref}>
        <span className="cc-bottom-nav-icon">☰</span>
        <span className="cc-bottom-nav-label">Profile</span>
      </Link>

      <div
        ref={moreRef}
        style={{
          position: "relative",
          display: "flex",
          flex: 1,
        }}
      >
        <button
          type="button"
          className={navClass(active === "more" || moreOpen)}
          onClick={() => setMoreOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          style={{
            width: "100%",
          }}
        >
          <span className="cc-bottom-nav-icon">⋯</span>
          <span className="cc-bottom-nav-label">More</span>
        </button>

        {moreOpen ? (
          <div
            className="cc-card"
            role="menu"
            aria-label="More navigation"
            style={{
              position: "absolute",
              right: 0,
              bottom: "calc(100% + 10px)",
              minWidth: 220,
              padding: 10,
              borderRadius: 18,
              display: "grid",
              gap: 8,
              zIndex: 50,
            }}
          >
            <Link
              className="cc-btn"
              href={accountHref}
              role="menuitem"
              onClick={() => setMoreOpen(false)}
              style={{ justifyContent: "flex-start", minHeight: 46 }}
            >
              Account
            </Link>

            <Link
              className="cc-btn"
              href={permissionsHref}
              role="menuitem"
              onClick={() => setMoreOpen(false)}
              style={{ justifyContent: "flex-start", minHeight: 46 }}
            >
              Permissions
            </Link>

            <Link
              className="cc-btn"
              href={vaultHref}
              role="menuitem"
              onClick={() => setMoreOpen(false)}
              style={{ justifyContent: "flex-start", minHeight: 46 }}
            >
              Vault
            </Link>
          </div>
        ) : null}
      </div>
    </nav>
  );
}