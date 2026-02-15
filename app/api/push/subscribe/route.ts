import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type SubscribeBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
};

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
    const authHeader = req.headers.get("authorization"); // "Bearer <token>"
    if (!authHeader) return Response.json({ error: "Missing Authorization header" }, { status: 401 });

    const supabase = supabaseFromAuthHeader(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return Response.json({ error: "Unauthenticated" }, { status: 401 });

    const body = (await req.json()) as SubscribeBody;

    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return Response.json({ error: "Invalid subscription payload" }, { status: 400 });
    }

    // Configure web-push (server-side)
    webpush.setVapidDetails(
      getServerEnv("VAPID_SUBJECT"),
      getServerEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
      getServerEnv("VAPID_PRIVATE_KEY")
    );

    // Upsert subscription (RLS allows because auth uid matches user_id via bearer token)
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          user_agent: body.userAgent ?? null,
        },
        { onConflict: "user_id,endpoint" }
      );

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
