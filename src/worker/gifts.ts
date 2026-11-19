import { randomHex } from "./crypto.ts";
import type { Db } from "./data.ts";
import { GameError } from "./errors.ts";
import { enforceKeyedRate, enforceRate, positiveInt } from "./rate.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function giftsEnabled(raw: string | undefined): boolean {
  return String(raw ?? "true").trim() !== "false";
}

export function inactiveRevokeDays(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return 0;
  return n;
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export function normalizeGiftCode(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const body = raw.startsWith("FC") ? raw.slice(2) : raw;
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(body)) {
    throw new GameError(400, "That gift code is not valid.");
  }
  return `FC-${body.slice(0, 4)}-${body.slice(4)}`;
}

function codeChunk(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

async function audit(db: Db, action: string, detail: string): Promise<void> {
  await db.prepare(
    "INSERT INTO admin_audit (at, actor, action, detail) VALUES (?, 'owner', ?, ?)",
  ).bind(new Date().toISOString(), action, detail.slice(0, 300)).run();
}

export async function settleGift(db: Db, userId: string, day: string, inactiveDays: number): Promise<{ expiresDay: string } | null> {
  const gift = await db.prepare("SELECT expires_day FROM gifts WHERE user_id = ?").bind(userId).first<{ expires_day: string }>();
  if (!gift || gift.expires_day < day) return null;
  if (inactiveDays > 0) {
    const user = await db.prepare(
      "SELECT last_active_day, program_start FROM users WHERE id = ?",
    ).bind(userId).first<{ last_active_day: string | null; program_start: string | null }>();
    const anchor = user?.last_active_day || user?.program_start;
    if (anchor && daysBetween(anchor, day) > inactiveDays) {
      await db.prepare("UPDATE gifts SET expires_day = ?, updated_at = ? WHERE user_id = ?").bind(addDays(day, -1), new Date().toISOString(), userId).run();
      await audit(db, "gift.auto-revoke", userId);
      return null;
    }
  }
  return { expiresDay: gift.expires_day };
}

export async function hasOpenAccess(db: Db, userId: string, day: string, inactiveDays: number): Promise<boolean> {
  const premium = await db.prepare("SELECT user_id FROM premium_users WHERE user_id = ?").bind(userId).first();
  if (premium) return true;
  return Boolean(await settleGift(db, userId, day, inactiveDays));
}

async function writeGift(db: Db, userId: string, day: string, giftDays: number, source: string, code: string | null, inactiveDays: number): Promise<string> {
  const current = await settleGift(db, userId, day, inactiveDays);
  const base = current ? current.expiresDay : day;
  const expires = addDays(base, giftDays);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO gifts (user_id, expires_day, source, code, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET expires_day = excluded.expires_day, source = excluded.source, code = excluded.code, updated_at = excluded.updated_at`,
  ).bind(userId, expires, source, code, now).run();
  return expires;
}

export async function redeemGiftCode(
  db: Db,
  request: Request,
  userId: string,
  rawCode: string,
  day: string,
  env: { GIFT_REDEEM_LIMIT?: string; GIFT_REDEEM_WINDOW_SECONDS?: string; AUTO_REVOKE_INACTIVE_DAYS?: string },
): Promise<{ expiresDay: string; daysLeft: number }> {
  const limit = positiveInt(env.GIFT_REDEEM_LIMIT, 8, 100);
  const windowSec = positiveInt(env.GIFT_REDEEM_WINDOW_SECONDS, 3600, 86400);
  await enforceRate(db, request, "gift", limit, windowSec);
  await enforceKeyedRate(db, "gift-user", userId, limit, windowSec);
  const code = normalizeGiftCode(rawCode);
  const row = await db.prepare(
    "SELECT code, redeem_by, gift_days, status FROM gift_codes WHERE code = ?",
  ).bind(code).first<{ code: string; redeem_by: string; gift_days: number; status: string }>();
  if (!row || row.status === "revoked" || row.redeem_by < day) throw new GameError(400, "That gift code is not valid.");
  if (row.status === "redeemed") throw new GameError(409, "That gift code has already been used.");
  const stamped = await db.prepare(
    "UPDATE gift_codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ? AND status = 'unused'",
  ).bind(userId, new Date().toISOString(), code).run() as { meta?: { changes?: number } };
  if (stamped.meta && stamped.meta.changes === 0) throw new GameError(409, "That gift code has already been used.");
  const expires = await writeGift(db, userId, day, row.gift_days, "code", code, inactiveRevokeDays(env.AUTO_REVOKE_INACTIVE_DAYS));
  await audit(db, "gift.redeem", `${code} ${userId}`);
  return { expiresDay: expires, daysLeft: daysBetween(day, expires) };
}

export async function generateGiftCodes(
  db: Db,
  day: string,
  count: number,
  label: string | null,
  redeemDays: number,
  giftDays: number,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new GameError(400, "Make between 1 and 50 codes.");
  if (!Number.isInteger(redeemDays) || redeemDays < 1 || redeemDays > 365) throw new GameError(400, "Redeem window must be 1 to 365 days.");
  if (!Number.isInteger(giftDays) || giftDays < 1 || giftDays > 366) throw new GameError(400, "Gift length must be 1 to 366 days.");
  const batch = randomHex(8);
  const redeemBy = addDays(day, redeemDays);
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = `FC-${codeChunk()}-${codeChunk()}`;
      const existing = await db.prepare("SELECT code FROM gift_codes WHERE code = ?").bind(code).first();
      if (!existing) break;
      code = "";
    }
    if (!code) throw new GameError(500, "Could not make a code. Try again.");
    await db.prepare(
      `INSERT INTO gift_codes (code, label, created_day, redeem_by, gift_days, status, batch_id)
       VALUES (?, ?, ?, ?, ?, 'unused', ?)`,
    ).bind(code, label, day, redeemBy, giftDays, batch).run();
    codes.push(code);
  }
  await audit(db, "gift.generate", `${count} codes, ${giftDays} days`);
  return codes;
}

export async function revokeGiftCode(db: Db, rawCode: string): Promise<void> {
  const code = normalizeGiftCode(rawCode);
  const row = await db.prepare("SELECT status FROM gift_codes WHERE code = ?").bind(code).first<{ status: string }>();
  if (!row) throw new GameError(404, "That code was not found.");
  if (row.status !== "unused") throw new GameError(400, "Only an unused code can be revoked.");
  await db.prepare("UPDATE gift_codes SET status = 'revoked' WHERE code = ?").bind(code).run();
  await audit(db, "gift.revoke-code", code);
}

export async function adjustGift(
  db: Db,
  userId: string,
  day: string,
  action: string,
  days: number | null,
  expiresDay: string | null,
  inactiveDays: number,
): Promise<string | null> {
  if (!/^[a-f0-9]{16,64}$/i.test(userId)) throw new GameError(400, "That player id is not valid.");
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) throw new GameError(404, "That player was not found.");
  const now = new Date().toISOString();
  if (action === "revoke") {
    await db.prepare(
      `INSERT INTO gifts (user_id, expires_day, source, code, updated_at) VALUES (?, ?, 'manual', NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET expires_day = excluded.expires_day, source = 'manual', updated_at = excluded.updated_at`,
    ).bind(userId, addDays(day, -1), now).run();
    await audit(db, "gift.revoke-user", userId);
    return null;
  }
  if (action === "set") {
    if (!expiresDay || !/^\d{4}-\d{2}-\d{2}$/.test(expiresDay)) throw new GameError(400, "Send the new expiry as YYYY-MM-DD.");
    await db.prepare(
      `INSERT INTO gifts (user_id, expires_day, source, code, updated_at) VALUES (?, ?, 'manual', NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET expires_day = excluded.expires_day, source = 'manual', updated_at = excluded.updated_at`,
    ).bind(userId, expiresDay, now).run();
    await audit(db, "gift.set", `${userId} ${expiresDay}`);
    return expiresDay;
  }
  const span = days == null ? 66 : days;
  if (!Number.isInteger(span) || span < 1 || span > 366) throw new GameError(400, "Gift length must be 1 to 366 days.");
  if (action === "grant" || action === "extend") {
    const expires = await writeGift(db, userId, day, span, "manual", null, inactiveDays);
    await audit(db, action === "grant" ? "gift.grant" : "gift.extend", `${userId} +${span}`);
    return expires;
  }
  if (action === "shorten") {
    const current = await settleGift(db, userId, day, inactiveDays);
    const base = current ? current.expiresDay : day;
    const expires = addDays(base, -span);
    await db.prepare(
      `INSERT INTO gifts (user_id, expires_day, source, code, updated_at) VALUES (?, ?, 'manual', NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET expires_day = excluded.expires_day, source = 'manual', updated_at = excluded.updated_at`,
    ).bind(userId, expires, now).run();
    await audit(db, "gift.shorten", `${userId} -${span}`);
    return expires < day ? null : expires;
  }
  throw new GameError(400, "Unknown gift action.");
}

export async function saveSupportNote(db: Db, userId: string, note: string): Promise<void> {
  if (!/^[a-f0-9]{16,64}$/i.test(userId)) throw new GameError(400, "That player id is not valid.");
  const text = note.trim();
  if (text.length > 200) throw new GameError(400, "Keep the note under 200 characters.");
  await db.prepare("UPDATE users SET support_note = ? WHERE id = ?").bind(text || null, userId).run();
  await audit(db, "support.note", userId);
}

function codeStatus(status: string, redeemBy: string, day: string): string {
  if (status === "redeemed" || status === "revoked") return status;
  if (redeemBy < day) return "expired";
  return "unused";
}

export interface SupportEnv {
  GIFT_CODES_ENABLED?: string;
  AUTO_REVOKE_INACTIVE_DAYS?: string;
  AI_USD_TO_RM?: string;
}

export async function supportReport(db: Db, day: string, query: string, inactiveDays: number, endingDays: number, env: SupportEnv) {
  const q = query.trim().toLowerCase().replace(/[%_]/g, "").slice(0, 80);
  const people = q.length >= 2 ? await loadPeople(db, day, q, inactiveRevokeDays(env.AUTO_REVOKE_INACTIVE_DAYS), env) : [];
  const inactive = inactiveDays > 0 ? await loadInactive(db, day, inactiveDays, env) : [];
  const ending = await loadEnding(db, day, endingDays, env);
  const codes = await db.prepare(
    "SELECT code, label, created_day, redeem_by, gift_days, status, redeemed_by, redeemed_at FROM gift_codes ORDER BY created_day DESC, code DESC LIMIT 50",
  ).all<{ code: string; label: string | null; created_day: string; redeem_by: string; gift_days: number; status: string; redeemed_by: string | null; redeemed_at: string | null }>();
  const log = await db.prepare(
    "SELECT at, actor, action, detail FROM admin_audit ORDER BY id DESC LIMIT 30",
  ).all<{ at: string; actor: string; action: string; detail: string }>();
  return {
    giftsEnabled: giftsEnabled(env.GIFT_CODES_ENABLED),
    autoRevokeDays: inactiveRevokeDays(env.AUTO_REVOKE_INACTIVE_DAYS),
    people,
    inactive,
    ending,
    codes: (codes.results || []).map((row) => ({
      code: row.code,
      label: row.label,
      createdDay: row.created_day,
      redeemBy: row.redeem_by,
      giftDays: row.gift_days,
      status: codeStatus(row.status, row.redeem_by, day),
      redeemedBy: row.redeemed_by,
      redeemedAt: row.redeemed_at,
    })),
    audit: log.results || [],
  };
}

interface PersonRow {
  id: string;
  email: string | null;
  google_name: string | null;
  display_name: string | null;
  google_sub: string | null;
  xp: number;
  level: number;
  streak: number;
  last_active_day: string | null;
  support_note: string | null;
  gift_expires: string | null;
  premium_id: string | null;
  paused: number | null;
  food_photo_cap: number | null;
  text_log_cap: number | null;
  recommend_cap: number | null;
  chat_cap: number | null;
}

async function decorate(db: Db, day: string, rows: PersonRow[], rate: number) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => "?").join(",");
  const spend = await db.prepare(
    `SELECT user_id, COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cost_micro), 0) AS cost_micro
     FROM ai_spend WHERE day = ? AND user_id IN (${marks}) GROUP BY user_id`,
  ).bind(day, ...ids).all<{ user_id: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number }>();
  const usage = await db.prepare(
    `SELECT user_id, feature, count FROM ai_usage WHERE day = ? AND user_id IN (${marks})`,
  ).bind(day, ...ids).all<{ user_id: string; feature: string; count: number }>();
  const bySpend = new Map((spend.results || []).map((row) => [row.user_id, row]));
  return rows.map((row) => {
    const cost = bySpend.get(row.id);
    const usd = (cost?.cost_micro || 0) / 1_000_000;
    const plan = row.premium_id ? "premium" : row.gift_expires && row.gift_expires >= day ? "gift" : "free";
    return {
      id: row.id,
      email: row.email,
      name: row.google_name || row.display_name,
      googleSub: row.google_sub,
      level: row.level,
      xp: row.xp,
      streak: row.streak,
      lastActiveDay: row.last_active_day,
      plan,
      giftExpires: row.gift_expires,
      note: row.support_note,
      paused: row.paused === 1,
      caps: {
        food_photo: row.food_photo_cap,
        text_log: row.text_log_cap,
        recommend: row.recommend_cap,
        chat: row.chat_cap,
      },
      usage: (usage.results || []).filter((item) => item.user_id === row.id).map((item) => ({ feature: item.feature, count: item.count })),
      tokens: { input: cost?.input_tokens || 0, output: cost?.output_tokens || 0 },
      cost: { usd: Math.round(usd * 10000) / 10000, rm: Math.round(usd * rate * 10000) / 10000 },
    };
  });
}

const PERSON_SQL = `SELECT u.id, u.email, u.google_name, u.display_name, u.google_sub, u.xp, u.level, u.streak, u.last_active_day, u.support_note,
  g.expires_day AS gift_expires, p.user_id AS premium_id, c.paused, c.food_photo_cap, c.text_log_cap, c.recommend_cap, c.chat_cap
  FROM users u
  LEFT JOIN gifts g ON g.user_id = u.id
  LEFT JOIN premium_users p ON p.user_id = u.id
  LEFT JOIN ai_controls c ON c.user_id = u.id`;

async function loadPeople(db: Db, day: string, q: string, inactiveDays: number, env: SupportEnv) {
  const like = `%${q}%`;
  const rows = await db.prepare(
    `${PERSON_SQL}
     WHERE lower(u.id) = ? OR lower(COALESCE(u.email, '')) LIKE ? OR lower(COALESCE(u.google_name, '')) LIKE ? OR lower(COALESCE(u.display_name, '')) LIKE ? OR lower(COALESCE(u.google_sub, '')) LIKE ?
     LIMIT 20`,
  ).bind(q, like, like, like, like).all<PersonRow>();
  for (const row of rows.results || []) await settleGift(db, row.id, day, inactiveDays);
  return decorate(db, day, rows.results || [], Number(env.AI_USD_TO_RM) || 4.084);
}

async function loadInactive(db: Db, day: string, inactiveDays: number, env: SupportEnv) {
  const cutoff = addDays(day, -inactiveDays);
  const rows = await db.prepare(
    `${PERSON_SQL}
     WHERE u.last_active_day IS NOT NULL AND u.last_active_day < ?
     ORDER BY u.last_active_day LIMIT 50`,
  ).bind(cutoff).all<PersonRow>();
  return decorate(db, day, rows.results || [], Number(env.AI_USD_TO_RM) || 4.084);
}

async function loadEnding(db: Db, day: string, endingDays: number, env: SupportEnv) {
  const until = addDays(day, Math.max(0, endingDays));
  const rows = await db.prepare(
    `${PERSON_SQL}
     WHERE g.expires_day >= ? AND g.expires_day <= ?
     ORDER BY g.expires_day LIMIT 50`,
  ).bind(day, until).all<PersonRow>();
  return decorate(db, day, rows.results || [], Number(env.AI_USD_TO_RM) || 4.084);
}

export async function accountView(db: Db, userId: string, day: string, env: SupportEnv) {
  const user = await db.prepare(
    "SELECT email, google_name, display_name FROM users WHERE id = ?",
  ).bind(userId).first<{ email: string | null; google_name: string | null; display_name: string | null }>();
  const premium = await db.prepare("SELECT user_id FROM premium_users WHERE user_id = ?").bind(userId).first();
  const gift = await settleGift(db, userId, day, inactiveRevokeDays(env.AUTO_REVOKE_INACTIVE_DAYS));
  const plan = premium ? "premium" : gift ? "gift" : "free";
  const daysLeft = gift ? daysBetween(day, gift.expiresDay) : null;
  return {
    email: user?.email || "",
    name: user?.google_name || user?.display_name || "",
    plan,
    giftExpires: gift?.expiresDay || null,
    daysLeft,
    endingSoon: daysLeft != null && daysLeft <= 7,
    giftsEnabled: giftsEnabled(env.GIFT_CODES_ENABLED),
  };
}
