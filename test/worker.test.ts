import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformProxy } from "wrangler";
import { shiftDay } from "../src/worker/brain.ts";
import { handle, type AppEnv } from "../src/worker/http.ts";
import { googleFixture } from "./google-fixture.ts";

const TEST_KEY = "test-admin-key-0123456789abcdef01";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const google = googleFixture();

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
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_SUB_SALT: "test-salt-value-0123456789",
    SITE_URL: "http://127.0.0.1:8788",
    RATE_SESSION_LIMIT: "1000",
    RATE_AI_LIMIT: "1000",
    AI_DAILY_BUDGET_USD: "5",
  };
  dispose = proxy.dispose;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/oauth2/v3/certs")) {
      return new Response(JSON.stringify({ keys: [google.jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as RequestInfo, init);
  };
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
  return { status: res.status, json, text, headers: res.headers };
}

async function session(prefix: string, options: { ip?: string } = {}) {
  const day = utcDay();
  const created = await call("/v1/session", {
    method: "POST",
    headers: options.ip ? { "CF-Connecting-IP": options.ip } : undefined,
    body: { idToken: google.idToken(prefix), day },
  });
  assert.equal(created.status, 200, created.text);
  return { token: String(created.json?.token), id: String(created.json?.id), day, body: created.json, sub: prefix };
}

test("health, origin gate, and session", async () => {
  const health = await call("/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(health.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(health.headers.get("Content-Security-Policy")?.includes("frame-ancestors 'none'"), true);
  assert.equal((await call("/health", { origin: null })).status, 200);
  assert.equal((await call("/health", { origin: "https://evil.example" })).status, 403);
  const player = await session("1");
  assert.equal((player.body as { level: number }).level, 1);
  const again = await call("/v1/session", { method: "POST", body: { idToken: google.idToken("1"), day: player.day } });
  assert.equal(again.status, 200, again.text);
  assert.equal((again.json as { id: string }).id, player.id);
  assert.notEqual((again.json as { token: string }).token, player.token);
  const old = await call("/v1/me?day=" + player.day, { token: player.token });
  assert.equal(old.status, 401);
  const anon = await call("/v1/session", { method: "POST", body: { anonId: "a".repeat(64), day: player.day } });
  assert.equal(anon.status, 400);
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
    store: "pump",
    kind: "whey",
    brand: "other",
    name: "ON Gold Standard Whey, Double Rich Chocolate",
    why: "A widely sold whey with the serving printed on the tub.",
    evidence: "The label lists the serving size.",
    dose: "One scoop, as printed on the tub.",
    testing: "Not third-party tested.",
    halal: "not-stated",
    mal: "not-stated",
    priceCents: 19900,
    listPriceCents: 19900,
    linkUrl: "https://www.myprotein.com.my/sports-nutrition/whey",
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
      body: { ...product, id: "cheap", priceCents: 1000, listPriceCents: 19900 },
    });
    assert.equal(cheap.status, 400);
    const burner = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: { ...product, id: "burn", kind: "whey", name: "MateBurn" },
    });
    assert.equal(burner.status, 400);
    const slim = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: {
        ...product,
        id: "mate",
        store: "slim",
        kind: "sosm",
        brand: "sosm",
        name: "MateBurn",
        why: "The owner's SOSM+ product.",
        linkUrl: "https://shopee.com.my/mateburn",
      },
    });
    assert.equal(slim.status, 200, slim.text);
    const slimClaim = await call("/v1/admin/products", {
      method: "POST",
      token: TEST_KEY,
      body: { ...product, id: "mate2", store: "slim", kind: "sosm", brand: "sosm", name: "Night Booster", why: "Burns fat fast", linkUrl: "https://wa.me/60123456789" },
    });
    assert.equal(slimClaim.status, 400);
    const shown = await call("/v1/store/catalog", { token: quiet.token });
    const store = shown.json as { mode: string; pump: { products: { id: string }[] }; slim: { locked: boolean; products: { id: string }[]; adLine: string } };
    assert.equal(store.mode, "external");
    assert.equal(store.pump.products.length, 1);
    assert.equal(store.pump.products[0].id, "whey");
    assert.equal(store.slim.products.length, 0);
    assert.equal(store.slim.locked, true);
    assert.equal(store.slim.adLine.includes("balanced diet"), true);
    assert.equal(JSON.stringify(store.pump).includes("mate"), false);
    const moved = await call("/v1/events", {
      method: "POST",
      token: quiet.token,
      body: { day, events: [{ questId: "log_workout", count: 1, source: "manual" }] },
    });
    assert.equal(JSON.stringify(moved.json).includes("MateBurn"), false);
    assert.equal(JSON.stringify(moved.json).includes("Gold Standard"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(moved.json, "store"), false);
    const again = await call("/v1/store/catalog", { token: quiet.token });
    assert.equal(JSON.stringify((again.json as { pump: { products: unknown[] } }).pump.products), JSON.stringify(store.pump.products));
    const opened = await call("/v1/store/catalog", { token: quiet.token, headers: { "X-Age-Confirm": "18" } });
    const aged = opened.json as { pump: { products: { id: string }[] }; slim: { products: { id: string }[] } };
    assert.equal(aged.slim.products[0].id, "mate");
    assert.equal(aged.pump.products.some((item) => item.id === "mate"), false);
    assert.equal(aged.slim.products.some((item) => item.id === "whey"), false);
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
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "mate", qty: 1 }], consent: true },
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
    assert.equal(new URL(paid.url).origin, "http://127.0.0.1:8788");
    const shifted = await call("/v1/store/checkout", {
      method: "POST",
      token: quiet.token,
      origin: "http://localhost:8788",
      body: { name: "Ari", phone: "0123456789", address: "12 Jalan Fit", items: [{ id: "whey", qty: 1 }], consent: true },
    });
    assert.equal(shifted.status, 200, shifted.text);
    assert.equal(new URL((shifted.json as { url: string }).url).origin, "http://127.0.0.1:8788");
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

