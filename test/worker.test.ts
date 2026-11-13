import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformProxy } from "wrangler";
import { shiftDay } from "../src/worker/brain.ts";
import { handle, type AppEnv } from "../src/worker/http.ts";

const TEST_KEY = "test-admin-key-0123456789";

function utcDay(shift = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + shift);
  return now.toISOString().slice(0, 10);
}

let env: AppEnv;
let dispose: () => Promise<void> = async () => {};

test.before(async () => {
  process.env.ADMIN_KEY = TEST_KEY;
  const proxy = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  env = {
    DB: proxy.env.DB as AppEnv["DB"],
    ALLOWED_ORIGINS: "http://127.0.0.1:8788,http://localhost:8788",
    ADMIN_KEY: TEST_KEY,
  };
  dispose = proxy.dispose;
});

test.after(async () => {
  await dispose();
});

async function call(path: string, options: { method?: string; token?: string; body?: unknown; raw?: string; origin?: string | null } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin || "http://127.0.0.1:8788");
  if (options.token) headers.set("Authorization", "Bearer " + options.token);
  if (options.body !== undefined || options.raw !== undefined) headers.set("Content-Type", "application/json");
  const res = await handle(new Request("http://game.test" + path, {
    method: options.method || "GET",
    headers,
    body: options.raw !== undefined ? options.raw : (options.body === undefined ? undefined : JSON.stringify(options.body)),
  }), env);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function session(prefix: string) {
  const anonId = prefix.padEnd(64, "a");
  const day = utcDay();
  const created = await call("/v1/session", { method: "POST", body: { anonId, day } });
  assert.equal(created.status, 200, created.text);
  return { token: String(created.json?.token), id: anonId, day, body: created.json };
}

test("health, origin gate, and session", async () => {
  assert.equal((await call("/health")).status, 200);
  assert.equal((await call("/health", { origin: null })).status, 200);
  assert.equal((await call("/health", { origin: "https://evil.example" })).status, 403);
  const player = await session("1");
  assert.equal((player.body as { level: number }).level, 1);
  assert.equal((await call("/v1/session", { method: "POST", body: { anonId: player.id, day: player.day } })).status, 409);
});

