import { GameError } from "./errors.ts";

// Keys that must never be accepted, at any depth. Values are not logged.
const FORBIDDEN_KEY = /^(food|meal|meals|workout|workouts|weight|weights|note|notes|kcal|calorie|calories|protein|carb|carbs|fat|email|e-mail|sheet|spreadsheet|url|link|medication|meds|medicine|body|photo|image|password|secret|admin|adminkey|token)$/i;

const NAME_PATTERN = /^[\p{L}\p{N} .'_-]{1,24}$/u;

export function assertNoPrivateFields(value: unknown, depth = 0, maxString = 80): void {
  if (value == null) return;
  if (depth > 5) throw new GameError(400, "Request is too nested.");
  if (Array.isArray(value)) {
    if (value.length > 8) throw new GameError(400, "Too many items.");
    for (const item of value) assertNoPrivateFields(item, depth + 1, maxString);
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length > 8) throw new GameError(400, "Too many fields.");
    for (const key of keys) {
      if (FORBIDDEN_KEY.test(key)) throw new GameError(400, "Private fields are not accepted.");
      assertNoPrivateFields((value as Record<string, unknown>)[key], depth + 1, maxString);
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > maxString) throw new GameError(400, "Text is too long.");
    if (value.includes("@") || /https?:\/\//i.test(value)) {
      throw new GameError(400, "Links and email addresses are not accepted.");
    }
  }
}

export function assertKeys(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GameError(400, "Send a JSON object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new GameError(400, "Unexpected field.");
  }
  return record;
}

export function isAnonId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

// Optional label the player chooses. Shown to their team and on the owner page.
export function cleanDisplayName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new GameError(400, "Name must be text.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@") || /https?:/i.test(trimmed) || !NAME_PATTERN.test(trimmed)) {
    throw new GameError(400, "Use up to 24 letters or numbers. No email or notes.");
  }
  return trimmed;
}
