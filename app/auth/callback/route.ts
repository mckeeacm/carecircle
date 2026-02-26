import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // IMPORTANT: your supabaseServer() is async and returns a Promise
  const supabase = await supabaseServer();

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;

  if (error || !user) {
    return NextResponse.redirect(`${origin}/`);
  }

  // onboarding complete = belongs to at least one patient circle
  const { data: membership, error: memErr } = await supabase
    .from("patient_members")
    .select("patient_id")
    .eq("user_id", user.id)
    .limit(1);

  const hasCircle = !memErr && (membership?.length ?? 0) > 0;

  return NextResponse.redirect(`${origin}${hasCircle ? "/app/hub" : "/app/onboarding"}`);
}