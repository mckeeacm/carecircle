import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getServerEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function supabaseFromAuthHeader(authHeader: string | null) {
  const url = getServerEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getServerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anon, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return Response.json({ error: "Missing Authorization header" }, { status: 401 });

    webpush.setVapidDetails(
      getServerEnv("VAPID_SUBJECT"),
      getServerEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
      getServerEnv("VAPID_PRIVATE_KEY")
    );

    const supabase = supabaseFromAuthHeader(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return Response.json({ error: "Unauthenticated" }, { status: 401 });

    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data || data.length === 0) return Response.json({ error: "No subscriptions found for this user." }, { status: 400 });

    const payload = JSON.stringify({
      title: "CareCircle",
      body: "✅ Test push received.",
      url: "/app/today",
    });

    // Send to all (recent) subs; ignore failures and report them
    const results = await Promise.allSettled(
      data.map((s) =>
        webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        )
      )
    );

    const summary = results.map((r, i) => ({
      i,
      ok: r.status === "fulfilled",
      error: r.status === "rejected" ? String((r.reason as any)?.message ?? r.reason) : null,
    }));

    return Response.json({ ok: true, sent: summary });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