test("the assistant counts use and does not store the message", async () => {
  const player = await session("f");
  const phrase = "secret-meal-phrase-xyz";
  const denied = await call("/v1/ai/food-text", {
    method: "POST",
    token: player.token,
    body: { text: phrase },
  });
  assert.equal(denied.status, 400);
  env.GEMINI_API_KEY = "test-gemini-key";
  env.AI_MODEL = "gemini-3.5-flash-lite";
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"items":[{"name":"egg","portion":"1","kcal":70,"protein":6,"carbs":0,"fat":5}]}' }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return original(input as RequestInfo, init);
  };
  try {
    const first = await call("/v1/ai/food-text", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { text: phrase },
    });
    assert.equal(first.status, 200, first.text);
    assert.equal((first.json as { items: { name: string }[] }).items[0].name, "egg");
    const rows = await env.DB.prepare("SELECT feature, count FROM ai_usage").all<{ feature: string; count: number }>();
    assert.equal(JSON.stringify(rows).includes(phrase), false);
    assert.equal((rows.results || []).some((row) => row.feature === "text_log" && row.count === 1), true);
    const spend = await env.DB.prepare("SELECT provider, calls, input_tokens, output_tokens, cost_micro FROM ai_spend").all<{ provider: string; calls: number; input_tokens: number; output_tokens: number; cost_micro: number }>();
    assert.equal(JSON.stringify(spend).includes(phrase), false);
    const google = (spend.results || []).find((row) => row.provider === "google");
    assert.equal(google?.input_tokens, 1000);
    assert.equal(google?.output_tokens, 25);
    assert.equal(google?.cost_micro, Math.round(1000 * 0.3 + 25 * 2.5));
    await call("/v1/admin/ai/limits", { method: "POST", token: TEST_KEY, body: { feature: "text_log", dailyCap: 1 } });
    const blocked = await call("/v1/ai/food-text", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { text: "another plate" },
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.text.includes("another plate"), false);
    await call("/v1/admin/ai/premium", { method: "POST", token: TEST_KEY, body: { userId: player.id, grant: true } });
    const open = await call("/v1/ai/food-text", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { text: "still not stored" },
    });
    assert.equal(open.status, 200, open.text);
    assert.equal((await call("/v1/premium/checkout", { method: "POST", token: player.token, body: {} })).status, 404);
  } finally {
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
    delete env.AI_MODEL;
  }
});

