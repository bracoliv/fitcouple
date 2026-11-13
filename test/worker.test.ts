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

async function call(path: string, options: { method?: string; token?: string; body?: unknown; raw?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin || "http://127.0.0.1:8788");
  if (options.token) headers.set("Authorization", "Bearer " + options.token);
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) headers.set(key, value);
  }
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

test("restaurant vouchers stay hidden until the flag is on", async () => {
  const day = utcDay();
  const quiet = await session("c");
  assert.equal((quiet.body as { vouchersEnabled: boolean }).vouchersEnabled, false);
  assert.equal(((quiet.body as { quests: { id: string }[] }).quests || []).some((quest) => quest.id === "restaurant_meal"), false);
  const skipped = await call("/v1/events", {
    method: "POST",
    token: quiet.token,
    body: { day, events: [{ questId: "restaurant_meal", completed: true, source: "manual", food: "rice" }] },
  });
  assert.equal(skipped.status, 400);
  assert.equal(skipped.text.includes("rice"), false);
  assert.equal((await call("/v1/vouchers/redeem", { method: "POST", token: "staff-test-key-012345", body: { code: "FIT-ABCDEF12345678" } })).status, 404);

  env.VOUCHERS_ENABLED = "true";
  env.VOUCHER_MILESTONES = "streak:1:5,level:1:9";
  env.VOUCHER_EXPIRY_DAYS = "14";
  env.VOUCHER_VERIFIED_DAYS = "1";
  env.VOUCHER_VALUE_LABEL = "RM";
  env.VOUCHER_PREFIX = "FIT";
  env.STAFF_KEY = "staff-test-key-012345";
  try {
    const player = await session("d");
    const water = await call("/v1/events", {
      method: "POST",
      token: player.token,
      body: { day, events: [{ questId: "water", completed: true, source: "manual" }] },
    });
    assert.equal(water.status, 200, water.text);
    const waterBody = water.json as { vouchersEnabled: boolean; voucherCodes: { code: string; milestone: string }[]; vouchers: { milestone: string }[]; quests: { id: string }[] };
    assert.equal(waterBody.vouchersEnabled, true);
    assert.equal(waterBody.quests.some((quest) => quest.id === "restaurant_meal"), true);
    assert.equal(waterBody.voucherCodes.length, 1);
    assert.equal(waterBody.voucherCodes[0].milestone, "streak:1");
    assert.equal(JSON.stringify(water.json).includes("nasi"), false);
    const timer = await call("/v1/events", {
      method: "POST",
      token: player.token,
      body: { day, events: [{ questId: "focus", completed: true, source: "timer", durationMin: 25 }] },
    });
    const timerCodes = (timer.json as { voucherCodes: { code: string; milestone: string }[] }).voucherCodes;
    assert.equal(timerCodes.length, 1);
    assert.equal(timerCodes[0].milestone, "level:1");
    const yesterday = shiftDay(day, -1);
    await env.DB.prepare("UPDATE vouchers SET expires_day = ? WHERE user_id = ? AND milestone = 'level:1'").bind(yesterday, player.id).run();
    const expired = await call("/v1/vouchers/redeem", { method: "POST", token: env.STAFF_KEY, body: { code: timerCodes[0].code } });
    assert.equal(expired.status, 410);
    const used = await call("/v1/vouchers/redeem", { method: "POST", token: env.STAFF_KEY, body: { code: waterBody.voucherCodes[0].code } });
    assert.equal(used.status, 200, used.text);
    const again = await call("/v1/vouchers/redeem", { method: "POST", token: env.STAFF_KEY, body: { code: waterBody.voucherCodes[0].code } });
    assert.equal(again.status, 409);
    const admin = await call("/v1/admin/customers?day=" + day, { token: TEST_KEY });
    const counts = (admin.json as { vouchers: { enabled: boolean; issued: number; redeemed: number } }).vouchers;
    assert.equal(counts.enabled, true);
    assert.ok(counts.issued >= 2);
    assert.ok(counts.redeemed >= 1);
  } finally {
    delete env.VOUCHERS_ENABLED;
    delete env.VOUCHER_MILESTONES;
    delete env.VOUCHER_EXPIRY_DAYS;
    delete env.VOUCHER_VERIFIED_DAYS;
    delete env.VOUCHER_VALUE_LABEL;
    delete env.VOUCHER_PREFIX;
    delete env.STAFF_KEY;
  }
});

