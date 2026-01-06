import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sanitize(text: string) {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generatePrompt(opts: { familyFriendly: boolean }) {
  const style = opts.familyFriendly
    ? "family-friendly, silly, playful"
    : "PG-13, silly, light edgy but still not hateful/sexual/graphic";

  const system =
    "You generate short, funny visual prompts for a party image game. " +
    "No hate, no sexual content, no violence/gore, no politics, no real-person targeting. " +
    `Tone: ${style}. Output only the prompt text.`;

  const user =
    "Create ONE image prompt. Rules: 8–16 words, highly visual, comedic, no blanks like ____, no numbering, no quotes.";

  const res = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const out = sanitize(res.output_text ?? "");
  if (!out) throw new Error("Empty prompt");
  return out;
}