test("a busy Gemini call falls through to Qwen and a bad request does not", async () => {
  const player = await session("a");
  env.GEMINI_API_KEY = "test-gemini-key";
  env.QWEN_API_KEY = "test-qwen-key";
  env.OPENAI_API_KEY = "test-openai-key";
  const calls: string[] = [];
  const original = globalThis.fetch;
  let googleStatus = 429;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response("no", { status: googleStatus });
    }
    if (url.includes("dashscope-intl.aliyuncs.com")) {
      const body = String((init as RequestInit | undefined)?.body || "");
      assert.equal(body.includes("qwen3-vl-plus"), true);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"items":[{"name":"rice","portion":"1 cup","kcal":260,"protein":4,"carbs":58,"fat":0}]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return original(input as RequestInfo, init);
  };
  try {
    const moved = await call("/v1/ai/food-text", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { text: "unlisted dish" },
    });
    assert.equal(moved.status, 200, moved.text);
    assert.equal((moved.json as { items: { name: string }[] }).items[0].name, "rice");
    assert.equal(calls.some((url) => url.includes("api.openai.com")), false);
    const providers = await env.DB.prepare("SELECT provider, calls, fallbacks, cost_micro FROM ai_provider_counts").all<{ provider: string; calls: number; fallbacks: number; cost_micro: number }>();
    assert.equal(providers.results?.find((row) => row.provider === "google")?.fallbacks, 1);
    assert.equal(providers.results?.find((row) => row.provider === "qwen")?.calls, 1);
    assert.equal(providers.results?.find((row) => row.provider === "qwen")?.cost_micro, Math.round(100 * 0.2 + 40 * 1.6));
    calls.length = 0;
    await call("/v1/admin/ai/limits", { method: "POST", token: TEST_KEY, body: { feature: "text_log", dailyCap: 20 } });
    googleStatus = 400;
    const stopped = await call("/v1/ai/food-text", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { text: "still unlisted" },
    });
    assert.equal(stopped.status, 502);
    assert.equal(calls.some((url) => url.includes("dashscope")), false);
  } finally {
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
    delete env.QWEN_API_KEY;
    delete env.OPENAI_API_KEY;
  }
});

test("an obvious off-topic chat is refused without calling a model", async () => {
  const player = await session("b");
  env.GEMINI_API_KEY = "test-gemini-key";
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com") || url.includes("dashscope") || url.includes("api.openai.com")) {
      called = true;
      return new Response("no", { status: 200 });
    }
    return original(input as RequestInfo, init);
  };
  try {
    const refused = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "write my essay about rome" },
    });
    assert.equal(refused.status, 200, refused.text);
    assert.equal((refused.json as { refused?: boolean }).refused, true);
    assert.equal(called, false);
    assert.equal(refused.text.includes("rome"), false);
    const usage = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND feature = 'chat'").bind(player.id).first<{ count: number }>();
    assert.equal(usage?.count, 1);
    const note = await call("/v1/ai/feedback", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: {},
    });
    assert.equal(note.status, 200, note.text);
    const feedback = await env.DB.prepare("SELECT count FROM ai_feedback").first<{ count: number }>();
    assert.equal(feedback?.count, 1);
    const again = await call("/v1/ai/feedback", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: {},
    });
    assert.equal(again.status, 200, again.text);
    assert.equal((again.json as { counted?: boolean }).counted, false);
    const still = await env.DB.prepare("SELECT count FROM ai_feedback").first<{ count: number }>();
    assert.equal(still?.count, 1);
    await call("/v1/admin/ai/control", {
      method: "POST",
      token: TEST_KEY,
      body: { userId: player.id, paused: true, food_photo: null, text_log: null, recommend: null, chat: 0 },
    });
    const paused = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "what should I eat before a match" },
    });
    assert.equal(paused.status, 403);
  } finally {
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
  }
});

