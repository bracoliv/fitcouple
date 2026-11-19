import { sha256Hex } from "./crypto.ts";
import type { Db } from "./data.ts";
import { GameError } from "./errors.ts";

export function positiveInt(raw: string | undefined, fallback: number, max = 100000): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return fallback;
  return n;
}

function windowStart(windowSec: number, nowSec = Math.floor(Date.now() / 1000)): number {
  return nowSec - (nowSec % windowSec);
}

async function bucket(label: string, ip: string): Promise<string> {
  return sha256Hex(`fitcouple-rate-v1:${label}:${ip}`);
}

export async function enforceKeyedRate(db: Db, label: string, id: string, limit: number, windowSec: number): Promise<void> {
  const key = await bucket(label, id);
  const start = windowStart(windowSec);
  const row = await db.prepare(
    `INSERT INTO rate_windows (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(key, start).first<{ count: number }>();
  if ((row?.count || 1) > limit) {
    throw new GameError(429, "Too many tries. Wait a minute and try again.");
  }
}

export async function enforceRate(db: Db, request: Request, label: string, limit: number, windowSec: number): Promise<void> {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await enforceKeyedRate(db, label, ip, limit, windowSec);
}

export async function adminFailures(db: Db, request: Request, limit: number, windowSec: number): Promise<{ blocked: boolean; note: () => Promise<void> }> {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const key = await bucket("admin-fail", ip);
  const start = windowStart(windowSec);
  const current = await db.prepare(
    "SELECT count FROM rate_windows WHERE bucket = ? AND window_start = ?",
  ).bind(key, start).first<{ count: number }>();
  return {
    blocked: (current?.count || 0) >= limit,
    note: async () => {
      await db.prepare(
        `INSERT INTO rate_windows (bucket, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1`,
      ).bind(key, start).run();
    },
  };
}
