import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const VALID_SLOTS = new Set(["morning", "midday", "evening", "bedtime"]);

function json(res: any, status = 200) {
  return Response.json(res, { status });
}

function getAdminSupabase() {
  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = mustEnv("SUPABASE_SERVICE_ROLE_KEY"); // server only
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: Request) {
  try {
    // --- simple cron auth ---
    const secret = mustEnv("CRON_SECRET");
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return json({ error: "Unauthorised" }, 401);
    }

    const url = new URL(req.url);
    const slot = (url.searchParams.get("slot") ?? "").toLowerCase();

    if (!VALID_SLOTS.has(slot)) {
      return json(
        { error: `Missing/invalid slot. Use one of: ${Array.from(VALID_SLOTS).join(", ")}` },
        400
      );
    }

    // --- init web-push ---
    webpush.setVapidDetails(
      mustEnv("VAPID_SUBJECT"),
      mustEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
      mustEnv("VAPID_PRIVATE_KEY")
    );

    const supabase = getAdminSupabase();

    // 1) get who needs reminders for this slot (RPC)
    const { data: due, error: dueErr } = await supabase.rpc("get_due_med_reminders", {
      p_slot: slot,
    });

    if (dueErr) return json({ error: dueErr.message }, 400);

    const dueRows = (due ?? []) as Array<{
      user_id: string;
      patient_id: string;
      med_names: string;
    }>;

    if (dueRows.length === 0) {
      return json({ ok: true, slot, message: "No reminders due." });
    }

    // 2) fetch subscriptions for those users
    const userIds = Array.from(new Set(dueRows.map((r) => r.user_id)));

    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("user_id,endpoint,p256dh,auth")
      .in("user_id", userIds);

    if (subErr) return json({ error: subErr.message }, 400);

    const subsRows = (subs ?? []) as Array<{
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;

    const subsByUser: Record<string, typeof subsRows> = {};
    for (const s of subsRows) {
      if (!subsByUser[s.user_id]) subsByUser[s.user_id] = [];
      subsByUser[s.user_id].push(s);
    }

    // 3) send pushes
    const sendResults: Array<any> = [];

    for (const r of dueRows) {
      const userSubs = subsByUser[r.user_id] ?? [];
      if (userSubs.length === 0) {
        sendResults.push({ user_id: r.user_id, ok: false, error: "No subscription" });
        continue;
      }

      const payload = JSON.stringify({
        title: "CareCircle",
        body: `Medication reminder (${slot}): ${r.med_names}`,
        url: `/app/today`,
        kind: "med_reminder",
        slot,
        patient_id: r.patient_id,
      });

      const results = await Promise.allSettled(
        userSubs.map((s) =>
          webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          )
        )
      );

      const summary = results.map((x, i) => ({
        i,
        ok: x.status === "fulfilled",
        error: x.status === "rejected" ? String((x.reason as any)?.message ?? x.reason) : null,
      }));

      sendResults.push({
        user_id: r.user_id,
        patient_id: r.patient_id,
        sent: summary,
      });
    }

    return json({
      ok: true,
      slot,
      due_users: dueRows.length,
      unique_users: userIds.length,
      subscriptions_found: subsRows.length,
      results: sendResults,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
