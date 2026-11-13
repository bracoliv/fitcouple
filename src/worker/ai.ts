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
  QWEN_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_MODEL?: string;
  AI_PROVIDER_ORDER?: string;
  AI_GOOGLE_MODEL?: string;
  AI_GOOGLE_BASE_URL?: string;
  AI_QWEN_MODEL?: string;
  AI_QWEN_BASE_URL?: string;
  AI_OPENAI_MODEL?: string;
  AI_OPENAI_BASE_URL?: string;
  AI_PRICE_TABLE?: string;
  AI_USD_TO_RM?: string;
}

export interface ProviderConfig {
  id: "google" | "qwen" | "openai";
  model: string;
  baseUrl: string;
  key: string;
}

const PROVIDER_DEFAULTS = {
  google: { model: "gemini-3.5-flash-lite", baseUrl: "https://generativelanguage.googleapis.com/v1beta", host: /(^|\.)generativelanguage\.googleapis\.com$/ },
  qwen: { model: "qwen3-vl-plus", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", host: /(^|\.)dashscope-intl\.aliyuncs\.com$/ },
  openai: { model: "gpt-6-luna", baseUrl: "https://api.openai.com/v1", host: /(^|\.)api\.openai\.com$/ },
} as const;

function tokenName(raw: string | undefined, fallback: string): string {
  const name = String(raw || "").trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(name) ? name : fallback;
}

function httpsBase(raw: string | undefined, fallback: string, host: RegExp): string {
  const value = String(raw || "").trim().replace(/\/$/, "");
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && host.test(url.hostname)) return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    // Keep the built-in official address.
  }
  return fallback;
}

export function readProviders(env: GeminiEnv): ProviderConfig[] {
  const order = String(env.AI_PROVIDER_ORDER || "google,qwen,openai").split(",").map((item) => item.trim().toLowerCase());
  const seen = new Set<string>();
  const list: ProviderConfig[] = [];
  for (const id of order) {
    if (seen.has(id) || !(id === "google" || id === "qwen" || id === "openai")) continue;
    seen.add(id);
    const defaults = PROVIDER_DEFAULTS[id];
    const key = id === "google" ? env.GEMINI_API_KEY : id === "qwen" ? env.QWEN_API_KEY : env.OPENAI_API_KEY;
    const model = id === "google"
      ? modelName(env.AI_GOOGLE_MODEL || env.AI_MODEL)
      : tokenName(id === "qwen" ? env.AI_QWEN_MODEL : env.AI_OPENAI_MODEL, defaults.model);
    const baseRaw = id === "google" ? env.AI_GOOGLE_BASE_URL : id === "qwen" ? env.AI_QWEN_BASE_URL : env.AI_OPENAI_BASE_URL;
    list.push({
      id,
      model,
      baseUrl: httpsBase(baseRaw, defaults.baseUrl, defaults.host),
      key: String(key || "").trim(),
    });
  }
  return list;
}

type ModelPart = { text?: string; image?: string; mime?: string };
type Usage = { input: number; output: number };
type CallResult = { ok: true; text: string; usage: Usage } | { ok: false; retryable: boolean };

export const DEFAULT_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.30, output: 2.50 },
  "qwen3-vl-plus": { input: 0.20, output: 1.60 },
  "gpt-6-luna": { input: 0.10, output: 0.50 },
};

export function priceTable(raw: string | undefined): Record<string, { input: number; output: number }> {
  const table: Record<string, { input: number; output: number }> = { ...DEFAULT_PRICES };
  if (!raw || !raw.trim()) return table;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return table;
    for (const [model, price] of Object.entries(data as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(model)) continue;
      const row = price && typeof price === "object" ? price as { input?: unknown; output?: unknown } : {};
      const input = Number(row.input);
      const output = Number(row.output);
      if (Number.isFinite(input) && input >= 0 && input < 1000 && Number.isFinite(output) && output >= 0 && output < 1000) {
        table[model] = { input, output };
      }
    }
  } catch {
    // Keep the built-in prices.
  }
  return table;
}

