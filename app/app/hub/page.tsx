import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { ccPath, patientPath } from "@/app/app/patients/[id]/PatientShell";

export default async function HubPage() {
  const supabase = await supabaseServer();

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) {
    // unauth → go home (login)
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 520, width: "100%", padding: 24, border: "1px solid #ddd", borderRadius: 12 }}>
          <h1 style={{ marginTop: 0 }}>CareCircle</h1>
          <p>You are signed out.</p>
          <Link href="/" style={{ textDecoration: "none" }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  const { data: circles, error } = await supabase
    .from("patient_members")
    .select("patient_id, role, nickname, is_controller, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, margin: 0 }}>Hub</h1>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
              Signed in as {user.email ?? user.id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link
              href={ccPath("/today")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
            >
              Today
            </Link>
            <Link
              href={ccPath("/account")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
            >
              Account
            </Link>
          </div>
        </div>

        <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Your circles</div>

          {error ? (
            <div style={{ color: "crimson" }}>{error.message}</div>
          ) : circles?.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {circles.map((c) => (
                <Link
                  key={c.patient_id}
                  href={patientPath(c.patient_id, "today")}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    textDecoration: "none",
                    color: "#111",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.nickname ?? "Circle"}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      role: {c.role} {c.is_controller ? "• controller" : ""}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>Open →</div>
                </Link>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              You’re not in any circles yet.{" "}
              <Link href={ccPath("/onboarding")} style={{ textDecoration: "none" }}>
                Start onboarding
              </Link>
              .
            </div>
          )}
        </div>
      </div>
    </main>
  );
}