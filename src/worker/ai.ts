import type { Db } from "./data.ts";
import { GameError } from "./errors.ts";

export const FEATURES = ["food_photo", "text_log", "recommend", "chat"] as const;
export type AiFeature = typeof FEATURES[number];

export const DEFAULT_LIMITS: Record<AiFeature, number> = {
  food_photo: 10,
  text_log: 20,
  recommend: 5,
  chat: 20,
};

const NOTICE = "Not medical advice.";

export function modelName(raw: string | undefined): string {
  const name = String(raw || "").trim();
  if (!name) return "gemini-3.5-flash-lite";
  if (!/^gemini-3\.5[a-z0-9.-]{0,40}$/.test(name)) {
    throw new GameError(500, "Set AI_MODEL to gemini-3.5-flash-lite or another gemini-3.5 model.");
  }
  return name;
}

export function readLimitsFromEnv(env: {
  AI_LIMIT_FOOD_PHOTO?: string;
  AI_LIMIT_TEXT_LOG?: string;
  AI_LIMIT_RECOMMEND?: string;
  AI_LIMIT_CHAT?: string;
}): Record<AiFeature, number> {
  return {
    food_photo: cap(env.AI_LIMIT_FOOD_PHOTO, DEFAULT_LIMITS.food_photo),
    text_log: cap(env.AI_LIMIT_TEXT_LOG, DEFAULT_LIMITS.text_log),
    recommend: cap(env.AI_LIMIT_RECOMMEND, DEFAULT_LIMITS.recommend),
    chat: cap(env.AI_LIMIT_CHAT, DEFAULT_LIMITS.chat),
  };
}

function cap(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return fallback;
  return n;
}

export async function effectiveLimits(db: Db, envLimits: Record<AiFeature, number>): Promise<Record<AiFeature, number>> {
  const out = { ...envLimits };
  const rows = await db.prepare("SELECT key, value FROM ai_settings").all<{ key: string; value: string }>();
  for (const row of rows.results || []) {
    const feature = row.key.replace(/^limit_/, "") as AiFeature;
    if (!FEATURES.includes(feature)) continue;
    const n = Number(row.value);
    if (Number.isInteger(n) && n >= 0 && n <= 1000) out[feature] = n;
  }
  return out;
}