export function usdToRmRate(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return 4.084;
  return n;
}

export function costMicroUsd(model: string, inputTokens: number, outputTokens: number, table: Record<string, { input: number; output: number }>): number {
  const price = table[model] || { input: 0, output: 0 };
  return Math.round(inputTokens * price.input + outputTokens * price.output);
}

function wholeTokens(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 50_000_000) return 0;
  return Math.round(n);
}

export function usageFromGoogle(data: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }): Usage {
  const usage = data.usageMetadata || {};
  return {
    input: wholeTokens(usage.promptTokenCount),
    output: wholeTokens(usage.candidatesTokenCount) + wholeTokens(usage.thoughtsTokenCount),
  };
}

export function usageFromChat(data: { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } }): Usage {
  const usage = data.usage || {};
  const input = usage.input_tokens != null ? wholeTokens(usage.input_tokens) : wholeTokens(usage.prompt_tokens);
  const output = usage.output_tokens != null
    ? wholeTokens(usage.output_tokens)
    : wholeTokens(usage.completion_tokens);
  return { input, output };
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function callGoogle(provider: ProviderConfig, parts: ModelPart[], jsonMode: boolean): Promise<CallResult> {
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
  const res = await fetch(`${provider.baseUrl}/models/${provider.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": provider.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, retryable: retryableStatus(res.status) };
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!text) return { ok: false, retryable: true };
  return { ok: true, text: text.slice(0, 4000), usage: usageFromGoogle(data) };
}

async function callChat(provider: ProviderConfig, parts: ModelPart[]): Promise<CallResult> {
  const content: { type: string; text?: string; image_url?: { url: string } }[] = [];
  for (const part of parts) {
    if (part.image) content.push({ type: "image_url", image_url: { url: `data:${part.mime || "image/jpeg"};base64,${part.image}` } });
    else if (part.text) content.push({ type: "text", text: part.text });
  }
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: content.length === 1 && content[0].text ? content[0].text : content }],
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, retryable: retryableStatus(res.status) };
  }
  const data = await res.json() as { choices?: { message?: { content?: string | { text?: string }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } };
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part) => part.text || "").join("") : "";
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, retryable: true };
  return { ok: true, text: trimmed.slice(0, 4000), usage: usageFromChat(data) };
}

async function callProvider(provider: ProviderConfig, parts: ModelPart[], jsonMode: boolean): Promise<CallResult> {
  try {
    return provider.id === "google" ? await callGoogle(provider, parts, jsonMode) : await callChat(provider, parts);
  } catch {
    return { ok: false, retryable: true };
  }
}

async function addProviderDay(db: Db, day: string, provider: string, calls: number, input: number, output: number, cost: number, fallbacks: number): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_provider_counts (day, provider, calls, input_tokens, output_tokens, cost_micro, fallbacks)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, provider) DO UPDATE SET
       calls = calls + excluded.calls,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_micro = cost_micro + excluded.cost_micro,
       fallbacks = fallbacks + excluded.fallbacks`,
  ).bind(day, provider, calls, input, output, cost, fallbacks).run();
}

async function addUserSpend(db: Db, day: string, userId: string, feature: AiFeature, provider: string, input: number, output: number, cost: number): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_spend (day, user_id, feature, provider, calls, input_tokens, output_tokens, cost_micro)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(day, user_id, feature, provider) DO UPDATE SET
       calls = calls + 1,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_micro = cost_micro + excluded.cost_micro`,
  ).bind(day, userId, feature, provider, input, output, cost).run();
}

export async function askProviders(
  db: Db,
  day: string,
  userId: string,
  feature: AiFeature,
  env: GeminiEnv,
  parts: ModelPart[],
  jsonMode: boolean,
): Promise<string> {
  const providers = readProviders(env).filter((provider) => provider.key);
  if (!providers.length) throw new GameError(503, "The assistant is not set up yet.");
  const prices = priceTable(env.AI_PRICE_TABLE);
  for (const provider of providers) {
    const result = await callProvider(provider, parts, jsonMode);
    if (result.ok) {
      const cost = costMicroUsd(provider.model, result.usage.input, result.usage.output, prices);
      await addProviderDay(db, day, provider.id, 1, result.usage.input, result.usage.output, cost, 0);
      await addUserSpend(db, day, userId, feature, provider.id, result.usage.input, result.usage.output, cost);
      return result.text;
    }
    if (!result.retryable) throw new GameError(502, "The assistant could not answer just now.");
    await addProviderDay(db, day, provider.id, 0, 0, 0, 0, 1);
  }
  throw new GameError(502, "The assistant could not answer just now.");
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
  const raw = await askProviders(db, day, userId, feature, env, parts, shape !== "chat");
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

function dayShift(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function money(micro: number, rate: number) {
  const usd = micro / 1_000_000;
  return { usd: Math.round(usd * 10000) / 10000, rm: Math.round(usd * rate * 10000) / 10000 };
}

export async function costReport(db: Db, today: string, rate: number) {
  const windows = [
    { id: "today", from: today, label: "Today" },
    { id: "d7", from: dayShift(today, -6), label: "Last 7 days" },
    { id: "d30", from: dayShift(today, -29), label: "Last 30 days" },
    { id: "d66", from: dayShift(today, -65), label: "Last 66 days" },
  ];
  const report = [];
  for (const window of windows) {
    const providers = await db.prepare(
      `SELECT provider, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(cost_micro) AS cost_micro, SUM(fallbacks) AS fallbacks
       FROM ai_provider_counts WHERE day >= ? AND day <= ? GROUP BY provider ORDER BY provider`,
    ).bind(window.from, today).all<{ provider: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number; fallbacks: number }>();
    const features = await db.prepare(
      `SELECT feature, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_micro) AS cost_micro
       FROM ai_spend WHERE day >= ? AND day <= ? GROUP BY feature ORDER BY feature`,
    ).bind(window.from, today).all<{ feature: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number }>();
    const totals = await db.prepare(
      `SELECT COUNT(DISTINCT user_id) AS users, COALESCE(SUM(cost_micro), 0) AS cost_micro,
              COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(calls), 0) AS calls
       FROM ai_spend WHERE day >= ? AND day <= ?`,
    ).bind(window.from, today).first<{ users: number; cost_micro: number; input_tokens: number; output_tokens: number; calls: number }>();
    const top = await db.prepare(
      `SELECT user_id, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_micro) AS cost_micro
       FROM ai_spend WHERE day >= ? AND day <= ? GROUP BY user_id ORDER BY SUM(cost_micro) DESC LIMIT 15`,
    ).bind(window.from, today).all<{ user_id: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number }>();
    const users = totals?.users || 0;
    const cost = totals?.cost_micro || 0;
    report.push({
      id: window.id,
      label: window.label,
      calls: totals?.calls || 0,
      inputTokens: totals?.input_tokens || 0,
      outputTokens: totals?.output_tokens || 0,
      cost: money(cost, rate),
      activeUsers: users,
      average: money(users ? Math.round(cost / users) : 0, rate),
      providers: (providers.results || []).map((row) => ({
        provider: row.provider,
        calls: row.calls,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        fallbacks: row.fallbacks,
        cost: money(row.cost_micro, rate),
      })),
      features: (features.results || []).map((row) => ({
        feature: row.feature,
        calls: row.calls,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cost: money(row.cost_micro, rate),
      })),
      topUsers: (top.results || []).map((row) => ({
        userId: row.user_id,
        calls: row.calls,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cost: money(row.cost_micro, rate),
      })),
    });
  }
  return { usdToRm: rate, windows: report };
}
