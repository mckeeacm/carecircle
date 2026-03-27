import { NextResponse } from "next/server";
import { getLanguageLabel, normaliseLanguageCode } from "@/lib/languages";

type RequestBody = {
  targetLanguageCode?: string;
  texts?: string[];
};

export async function POST(req: Request) {
  try {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) {
      return NextResponse.json({ error: "missing_openai_api_key" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const targetLanguageCode = normaliseLanguageCode(body.targetLanguageCode);
    const sourceTexts = Array.isArray(body.texts)
      ? body.texts.map((text) => String(text ?? "").trim()).filter(Boolean).slice(0, 100)
      : [];

    if (sourceTexts.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    if (targetLanguageCode === "en") {
      return NextResponse.json({ translations: sourceTexts });
    }

    const targetLanguage = getLanguageLabel(targetLanguageCode);

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
                  "Translate short CareCircle app interface strings into the requested language. Preserve brand names like CareCircle and CareBridge Studios. Return valid JSON only in this exact shape: {\"translations\":[\"...\"]}. Keep the same array order and do not add commentary.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  targetLanguage,
                  texts: sourceTexts,
                }),
              },
            ],
          },
        ],
      }),
    });

    const json = await openAiResponse.json().catch(() => null);
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: json?.error?.message ?? "ui_translation_request_failed" },
        { status: 500 }
      );
    }

    const outputText = String(json?.output_text ?? "").trim();
    const parsed = JSON.parse(outputText) as { translations?: string[] };
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];

    if (translations.length !== sourceTexts.length) {
      return NextResponse.json({ error: "ui_translation_mismatch" }, { status: 500 });
    }

    return NextResponse.json({ translations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed_to_translate_ui" }, { status: 500 });
  }
}
