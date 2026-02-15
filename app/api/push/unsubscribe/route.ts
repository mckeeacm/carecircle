import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type UnsubscribeBody = { endpoint: string };

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

    const supabase = supabaseFromAuthHeader(authHeader);
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return Response.json({ error: "Unauthenticated" }, { status: 401 });

    const body = (await req.json()) as UnsubscribeBody;
    if (!body?.endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
