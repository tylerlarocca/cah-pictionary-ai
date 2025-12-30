export const PROMPTS: string[] = [
  "A Renaissance painting of ____ but it's actually ____",
  "A children's book illustration of ____ gone horribly wrong",
  "A movie poster for ____ starring ____",
  "A corporate logo for ____ that accidentally looks like ____",
  "A nature documentary screenshot of ____ in the wild",
  "A medieval tapestry showing ____ and ____",
  "An infomercial still frame selling ____ to ____",
  "A photo of ____ that feels cursed for no reason",
];

export function pickRandomPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}