export async function saveLimit(db: Db, feature: string, dailyCap: number): Promise<void> {
  if (!FEATURES.includes(feature as AiFeature)) throw new GameError(400, "Unknown limit.");
  if (!Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > 1000) throw new GameError(400, "Limit must be a whole number from 0 to 1000.");
  await db.prepare(
    "INSERT INTO ai_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind("limit_" + feature, String(dailyCap)).run();
}

export async function isPremium(db: Db, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT user_id FROM premium_users WHERE user_id = ?").bind(userId).first();
  return Boolean(row);
}

export async function setPremium(db: Db, userId: string, grant: boolean, day: string): Promise<void> {
  if (!/^[a-f0-9]{16,64}$/i.test(userId)) throw new GameError(400, "That player id is not valid.");
  if (grant) {
    await db.prepare(
      "INSERT INTO premium_users (user_id, granted_day) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET granted_day = excluded.granted_day",
    ).bind(userId, day).run();
  } else {
    await db.prepare("DELETE FROM premium_users WHERE user_id = ?").bind(userId).run();
  }
}

export async function usageMap(db: Db, userId: string, day: string): Promise<Record<AiFeature, number>> {
  const out: Record<AiFeature, number> = { food_photo: 0, text_log: 0, recommend: 0, chat: 0 };
  const rows = await db.prepare(
    "SELECT feature, count FROM ai_usage WHERE user_id = ? AND day = ?",
  ).bind(userId, day).all<{ feature: string; count: number }>();
  for (const row of rows.results || []) {
    if (FEATURES.includes(row.feature as AiFeature)) out[row.feature as AiFeature] = row.count;
  }
  return out;
}

export async function quotaFor(db: Db, userId: string, day: string, limits: Record<AiFeature, number>) {
  const premium = await isPremium(db, userId);
  const used = await usageMap(db, userId, day);
  const features = FEATURES.map((feature) => ({
    feature,
    used: used[feature],
    cap: premium ? null : limits[feature],
    left: premium ? null : Math.max(0, limits[feature] - used[feature]),
  }));
  return { premium, features };
}

async function bump(db: Db, userId: string, day: string, feature: AiFeature): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_usage (user_id, day, feature, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id, day, feature) DO UPDATE SET count = count + 1`,
  ).bind(userId, day, feature).run();
}

export async function assertWithinLimit(db: Db, userId: string, day: string, feature: AiFeature, limits: Record<AiFeature, number>): Promise<void> {
  if (await isPremium(db, userId)) return;
  const used = await usageMap(db, userId, day);
  if (used[feature] >= limits[feature]) {
    throw new GameError(429, "You've used today's free answers for that. They reset tomorrow.");
  }
}

interface GeminiEnv {
  GEMINI_API_KEY?: string;
  AI_MODEL?: string;
}

export async function askGemini(env: GeminiEnv, parts: { text?: string; image?: string; mime?: string }[], jsonMode: boolean): Promise<string> {
  const key = String(env.GEMINI_API_KEY || "").trim();
  if (!key) throw new GameError(503, "The assistant is not set up yet.");
  const model = modelName(env.AI_MODEL);
  const body = {
    contents: [{
      parts: parts.map((part) => part.image
        ? { inline_data: { mime_type: part.mime || "image/jpeg", data: part.image } }
        : { text: part.text || "" }),
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 700,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new GameError(502, "The assistant could not answer just now.");
  }
  if (!res.ok) throw new GameError(502, "The assistant could not answer just now.");
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!text) throw new GameError(502, "The assistant could not answer just now.");
  return text.slice(0, 4000);
}

function asItems(value: unknown): { name: string; portion: string; kcal: number; protein: number; carbs: number; fat: number }[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, 8).map((row) => {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return {
      name: String(item.name || "Food").slice(0, 80),
      portion: String(item.portion || "").slice(0, 80),
      kcal: num(item.kcal),
      protein: num(item.protein),
      carbs: num(item.carbs),
      fat: num(item.fat),
    };
  }).filter((item) => item.name);
}

function num(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 5000) return 0;
  return Math.round(n);
}

function parseJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^```json\s*|\s*```$/g, "");
  try {
    const data = JSON.parse(clean) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const FOOD_RULE = "Return JSON only. Estimate foods for a personal log. Use whole numbers. If unsure, say so in the portion. Do not give medical advice. Do not recommend supplements or slimming products.";

export async function runFeature(
  db: Db,
  env: GeminiEnv,
  userId: string,
  day: string,
  feature: AiFeature,
  limits: Record<AiFeature, number>,
  parts: { text?: string; image?: string; mime?: string }[],
  shape: "items" | "meals" | "session" | "chat",
) {
  await assertWithinLimit(db, userId, day, feature, limits);
  const raw = await askGemini(env, parts, shape !== "chat");
  await bump(db, userId, day, feature);
  if (shape === "chat") return { notice: NOTICE, reply: raw.slice(0, 900) };
  const data = parseJson(raw);
  if (shape === "items") return { notice: NOTICE, items: asItems(data.items) };
  if (shape === "meals") {
    const meals = Array.isArray(data.meals) ? data.meals : [];
    return {
      notice: NOTICE,
      meals: meals.slice(0, 3).map((row) => {
        const item = asItems([row])[0];
        const why = row && typeof row === "object" ? String((row as Record<string, unknown>).why || "").slice(0, 160) : "";
        return item ? { ...item, why } : null;
      }).filter(Boolean),
    };
  }
  return { notice: NOTICE, session: String(data.session || "").slice(0, 400), notes: String(data.notes || "").slice(0, 400) };
}

export { FOOD_RULE };