test("owner route stays closed when the key is missing", async () => {
  const saved = env.ADMIN_KEY;
  env.ADMIN_KEY = "";
  const res = await call("/v1/admin/customers?day=" + utcDay(), { token: TEST_KEY });
  env.ADMIN_KEY = saved;
  assert.equal(res.status, 503);
});

test("caps, budget, photo size, and admin lock", async () => {
  const day = utcDay();
  const player = await session("capuser");
  env.GEMINI_API_KEY = "test-gemini-key";
  env.QWEN_API_KEY = "test-qwen-key";
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com") || url.includes("dashscope") || url.includes("api.openai.com")) {
      seen.push(url);
      return new Response("no", { status: 429 });
    }
    return original(input as RequestInfo, init);
  };
  try {
    await call("/v1/admin/ai/control", {
      method: "POST",
      token: TEST_KEY,
      body: { userId: player.id, paused: false, food_photo: null, text_log: null, recommend: null, chat: 0 },
    });
    const capped = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "what should I eat before a match" },
    });
    assert.equal(capped.status, 429, capped.text);
    assert.equal(capped.text.includes("Premium"), true);
    assert.equal(seen.length, 0);

    env.AI_DAILY_BUDGET_USD = "0";
    await call("/v1/admin/ai/control", {
      method: "POST",
      token: TEST_KEY,
      body: { userId: player.id, paused: false, food_photo: null, text_log: null, recommend: null, chat: null },
    });
    const busy = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "how much water today" },
    });
    assert.equal(busy.status, 503, busy.text);
    assert.equal(busy.text.includes("busy"), true);
    assert.equal(seen.length, 0);
    const used = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND feature = 'chat'").bind(player.id).first<{ count: number }>();
    assert.equal(used?.count || 0, 0);
  } finally {
    env.AI_DAILY_BUDGET_USD = "5";
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
    delete env.QWEN_API_KEY;
  }

  const photo = await session("photouser");
  env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"items":[{"name":"rice","portion":"1 cup","kcal":200,"protein":4,"carbs":45,"fat":0}]}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return original(input as RequestInfo, init);
  };
  try {
    const wide = await call("/v1/ai/food-photo", {
      method: "POST",
      token: photo.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { image: "A".repeat(9000), mime: "image/jpeg" },
    });
    assert.equal(wide.status, 200, wide.text);
    assert.equal((wide.json as { items: { name: string }[] }).items[0].name, "rice");
    const huge = await call("/v1/ai/food-photo", {
      method: "POST",
      token: photo.token,
      headers: { "X-Ai-Consent": "yes" },
      raw: JSON.stringify({ image: "A".repeat(1_700_000) }),
    });
    assert.equal(huge.status, 413);
    const text = await call("/v1/ai/food-text", {
      method: "POST",
      token: photo.token,
      headers: { "X-Ai-Consent": "yes" },
      raw: JSON.stringify({ text: "a".repeat(8000) }),
    });
    assert.equal(text.status, 413);
  } finally {
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
  }

  const admin = await call("/v1/admin/ai", { token: TEST_KEY });
  assert.equal(admin.status, 200, admin.text);
  const budget = (admin.json as { budget: { budgetUsd: number; window: string } }).budget;
  assert.equal(budget.budgetUsd, 5);
  assert.equal(budget.window.includes("MYT"), true);

  const savedKey = env.ADMIN_KEY;
  env.ADMIN_KEY = "local-dev-admin-key-change-me";
  assert.equal((await call("/v1/admin/ai", { token: env.ADMIN_KEY })).status, 503);
  env.ADMIN_KEY = "short-owner-key";
  assert.equal((await call("/v1/admin/ai", { token: env.ADMIN_KEY })).status, 503);
  env.ADMIN_KEY = savedKey;

  const { sha256Hex } = await import("../src/worker/crypto.ts");
  const ip = "203.0.113.44";
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % 60);
  const sessionBucket = await sha256Hex(`fitcouple-rate-v1:session:${ip}`);
  await env.DB.prepare(
    "INSERT INTO rate_windows (bucket, window_start, count) VALUES (?, ?, 1000)",
  ).bind(sessionBucket, start).run();
  const limited = await call("/v1/session", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: { idToken: google.idToken("rateuser"), day },
  });
  assert.equal(limited.status, 429);

  const adminIp = "203.0.113.45";
  const failBucket = await sha256Hex(`fitcouple-rate-v1:admin-fail:${adminIp}`);
  const adminStart = now - (now % 900);
  await env.DB.prepare(
    "INSERT INTO rate_windows (bucket, window_start, count) VALUES (?, ?, 8)",
  ).bind(failBucket, adminStart).run();
  const locked = await call("/v1/admin/ai", { token: TEST_KEY, headers: { "CF-Connecting-IP": adminIp } });
  assert.equal(locked.status, 429);
});