test("the shop stays out of the game and does not use health data", async () => {
  const day = utcDay();
  const quiet = await session("e");
  assert.equal((quiet.body as { store?: unknown }).store, undefined);
  assert.equal((await call("/v1/store/catalog", { token: quiet.token })).status, 404);
  assert.equal((await call("/v1/store/checkout", {
    method: "POST",
    token: quiet.token,
    body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }], consent: true },
  })).status, 404);

  const product = {
    id: "whey",
    brand: "sosm",
    name: "Chocolate whey, 900 g",
    why: "A plain powder the seller already stocks.",
    evidence: "The tub label lists the serving size.",
    dose: "One scoop, about 30 g.",
    testing: "Not third-party tested.",
    halal: "not-stated",
    mal: "not-stated",
    audience: "all",
    priceCents: 9900,
    listPriceCents: 9900,
    shopeeUrl: "https://shopee.com.my/whey",
    active: true,
  };
  env.STORE_ENABLED = "true";
  env.STORE_MODE = "external";
  env.STORE_SANDBOX = "true";
  env.STORE_CURRENCY = "RM";
  env.STORE_SELLER_NAME = "Ari Shop";
  env.STORE_SELLER_LINE = "Kuala Lumpur";
  env.STORE_SELLER_CONTACT = "0123456789";
  try {
    const saved = await call("/v1/admin/products", { method: "POST", token: TEST_KEY, body: product });
    assert.equal(saved.status, 200, saved.text);
    const claim = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: { ...product, id: "bad", name: "Burns fat fast" },
    });
    assert.equal(claim.status, 400);
    const cheap = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: { ...product, id: "cheap", priceCents: 1000, listPriceCents: 9900 },
    });
    assert.equal(cheap.status, 400);
    const adult = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: { ...product, id: "pre", name: "Pre workout, 300 g", audience: "adult" },
    });
    assert.equal(adult.status, 200, adult.text);
    const shown = await call("/v1/store/catalog", { token: quiet.token });
    const store = shown.json as { mode: string; recommended: { id: string; shopeeUrl: string }[]; adult: unknown[]; adultLocked: boolean };
    assert.equal(store.mode, "external");
    assert.equal(store.recommended.length, 1);
    assert.equal(store.recommended[0].id, "whey");
    assert.equal(store.adult.length, 0);
    assert.equal(store.adultLocked, true);
    assert.equal(JSON.stringify(shown.json).includes("suggestions"), false);
    const moved = await call("/v1/events", {
      method: "POST",
      token: quiet.token,
      body: { day, events: [{ questId: "log_workout", count: 1, source: "manual" }] },
    });
    assert.equal(JSON.stringify(moved.json).includes("whey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(moved.json, "store"), false);
    const again = await call("/v1/store/catalog", { token: quiet.token });
    assert.equal(JSON.stringify((again.json as { recommended: unknown[] }).recommended), JSON.stringify(store.recommended));
    const opened = await call("/v1/store/catalog", { token: quiet.token, headers: { "X-Age-Confirm": "18" } });
    assert.equal((opened.json as { adult: { id: string }[] }).adult[0].id, "pre");
    const linked = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }], consent: true, weight: 70 },
    });
    assert.equal(linked.status, 400);
    assert.equal(linked.text.includes("70"), false);
    env.STORE_MODE = "checkout";
    env.STORE_GATEWAY = "stripe";
    const refused = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }] },
    });
    assert.equal(refused.status, 400);
    const tooYoung = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "pre", qty: 1 }], consent: true },
    });
    assert.equal(tooYoung.status, 400);
    const order = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }], consent: true },
    });
    assert.equal(order.status, 200, order.text);
    const paid = order.json as { orderId: string; url: string; sandbox: boolean };
    assert.equal(paid.sandbox, true);
    const params = new URL(paid.url).searchParams;
    const done = await call("/v1/store/sandbox-complete", { method: "POST", body: { orderId: paid.orderId, proof: params.get("proof") } });
    assert.equal(done.status, 200, done.text);
    env.STRIPE_SECRET = "sk_live_not_allowed";
    const live = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }], consent: true },
    });
    assert.equal(live.status, 403);
  } finally {
    delete env.STORE_ENABLED;
    delete env.STORE_MODE;
    delete env.STORE_GATEWAY;
    delete env.STORE_SANDBOX;
    delete env.STORE_CURRENCY;
    delete env.STORE_SELLER_NAME;
    delete env.STORE_SELLER_LINE;
    delete env.STORE_SELLER_CONTACT;
    delete env.STRIPE_SECRET;
  }
});

test("owner route stays closed when the key is missing", async () => {
  const saved = env.ADMIN_KEY;
  env.ADMIN_KEY = "";
  const res = await call("/v1/admin/customers?day=" + utcDay(), { token: TEST_KEY });
  env.ADMIN_KEY = saved;
  assert.equal(res.status, 503);
});
