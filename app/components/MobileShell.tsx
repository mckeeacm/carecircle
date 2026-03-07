"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BottomNav from "@/app/components/BottomNav";

type MobileShellProps = {
  title: string;
  subtitle?: string;
  patientId?: string;
  children: ReactNode;
  rightSlot?: ReactNode;
};

function sectionForPath(pathname: string): "today" | "journal" | "messages" | "profile" | "more" {
  if (pathname.includes("/journals")) return "journal";
  if (pathname.includes("/dm")) return "messages";
  if (
    pathname.includes("/profile") ||
    pathname.includes("/summary") ||
    pathname.includes("/medication-logs") ||
    pathname.includes("/appointments")
  ) {
    return "profile";
  }
  if (
    pathname.includes("/hub") ||
    pathname.includes("/account") ||
    pathname.includes("/permissions") ||
    pathname.includes("/onboarding")
  ) {
    return "more";
  }
  return "today";
}

export default function MobileShell({
  title,
  subtitle,
  patientId,
  children,
  rightSlot,
}: MobileShellProps) {
  const pathname = usePathname();
  const active = sectionForPath(pathname);

  return (
    <div className="cc-page">
      <div className="cc-app-shell">
        <div className="cc-app-shell-inner">
          <header className="cc-mobile-header cc-card">
            <div className="cc-mobile-header-main">
              <div className="cc-kicker">CareCircle</div>

              <div className="cc-mobile-header-row">
                <div>
                  <h1 className="cc-mobile-title">{title}</h1>
                  {subtitle ? <div className="cc-subtle cc-wrap">{subtitle}</div> : null}
                </div>

                <div className="cc-row">
                  {rightSlot}
                  <Link className="cc-logo-chip" href="/app/hub" aria-label="Go to Hub">
                    <img
                      src="/images/carecircle-watermark.png"
                      alt="CareCircle"
                      className="cc-logo-chip-img"
                    />
                  </Link>
                </div>
              </div>
            </div>
          </header>

          <main className="cc-mobile-main">
            {children}
          </main>
        </div>

        <BottomNav active={active} patientId={patientId} />
      </div>
    </div>
  );
}