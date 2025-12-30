import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sanitizePrompt(text: string) {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, "") // trim quotes/spaces
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateFamilyFriendlyPrompt(): Promise<string> {
  const res = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You generate short, funny, family-friendly visual prompts for a party game. Avoid profanity, hate, sexual content, politics, real-person targeting, and anything unsafe. Keep it silly and imaginative.",
      },
      {
        role: "user",
        content:
          "Create ONE image prompt for a multiplayer party game (Cards Against Humanity x Pictionary). " +
          "Rules: 8–16 words, highly visual, comedic, family-friendly, no blanks like ____, no questions. " +
          "Output ONLY the prompt text, no quotes, no numbering.",
      },
    ],
  });

  const text = res.output_text ?? "";
  const prompt = sanitizePrompt(text);

  if (!prompt || prompt.length < 6) {
    throw new Error("AI returned an empty/invalid prompt");
  }

  return prompt;
}
