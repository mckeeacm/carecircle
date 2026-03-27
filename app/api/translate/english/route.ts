import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLanguageLabel, normaliseLanguageCode } from "@/lib/languages";

function extractBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
      if (typeof part?.text?.value === "string" && part.text.value.trim()) {
        return part.text.value.trim();
      }
    }
  }

  return "";
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "missing_public_supabase_env" }, { status: 500 });
    }

    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      return NextResponse.json({ error: "missing_auth_session" }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const body = await req.json();
    const text = String(body?.text ?? "");
    const fieldLabel = String(body?.fieldLabel ?? "care note").trim() || "care note";
    const sourceLanguageCode = normaliseLanguageCode(body?.sourceLanguageCode);

    if (!text.trim()) {
      return NextResponse.json({ ok: true, text: "" });
    }

    if (sourceLanguageCode === "en") {
      return NextResponse.json({ ok: true, text: text.trim() });
    }

    if (!openAiKey) {
      return NextResponse.json({ error: "missing_openai_api_key" }, { status: 500 });
    }

    const sourceLanguage = getLanguageLabel(sourceLanguageCode);

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        reasoning: { effort: "minimal" },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Translate care and medical notes into clear British English. Preserve line breaks, preserve names, preserve medicine names, preserve factual meaning, and return only the English translation with no commentary.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Source language: ${sourceLanguage}\nField: ${fieldLabel}\nTarget language: English\n\nText:\n${text}`,
              },
            ],
          },
        ],
      }),
    });

    const json = await openAiResponse.json().catch(() => null);
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: json?.error?.message ?? "translation_request_failed" },
        { status: 500 }
      );
    }

    const outputText = extractResponseText(json);
    if (!outputText) {
      return NextResponse.json({ error: "translation_empty_response" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, text: outputText });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "failed_to_translate_to_english" },
      { status: 500 }
    );
  }
}
