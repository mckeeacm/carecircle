"use client";

import Link from "next/link";

type BottomNavProps = {
  active: "today" | "journal" | "messages" | "profile" | "more";
  patientId?: string;
};

function navClass(active: boolean) {
  return `cc-bottom-nav-item ${active ? "cc-bottom-nav-item-active" : ""}`;
}

export default function BottomNav({ active, patientId }: BottomNavProps) {
  const todayHref = patientId ? `/app/patients/${patientId}/today` : "/app/hub";
  const journalHref = patientId ? `/app/patients/${patientId}/journals` : "/app/hub";
  const messagesHref = patientId ? `/app/patients/${patientId}/dm` : "/app/hub";
  const profileHref = patientId ? `/app/patients/${patientId}/profile` : "/app/account";
  const moreHref = "/app/hub";

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

      <Link className={navClass(active === "more")} href={moreHref}>
        <span className="cc-bottom-nav-icon">⋯</span>
        <span className="cc-bottom-nav-label">More</span>
      </Link>
    </nav>
  );
}