test("a provider network error falls through and a client error does not", async () => {
  const player = await session("netuser");
  env.GEMINI_API_KEY = "test-gemini-key";
  env.QWEN_API_KEY = "test-qwen-key";
  const original = globalThis.fetch;
  const alerts: string[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => { alerts.push(args.map(String).join(" ")); };
  let mode = "throw";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com")) {
      if (mode === "throw") throw new Error("network down");
      return new Response("no", { status: 401 });
    }
    if (url.includes("dashscope")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Drink some water." } }],
        usage: { prompt_tokens: 4, completion_tokens: 4 },
      }), { status: 200 });
    }
    return original(input as RequestInfo);
  };
  try {
    const moved = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "how much water today" },
    });
    assert.equal(moved.status, 200, moved.text);
    mode = "401";
    const stopped = await call("/v1/ai/chat", {
      method: "POST",
      token: player.token,
      headers: { "X-Ai-Consent": "yes" },
      body: { message: "how much should I sleep" },
    });
    assert.equal(stopped.status, 502, stopped.text);
    assert.equal(alerts.some((line) => line.includes("ai-provider-rejected") && line.includes("401")), true);
    assert.equal(alerts.some((line) => line.includes("how much should I sleep")), false);
    const usage = await env.DB.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND feature = 'chat'").bind(player.id).first<{ count: number }>();
    assert.equal(usage?.count, 1);
  } finally {
    console.error = log;
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
    delete env.QWEN_API_KEY;
  }
});

