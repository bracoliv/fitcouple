import { GameError } from "./errors.ts";

const HOSTS = new Set(["api.openai.com", "api.groq.com"]);

export async function askCoach(input: {
  level: number;
  streak: number;
  programDay: number;
  programTitle: string;
  questIds: string[];
  apiKey: string;
  host: string;
}): Promise<string> {
  const host = input.host || "api.openai.com";
  if (!HOSTS.has(host)) throw new GameError(400, "Use api.openai.com or api.groq.com.");
  if (input.apiKey.length < 12 || input.apiKey.length > 200 || /\s/.test(input.apiKey)) {
    throw new GameError(400, "Add your own AI key on this phone. It is not saved.");
  }
  const model = host === "api.groq.com" ? "llama-3.1-8b-instant" : "gpt-4o-mini";
  const quests = input.questIds.filter((id) => /^[a-z_]{1,32}$/.test(id)).slice(0, 8);
  let res: Response;
  try {
    res = await fetch(`https://${host}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You coach a simple health game. Four sentences maximum. Not medical advice. Do not name foods, weights, medicines, or products to buy. Praise showing up.",
          },
          {
            role: "user",
            content: `Level ${input.level}. Streak ${input.streak} days. Day ${input.programDay} of 66. Plan: ${input.programTitle}. Finished today: ${quests.join(", ") || "none"}.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GameError(502, "The coach could not reply. Your key was not saved.");
  }
  if (!res.ok) throw new GameError(502, "The coach could not reply. Your key was not saved.");
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new GameError(502, "The coach sent an empty reply. Nothing was saved.");
  return text.trim().slice(0, 600);
}