test("private fields are refused and not stored", async () => {
  const player = await session("2");
  const rice = "chicken rice and a long private note";
  const bad = await call("/v1/events", {
    method: "POST",
    token: player.token,
    body: { day: player.day, events: [{ questId: "water", completed: true, food: rice }] },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.text.includes(rice), false);
  assert.equal(bad.text.includes("food"), false);
  const nested = await call("/v1/events", {
    method: "POST",
    token: player.token,
    body: { day: player.day, note: "felt tired", events: [{ questId: "water", completed: true }] },
  });
  assert.equal(nested.status, 400);
  const huge = await call("/v1/events", { method: "POST", token: player.token, raw: "x".repeat(2001) });
  assert.equal(huge.status, 413);
  const me = await call("/v1/me?day=" + player.day, { token: player.token });
  assert.equal((me.json as { xp: number }).xp, 0);
});

test("a quest awards XP once", async () => {
  const player = await session("3");
  const once = await call("/v1/events", {
    method: "POST",
    token: player.token,
    body: { day: player.day, difficulty: "easy", events: [{ questId: "log_meals", count: 1 }] },
  });
  assert.equal(once.status, 200, once.text);
  const xp = (once.json as { xp: number }).xp;
  assert.ok(xp > 0);
  const twice = await call("/v1/events", {
    method: "POST",
    token: player.token,
    body: { day: player.day, events: [{ questId: "log_meals", count: 1 }] },
  });
  assert.equal((twice.json as { xp: number }).xp, xp);
});

test("display name, team, and owner dashboard", async () => {
  const day = utcDay();
  const one = await session("4");
  const two = await session("5");
  const named = await call("/v1/profile", { method: "POST", token: one.token, body: { displayName: "Aisyah", day } });
  assert.equal(named.status, 200, named.text);
  assert.equal((await call("/v1/profile", { method: "POST", token: one.token, body: { displayName: "a@b.com", day } })).status, 400);
  const water = { day, events: [{ questId: "water", completed: true }] };
  assert.equal((await call("/v1/events", { method: "POST", token: one.token, body: water })).status, 200);
  const created = await call("/v1/team", { method: "POST", token: one.token, body: { action: "create", day } });
  assert.equal(created.status, 200, created.text);
  const code = (created.json as { team: { id: string } }).team.id;
  const joined = await call("/v1/team", { method: "POST", token: two.token, body: { action: "join", code: code.toLowerCase(), day } });
  assert.equal(joined.status, 200, joined.text);
  const second = await call("/v1/events", { method: "POST", token: two.token, body: water });
  assert.equal(second.status, 200, second.text);
  const team = (second.json as { team: { quests: { id: string; done: boolean }[] }; xp: number }).team;
  assert.equal(team.quests.find((quest) => quest.id === "team_show_up")?.done, true);
  assert.ok((second.json as { xp: number }).xp >= 34);
  const before = (await call("/v1/me?day=" + day, { token: one.token })).json as { xp: number };
  const confirmed = await call("/v1/team", { method: "POST", token: two.token, body: { action: "confirm", day } });
  assert.equal(confirmed.status, 200, confirmed.text);
  const after = (await call("/v1/me?day=" + day, { token: one.token })).json as { xp: number };
  assert.equal(after.xp, before.xp + 15);

  const denied = await call("/v1/admin/customers?day=" + day);
  assert.equal(denied.status, 401);
  const wrong = await call("/v1/admin/customers?day=" + day, { token: "not-the-owner-key" });
  assert.equal(wrong.status, 401);
  const admin = await call("/v1/admin/customers?day=" + day, { token: TEST_KEY });
  assert.equal(admin.status, 200, admin.text);
  const customers = (admin.json as { customers: { id: string; displayName: string | null; status: string }[] }).customers;
  const found = customers.find((customer) => customer.id === one.id);
  assert.ok(found);
  assert.equal(found?.displayName, "Aisyah");
  assert.equal(JSON.stringify(admin.json).includes("chicken"), false);

  const old = shiftDay(day, -10);
  const week = shiftDay(day, -7);
  const prev = shiftDay(day, -14);
  await env.DB.prepare("UPDATE users SET xp = 100, last_active_day = ?, program_start = ? WHERE id = ?").bind(day, prev, one.id).run();
  await env.DB.prepare(
    "INSERT INTO snapshots (user_id, day, xp, level, streak, strength, discipline, health, mind) VALUES (?, ?, 80, 1, 1, 2, 2, 1, 1)",
  ).bind(one.id, week).run();
  await env.DB.prepare(
    "INSERT INTO snapshots (user_id, day, xp, level, streak, strength, discipline, health, mind) VALUES (?, ?, 20, 1, 1, 1, 1, 1, 1)",
  ).bind(one.id, prev).run();
  const slipping = await call("/v1/admin/customers?day=" + day, { token: TEST_KEY });
  const row = (slipping.json as { customers: { id: string; status: string; xpGained7: number; xpGained30: number }[] }).customers.find((customer) => customer.id === one.id);
  assert.equal(row?.status, "slipping");
  assert.equal(row?.xpGained7, 20);

  await env.DB.prepare("UPDATE users SET last_active_day = ? WHERE id = ?").bind(old, two.id).run();
  const inactive = await call("/v1/admin/customers?day=" + day, { token: TEST_KEY });
  const quiet = (inactive.json as { customers: { id: string; status: string }[] }).customers.find((customer) => customer.id === two.id);
  assert.equal(quiet?.status, "inactive");

  const noisy = await session("6");
  const volume = await call("/v1/events", {
    method: "POST",
    token: noisy.token,
    body: { day, events: [{ questId: "log_workout", count: 6, source: "manual" }] },
  });
  assert.equal(volume.status, 200, volume.text);
  const ignored = await call("/v1/events", {
    method: "POST",
    token: noisy.token,
    body: { day, events: [{ questId: "focus", completed: true, source: "timer", durationMin: 9999 }] },
  });
  assert.equal(ignored.status, 200, ignored.text);
  assert.equal(String((ignored.json as { warning?: string }).warning || "").includes("9999"), false);
  const flagged = await call("/v1/admin/customers?day=" + day, { token: TEST_KEY });
  const suspect = (flagged.json as { customers: { id: string; flagged: boolean; flagCodes: string[] }[] }).customers.find((customer) => customer.id === noisy.id);
  assert.equal(suspect?.flagged, true);
  assert.ok(suspect?.flagCodes.includes("volume"));
  assert.ok(suspect?.flagCodes.includes("duration"));
  assert.equal(JSON.stringify(suspect).includes("9999"), false);
});

test("plans, duels, and the coach stay off the health log", async () => {
  const day = utcDay();
  const one = await session("7");
  const two = await session("8");
  const chosen = await call("/v1/profile", { method: "POST", token: one.token, body: { day, programChoice: "home" } });
  assert.equal(chosen.status, 200, chosen.text);
  const sessionPlan = chosen.json as { session: { moves: { name: string }[] }; quests: { id: string }[] };
  assert.ok(sessionPlan.session.moves.length >= 2);
  assert.equal(sessionPlan.quests.some((quest) => quest.id === "program_session"), true);
  assert.equal(JSON.stringify(chosen.json).includes("nasi"), false);
  await call("/v1/team", { method: "POST", token: one.token, body: { action: "create", day } });
  const code = ((await call("/v1/me?day=" + day, { token: one.token })).json as { team: { id: string } }).team.id;
  assert.equal((await call("/v1/team", { method: "POST", token: two.token, body: { action: "join", code, day } })).status, 200);
  await call("/v1/profile", { method: "POST", token: two.token, body: { day, programChoice: "home" } });
  assert.equal((await call("/v1/team", { method: "POST", token: one.token, body: { action: "duel", day } })).status, 200);
  const play = (token: string, steps: number) => call("/v1/events", {
    method: "POST",
    token,
    body: { day, events: [{ questId: "program_session", completed: true, source: "manual" }, { questId: "steps", count: steps, source: "manual" }] },
  });
  assert.equal((await play(one.token, 3000)).status, 200);
  const finished = await play(two.token, 9000);
  assert.equal(finished.status, 200, finished.text);
  const duel = (finished.json as { duel: { status: string; winnerId: string | null } }).duel;
  assert.equal(duel.status, "done");
  assert.equal(duel.winnerId, two.id);
  const coach = await call("/v1/coach", { method: "POST", token: one.token, body: { day, food: "rice" } });
  assert.equal(coach.status, 400);
  assert.equal(coach.text.includes("rice"), false);
  const noKey = await call("/v1/coach", { method: "POST", token: one.token, body: { day } });
  assert.equal(noKey.status, 400);
});

test("owner route stays closed when the key is missing", async () => {
  const saved = env.ADMIN_KEY;
  env.ADMIN_KEY = "";
  const res = await call("/v1/admin/customers?day=" + utcDay(), { token: TEST_KEY });
  env.ADMIN_KEY = saved;
  assert.equal(res.status, 503);
});
