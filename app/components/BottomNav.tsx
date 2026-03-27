"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUserLanguage } from "@/app/components/UserLanguageProvider";
import { t } from "@/lib/i18n";

type BottomNavProps = {
  active: "today" | "journal" | "messages" | "profile" | "more";
  patientId?: string;
};

function navClass(active: boolean, disabled = false) {
  return `cc-bottom-nav-item ${active ? "cc-bottom-nav-item-active" : ""} ${
    disabled ? "cc-bottom-nav-item-disabled" : ""
  }`;
}

function NavItem({
  href,
  active,
  disabled,
  icon,
  label,
}: {
  href?: string;
  active: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
}) {
  if (!href || disabled) {
    return (
      <button
        type="button"
        className={navClass(active, true)}
        disabled
        aria-disabled="true"
        style={{ cursor: "not-allowed" }}
      >
        <span className="cc-bottom-nav-icon">{icon}</span>
        <span className="cc-bottom-nav-label">{label}</span>
      </button>
    );
  }

  return (
    <Link className={navClass(active)} href={href}>
      <span className="cc-bottom-nav-icon">{icon}</span>
      <span className="cc-bottom-nav-label">{label}</span>
    </Link>
  );
}

export default function BottomNav({ active, patientId }: BottomNavProps) {
  const { languageCode } = useUserLanguage();
  const todayHref = patientId ? `/app/patients/${patientId}/today` : undefined;
  const journalHref = patientId ? `/app/patients/${patientId}/journals` : undefined;
  const messagesHref = patientId ? `/app/patients/${patientId}/dm` : undefined;
  const profileHref = patientId ? `/app/patients/${patientId}/profile` : undefined;

  const accountHref = "/app/account";
  const permissionsHref = "/app/account/permissions";
  const vaultHref = patientId ? `/app/patients/${patientId}/vault-init` : undefined;

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

  useEffect(() => {
    setMoreOpen(false);
  }, [patientId]);

  return (
    <nav className="cc-bottom-nav" aria-label="Primary navigation">
      <NavItem href={todayHref} active={active === "today"} disabled={!patientId} icon="T" label={t(languageCode, "nav.today")} />

      <NavItem
        href={journalHref}
        active={active === "journal"}
        disabled={!patientId}
        icon="J"
        label={t(languageCode, "nav.journal")}
      />

      <NavItem
        href={messagesHref}
        active={active === "messages"}
        disabled={!patientId}
        icon="M"
        label={t(languageCode, "nav.messages")}
      />

      <NavItem
        href={profileHref}
        active={active === "profile"}
        disabled={!patientId}
        icon="P"
        label={t(languageCode, "nav.profile")}
      />

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
          <span className="cc-bottom-nav-icon">+</span>
          <span className="cc-bottom-nav-label">{t(languageCode, "nav.more")}</span>
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
              {t(languageCode, "nav.account")}
            </Link>

            <Link
              className="cc-btn"
              href={permissionsHref}
              role="menuitem"
              onClick={() => setMoreOpen(false)}
              style={{ justifyContent: "flex-start", minHeight: 46 }}
            >
              {t(languageCode, "nav.permissions")}
            </Link>

            {vaultHref ? (
              <Link
                className="cc-btn"
                href={vaultHref}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                style={{ justifyContent: "flex-start", minHeight: 46 }}
              >
                {t(languageCode, "nav.secure_access")}
              </Link>
            ) : (
              <button
                type="button"
                className="cc-btn cc-btn-disabled"
                disabled
                aria-disabled="true"
                style={{ justifyContent: "flex-start", minHeight: 46, cursor: "not-allowed" }}
              >
                {t(languageCode, "nav.secure_access")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
