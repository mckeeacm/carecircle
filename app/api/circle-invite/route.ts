import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type InviteCreateResult = {
  invite_id: string;
  patient_id: string;
  role: string;
  expires_at: string;
  token: string;
};

function isUuid(s: unknown): s is string {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const patientId = String(body?.patientId ?? "");
    const role = String(body?.role ?? "family").trim().toLowerCase();
    const expiresInDays = Number(body?.expiresInDays ?? 7);
    const maxUses = Number(body?.maxUses ?? 1);
    const inviteeEmail = String(body?.inviteeEmail ?? "").trim().toLowerCase();
    const inviteeNickname =
      body?.inviteeNickname == null || String(body.inviteeNickname).trim() === ""
        ? null
        : String(body.inviteeNickname).trim();

    if (!isUuid(patientId)) {
      return NextResponse.json({ error: "invalid_patient_id" }, { status: 400 });
    }

    if (!inviteeEmail) {
      return NextResponse.json({ error: "invitee_email_required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "missing_server_supabase_env" },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: inviteData, error: inviteErr } = await admin.rpc("patient_invite_create", {
      pid: patientId,
      p_role: role,
      p_expires_in_days: expiresInDays,
      p_max_uses: maxUses,
    });

    if (inviteErr) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    const invite = inviteData as InviteCreateResult;

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const redirectTo = `${siteUrl}/app/onboarding?invite=${encodeURIComponent(invite.token)}`;

    const { data: authInvite, error: authErr } = await admin.auth.admin.inviteUserByEmail(
      inviteeEmail,
      {
        redirectTo,
        data: {
          circle_patient_id: patientId,
          circle_role: role,
          circle_invite_token: invite.token,
          circle_nickname: inviteeNickname,
        },
      }
    );

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      inviteId: invite.invite_id,
      patientId: invite.patient_id,
      role: invite.role,
      expiresAt: invite.expires_at,
      inviteUrl: redirectTo,
      invitedUserId: authInvite.user?.id ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "failed_to_create_circle_invite" },
      { status: 500 }
    );
  }
}