test("two chats at once cannot both pass a cap of one", async () => {
  const player = await session("concuser");
  await call("/v1/admin/ai/control", {
    method: "POST",
    token: TEST_KEY,
    body: { userId: player.id, paused: false, food_photo: null, text_log: null, recommend: null, chat: 1 },
  });
  env.GEMINI_API_KEY = "test-gemini-key";
  env.QWEN_API_KEY = "test-qwen-key";
  const original = globalThis.fetch;
  let calls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("generativelanguage.googleapis.com") || url.includes("dashscope") || url.includes("api.openai.com")) {
      calls += 1;
      await gate;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Walk for ten minutes." }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3 },
      }), { status: 200 });
    }
    return original(input as RequestInfo, init);
  };
  try {
    const pending = Promise.all([
      call("/v1/ai/chat", { method: "POST", token: player.token, headers: { "X-Ai-Consent": "yes" }, body: { message: "what should I eat before a match" } }),
      call("/v1/ai/chat", { method: "POST", token: player.token, headers: { "X-Ai-Consent": "yes" }, body: { message: "how much water today" } }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const done = await pending;
    const statuses = done.map((item) => item.status).sort();
    assert.deepEqual(statuses, [200, 429]);
    assert.equal(calls, 1);
    assert.equal(done.some((item) => item.text.includes("Premium")), true);
  } finally {
    release();
    globalThis.fetch = original;
    delete env.GEMINI_API_KEY;
    delete env.QWEN_API_KEY;
  }
});

test("an old session token still opens that profile and Google identity is stored", async () => {
  const { sha256Hex } = await import("../src/worker/crypto.ts");
  const { legacyAccountId, plainAccountId } = await import("../src/worker/google-auth.ts");
  const token = "ab".repeat(32);
  const id = "cd".repeat(32);
  await env.DB.prepare(
    `INSERT INTO users (id, token_hash, xp, level, streak, strength, discipline, health, mind, difficulty, program_start)
     VALUES (?, ?, 12, 1, 0, 1, 1, 1, 1, 'normal', ?)`,
  ).bind(id, await sha256Hex(token), utcDay()).run();
  const me = await call("/v1/me?day=" + utcDay(), { token });
  assert.equal(me.status, 200, me.text);
  assert.equal((me.json as { id: string; xp: number }).id, id);
  assert.equal((me.json as { xp: number }).xp, 12);
  const sub = "884422110099";
  const legacy = await legacyAccountId(sub, env.GOOGLE_SUB_SALT);
  assert.ok(legacy);
  await env.DB.prepare(
    `INSERT INTO users (id, token_hash, xp, level, streak, strength, discipline, health, mind, difficulty, program_start)
     VALUES (?, ?, 40, 1, 0, 1, 1, 1, 1, 'normal', ?)`,
  ).bind(legacy, await sha256Hex("ef".repeat(32)), utcDay()).run();
  const created = await call("/v1/session", {
    method: "POST",
    body: { idToken: google.idToken(sub, { email: "Person@Example.com", name: "Old Name" }), day: utcDay() },
  });
  assert.equal(created.status, 200, created.text);
  assert.equal((created.json as { id: string; xp: number }).id, legacy);
  assert.equal((created.json as { xp: number }).xp, 40);
  const row = await env.DB.prepare("SELECT email, google_sub, google_name FROM users WHERE id = ?").bind(legacy).first<{ email: string; google_sub: string; google_name: string }>();
  assert.equal(row?.email, "person@example.com");
  assert.equal(row?.google_sub, sub);
  assert.equal(row?.google_name, "Old Name");
  const renamed = await call("/v1/session", {
    method: "POST",
    body: { idToken: google.idToken(sub, { email: "Person@Example.com", name: "New Name" }), day: utcDay() },
  });
  assert.equal((renamed.json as { id: string }).id, legacy);
  const again = await env.DB.prepare("SELECT google_name FROM users WHERE id = ?").bind(legacy).first<{ google_name: string }>();
  assert.equal(again?.google_name, "New Name");
  const fresh = await session("plainuser");
  assert.equal(fresh.id, await plainAccountId("plainuser"));
});

test("admin access closes the owner routes until Cloudflare Access allows them", async () => {
  env.CF_ACCESS_AUD = "aud-tag";
  env.CF_ACCESS_TEAM_DOMAIN = "fit.cloudflareaccess.com";
  try {
    const closed = await call("/v1/admin/ai", { token: TEST_KEY });
    assert.equal(closed.status, 403);
    assert.equal(closed.text.includes(TEST_KEY), false);
  } finally {
    delete env.CF_ACCESS_AUD;
    delete env.CF_ACCESS_TEAM_DOMAIN;
  }
});

test("gift codes redeem once, expire, revoke, extend, and return to free", async () => {
  const player = await session("giftuser");
  const made = await call("/v1/admin/gifts/codes", {
    method: "POST",
    token: TEST_KEY,
    body: { count: 2, label: "order 12", redeemDays: 30, giftDays: 66 },
  });
  assert.equal(made.status, 200, made.text);
  const codes = (made.json as { codes: string[] }).codes;
  assert.equal(codes.length, 2);
  assert.match(codes[0], /^FC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  const first = await call("/v1/gift/redeem", { method: "POST", token: player.token, body: { code: codes[0].toLowerCase() } });
  assert.equal(first.status, 200, first.text);
  const account = (first.json as { account: { plan: string; daysLeft: number; email: string } }).account;
  assert.equal(account.plan, "gift");
  assert.equal(account.daysLeft, 66);
  assert.equal(account.email, "giftuser@players.test");
  const again = await call("/v1/gift/redeem", { method: "POST", token: player.token, body: { code: codes[0] } });
  assert.equal(again.status, 409);
  await call("/v1/admin/gifts/revoke", { method: "POST", token: TEST_KEY, body: { code: codes[1] } });
  const revoked = await call("/v1/gift/redeem", { method: "POST", token: player.token, body: { code: codes[1] } });
  assert.equal(revoked.status, 400);
  const extended = await call("/v1/admin/gifts/user", {
    method: "POST",
    token: TEST_KEY,
    body: { userId: player.id, action: "extend", days: 10, expiresDay: null },
  });
  assert.equal(extended.status, 200, extended.text);
  const { addDays } = await import("../src/worker/gifts.ts");
  assert.equal((extended.json as { expiresDay: string }).expiresDay, addDays(addDays(utcDay(), 66), 10));
  await env.DB.prepare("UPDATE gifts SET expires_day = ? WHERE user_id = ?").bind(addDays(utcDay(), -1), player.id).run();
  const free = await call("/v1/me?day=" + utcDay(), { token: player.token });
  assert.equal((free.json as { account: { plan: string } }).account.plan, "free");
  const expiredCode = await call("/v1/admin/gifts/codes", {
    method: "POST",
    token: TEST_KEY,
    body: { count: 1, label: "", redeemDays: 30, giftDays: 10 },
  });
  const late = (expiredCode.json as { codes: string[] }).codes[0];
  await env.DB.prepare("UPDATE gift_codes SET redeem_by = ? WHERE code = ?").bind(addDays(utcDay(), -1), late).run();
  const refused = await call("/v1/gift/redeem", { method: "POST", token: player.token, body: { code: late } });
  assert.equal(refused.status, 400);
  env.AUTO_REVOKE_INACTIVE_DAYS = "3";
  await call("/v1/admin/gifts/user", {
    method: "POST",
    token: TEST_KEY,
    body: { userId: player.id, action: "grant", days: 66, expiresDay: null },
  });
  await env.DB.prepare("UPDATE users SET last_active_day = ? WHERE id = ?").bind(addDays(utcDay(), -10), player.id).run();
  const ended = await call("/v1/me?day=" + utcDay(), { token: player.token });
  assert.equal((ended.json as { account: { plan: string } }).account.plan, "free");
  env.AUTO_REVOKE_INACTIVE_DAYS = "0";
  const limited = await session("giftlimit");
  env.GIFT_REDEEM_LIMIT = "2";
  try {
    const bad1 = await call("/v1/gift/redeem", { method: "POST", token: limited.token, headers: { "CF-Connecting-IP": "203.0.113.77" }, body: { code: "FC-AAAA-AAAA" } });
    const bad2 = await call("/v1/gift/redeem", { method: "POST", token: limited.token, headers: { "CF-Connecting-IP": "203.0.113.77" }, body: { code: "FC-AAAA-AAAB" } });
    const bad3 = await call("/v1/gift/redeem", { method: "POST", token: limited.token, headers: { "CF-Connecting-IP": "203.0.113.77" }, body: { code: "FC-AAAA-AAAC" } });
    assert.equal(bad1.status, 400, bad1.text);
    assert.equal(bad2.status, 400, bad2.text);
    assert.equal(bad3.status, 429, bad3.text);
  } finally {
    env.GIFT_REDEEM_LIMIT = "8";
    env.AUTO_REVOKE_INACTIVE_DAYS = "0";
  }
  const lookup = await call("/v1/session", {
    method: "POST",
    body: { idToken: google.idToken("supportlookup", { email: "support-lookup@example.com", name: "Support Person" }), day: utcDay() },
  });
  assert.equal(lookup.status, 200, lookup.text);
  const found = await call("/v1/admin/support?q=" + encodeURIComponent("support-lookup@example.com"), { token: TEST_KEY });
  assert.equal(found.status, 200, found.text);
  const people = (found.json as { people: { email: string; name: string }[] }).people;
  assert.equal(people.some((person) => person.email === "support-lookup@example.com" && person.name === "Support Person"), true);
  assert.equal(JSON.stringify(found.json).includes("chicken rice"), false);
});

