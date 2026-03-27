import { NextResponse } from "next/server";
import { getLanguageLabel, normaliseLanguageCode } from "@/lib/languages";

type RequestBody = {
  targetLanguageCode?: string;
  texts?: string[];
};

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function collectOutputText(json: any) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  const parts = Array.isArray(json?.output) ? json.output : [];
  const chunks: string[] = [];

  for (const part of parts) {
    const content = Array.isArray(part?.content) ? part.content : [];
    for (const item of content) {
      const text = item?.text;
      if (typeof text === "string" && text.trim()) chunks.push(text.trim());
    }
  }

  return chunks.join("\n").trim();
}

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
        model: "gpt-4.1-mini",
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

    const outputText = collectOutputText(json);
    if (!outputText) {
      return NextResponse.json({ error: "ui_translation_empty_response" }, { status: 500 });
    }

    const parsed = JSON.parse(extractJsonObject(outputText)) as { translations?: string[] };
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];

    if (translations.length !== sourceTexts.length) {
      return NextResponse.json(
        {
          error: "ui_translation_mismatch",
          expected: sourceTexts.length,
          received: translations.length,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ translations });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed_to_translate_ui" }, { status: 500 });
  }
}
