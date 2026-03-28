const fs = require("fs");
const path = require("path");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is missing");
}

const root = path.resolve(__dirname, "..");
const i18nPath = path.join(root, "lib", "i18n.ts");
const source = fs.readFileSync(i18nPath, "utf8");

function extractObject(name) {
  const startToken = `const ${name}:`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Could not find ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Could not parse ${name}`);
  return source.slice(open, end + 1);
}

const en = Function(`return (${extractObject("EN")});`)();

const languages = [
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "ar", label: "Arabic (Modern Standard)" },
  { code: "arz", label: "Arabic (Egyptian)" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "ckb", label: "Kurdish (Sorani)" },
  { code: "fa", label: "Persian (Farsi)" },
  { code: "tr", label: "Turkish" },
  { code: "ta", label: "Tamil" },
  { code: "cy", label: "Welsh" },
  { code: "uk", label: "Ukrainian" },
];

function constNameFor(code) {
  return code.toUpperCase().replace(/[^A-Z]/g, "_");
}

function formatObject(name, obj) {
  const lines = [`const ${name}: Partial<Dict> = {`];
  for (const [key, value] of Object.entries(obj)) {
    const escaped = String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    lines.push(`  ${JSON.stringify(key)}: "${escaped}",`);
  }
  lines.push("};");
  return lines.join("\n");
}

async function translateLanguage(lang) {
  const prompt = [
    "Translate the values in this JSON object for a healthcare/caregiving app UI.",
    `Target language: ${lang.label}.`,
    "Keep keys unchanged.",
    "Return JSON only.",
    "Preserve placeholders and punctuation where sensible.",
    "Do not translate CareCircle.",
    JSON.stringify(en),
  ].join("\n\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: prompt,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed for ${lang.code}: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).map((c) => c.text || "").join("") ||
    "";
  if (!text.trim()) throw new Error(`Empty response for ${lang.code}`);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`No JSON object returned for ${lang.code}`);
  }
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

async function main() {
  const generated = [];
  for (const lang of languages) {
    console.log(`Translating ${lang.code}...`);
    generated.push({
      code: lang.code,
      block: formatObject(constNameFor(lang.code), await translateLanguage(lang)),
    });
  }

  const itStart = source.indexOf("const IT: Partial<Dict> = {");
  const dictsStart = source.indexOf("const DICTS:", itStart);
  if (itStart === -1 || dictsStart === -1) throw new Error("Could not find dictionary section");

  const dictSection = [
    source.slice(itStart, dictsStart).trimEnd(),
    "",
    ...generated.map((item) => item.block),
    "",
  ].join("\n");

  const withBlocks = source.slice(0, itStart) + dictSection + source.slice(dictsStart);

  const dictMap = [
    "const DICTS: Record<string, Partial<Dict>> = {",
    "  it: IT,",
    ...languages.map((lang) => `  ${JSON.stringify(lang.code)}: ${constNameFor(lang.code)},`),
    "};",
  ].join("\n");

  const finalSource = withBlocks.replace(/const DICTS: Record<string, Partial<Dict>> = \{[\s\S]*?\n\};/, dictMap);
  fs.writeFileSync(i18nPath, finalSource, "utf8");
  console.log("Updated lib/i18n.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
