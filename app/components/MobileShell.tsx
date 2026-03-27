"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import BottomNav from "@/app/components/BottomNav";

type MobileShellProps = {
  title: string;
  subtitle?: string;
  patientId?: string;
  children: ReactNode;
  hideBottomNav?: boolean;
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
  hideBottomNav = false,
  rightSlot,
}: MobileShellProps) {
  const pathname = usePathname();
  const active = sectionForPath(pathname);

  return (
    <div className="cc-page">
      <div className="cc-app-shell">
        <div
          className={`cc-app-shell-inner ${hideBottomNav ? "cc-app-shell-inner-no-nav" : ""}`}
        >
          <header className="cc-mobile-header cc-card">
            <div className="cc-mobile-header-main">
              <div className="cc-mobile-header-row">
                <div className="cc-mobile-title-wrap">
                  <Link className="cc-brand-lockup" href="/app/hub" aria-label="Go to Hub">
                    <span className="cc-brand-mark" aria-hidden="true">
                      <Image
                        src="/images/carecircle-watermark.png"
                        alt=""
                        className="cc-brand-mark-img"
                        width={34}
                        height={34}
                      />
                    </span>
                    <span className="cc-brand-copy">
                      <span className="cc-kicker">CareBridge Studios</span>
                      <span className="cc-brand-name">CareCircle</span>
                    </span>
                  </Link>

                  <h1 className="cc-mobile-title">{title}</h1>
                  {subtitle ? <div className="cc-subtle cc-wrap">{subtitle}</div> : null}
                </div>

                <div className="cc-row">{rightSlot}</div>
              </div>
            </div>
          </header>

          <main className="cc-mobile-main">{children}</main>
        </div>

        {!hideBottomNav ? <BottomNav active={active} patientId={patientId} /> : null}
      </div>
    </div>
  );
}
