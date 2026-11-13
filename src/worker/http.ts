import { assertNearToday, isDay, isDifficulty, type QuestEvent } from "./brain.ts";
import { secretsMatch } from "./crypto.ts";
import {
  adminCustomers,
  confirmTeam,
  redeemVoucher,
  createSession,
  createTeam,
  ensureSchema,
  joinTeam,
  recordEvents,
  setDisplayName,
  setProgramChoice,
  startDuel,
  stateFor,
  userFromToken,
  weeklyCoach,
  type Db,
} from "./data.ts";
import { GameError } from "./errors.ts";
import { assertKeys, assertNoPrivateFields } from "./privacy.ts";
import { readVoucherConfig } from "./vouchers.ts";
import { cleanOrder, readStoreConfig } from "./store.ts";
import { adminOrders, completeSandboxOrder, deleteOrder, listProducts, placeOrder, playerOrders, publicStore, saveProduct } from "./shop.ts";

export interface AppEnv {
  DB: Db;
  ALLOWED_ORIGINS: string;
  ADMIN_KEY?: string;
  STAFF_KEY?: string;
  VOUCHERS_ENABLED?: string;
  VOUCHER_MILESTONES?: string;
  VOUCHER_EXPIRY_DAYS?: string;
  VOUCHER_VALUE_LABEL?: string;
  VOUCHER_VERIFIED_DAYS?: string;
  VOUCHER_PREFIX?: string;
  STORE_ENABLED?: string;
  STORE_MODE?: string;
  STORE_GATEWAY?: string;
  STORE_SANDBOX?: string;
  STORE_CURRENCY?: string;
  STORE_PUMP_CATALOG?: string;
  STORE_SLIM_CATALOG?: string;
  STORE_SELLER_NAME?: string;
  STORE_SELLER_LINE?: string;
  STORE_SELLER_CONTACT?: string;
  BILLPLZ_API_KEY?: string;
  BILLPLZ_COLLECTION_ID?: string;
  TOYYIBPAY_SECRET?: string;
  TOYYIBPAY_CATEGORY?: string;
  STRIPE_SECRET?: string;
}

function allowedOrigin(env: AppEnv, origin: string): boolean {
  return (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean).includes(origin);
}

function responseHeaders(request: Request, env: AppEnv): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigin(env, origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Ai-Key, X-Ai-Host, X-Age-Confirm");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}

function json(request: Request, env: AppEnv, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request, env) });
}

async function presentPlayer(request: Request, env: AppEnv, status: number, body: unknown): Promise<Response> {
  return json(request, env, status, body);
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2000) throw new GameError(413, "Request is too large.");
  if (!text) throw new GameError(400, "Send JSON.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GameError(400, "Send JSON.");
  }
}

function dayFrom(value: unknown, now: Date): string {
  if (typeof value !== "string" || !isDay(value)) throw new GameError(400, "Send the day as YYYY-MM-DD.");
  assertNearToday(value, now);
  return value;
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) throw new GameError(401, "Sign in to the game again on this device.");
  return match[1];
}

async function assertStaff(request: Request, env: AppEnv): Promise<void> {
  const key = env.STAFF_KEY || "";
  if (key.length < 16) throw new GameError(503, "The staff key is not set on the server yet.");
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const provided = match ? match[1] : "";
  const ok = await secretsMatch(provided, key);
  if (!ok) throw new GameError(401, "That staff key is not right.");
}

async function assertAdmin(request: Request, env: AppEnv): Promise<void> {
  const key = env.ADMIN_KEY || "";
  if (key.length < 16) throw new GameError(503, "The owner key is not set on the server yet.");
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const provided = match ? match[1] : "";
  const ok = await secretsMatch(provided, key);
  if (!ok) throw new GameError(401, "That owner key is not right.");
}

export async function handle(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  try {
    if (origin && !allowedOrigin(env, origin)) {
      return json(request, env, 403, { error: "This website is not allowed to call the game server." });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }
    await ensureSchema(env.DB);
    const now = new Date();
    const offer = readVoucherConfig(env);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(request, env, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/v1/session") {
      const body = assertKeys(await readJson(request), ["anonId", "day"]);
      const day = body.day == null ? now.toISOString().slice(0, 10) : dayFrom(body.day, now);
      const created = await createSession(env.DB, String(body.anonId || ""), day, offer);
      return presentPlayer(request, env, 200, created);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/customers") {
      await assertAdmin(request, env);
      const day = url.searchParams.get("day") || now.toISOString().slice(0, 10);
      return json(request, env, 200, await adminCustomers(env.DB, dayFrom(day, now), offer));
    }
    if (url.pathname === "/v1/me" && request.method === "GET") {
      const user = await userFromToken(env.DB, bearer(request));
      const day = url.searchParams.get("day") || now.toISOString().slice(0, 10);
      return presentPlayer(request, env, 200, await stateFor(env.DB, user.id, dayFrom(day, now), offer));
    }
    if (url.pathname === "/v1/team" && request.method === "GET") {
      const user = await userFromToken(env.DB, bearer(request));
      const day = url.searchParams.get("day") || now.toISOString().slice(0, 10);
      return presentPlayer(request, env, 200, await stateFor(env.DB, user.id, dayFrom(day, now), offer));
    }
    if (request.method === "POST" && url.pathname === "/v1/events") {
      const user = await userFromToken(env.DB, bearer(request));
      const body = assertKeys(await readJson(request), ["day", "difficulty", "events"]);
      const day = dayFrom(body.day, now);
      if (body.difficulty != null && !isDifficulty(body.difficulty)) throw new GameError(400, "Difficulty must be easy, normal, or hard.");
      const events = parseEvents(body.events);
      const state = await recordEvents(env.DB, user, events, day, isDifficulty(body.difficulty) ? body.difficulty : undefined, offer);
      return presentPlayer(request, env, 200, state);
    }
    if (request.method === "POST" && url.pathname === "/v1/profile") {
      const user = await userFromToken(env.DB, bearer(request));
      const body = assertKeys(await readJson(request), ["displayName", "day", "programChoice"]);
      const day = dayFrom(body.day, now);
      let state = null;
      if ("displayName" in body) state = await setDisplayName(env.DB, user, body.displayName, day, offer);
      if ("programChoice" in body) state = await setProgramChoice(env.DB, user, body.programChoice, day, offer);
      if (!state) throw new GameError(400, "Nothing to update.");
      return presentPlayer(request, env, 200, state);
    }
    if (request.method === "POST" && url.pathname === "/v1/team") {
      const user = await userFromToken(env.DB, bearer(request));
      const body = assertKeys(await readJson(request), ["action", "code", "day", "opponentId"]);
      const day = dayFrom(body.day, now);
      if (body.action === "create") return presentPlayer(request, env, 200, await createTeam(env.DB, user, day, offer));
      if (body.action === "join") return presentPlayer(request, env, 200, await joinTeam(env.DB, user, body.code, day, offer));
      if (body.action === "confirm") return presentPlayer(request, env, 200, await confirmTeam(env.DB, user, day, offer));
      if (body.action === "duel") {
        const opponentId = typeof body.opponentId === "string" ? body.opponentId : undefined;
        return presentPlayer(request, env, 200, await startDuel(env.DB, user, day, opponentId, offer));
      }
      throw new GameError(400, "Team action must be create, join, confirm, or duel.");
    }
    if (request.method === "POST" && url.pathname === "/v1/coach") {
      const user = await userFromToken(env.DB, bearer(request));
      const body = assertKeys(await readJson(request), ["day"]);
      const key = request.headers.get("X-Ai-Key") || "";
      const host = request.headers.get("X-Ai-Host") || "api.openai.com";
      return presentPlayer(request, env, 200, await weeklyCoach(env.DB, user, dayFrom(body.day, now), key, host, offer));
    }
    if (request.method === "POST" && url.pathname === "/v1/vouchers/redeem") {
      if (!offer.enabled) return json(request, env, 404, { error: "Not found." });
      await assertStaff(request, env);
      const body = assertKeys(await readJson(request), ["code"]);
      if (typeof body.code !== "string" || body.code.length < 8 || body.code.length > 40) {
        throw new GameError(400, "Enter the voucher code.");
      }
      return json(request, env, 200, await redeemVoucher(env.DB, body.code, now.toISOString().slice(0, 10)));
    }
    if (url.pathname === "/v1/admin/products" && (request.method === "GET" || request.method === "POST")) {
      await assertAdmin(request, env);
      if (request.method === "POST") {
        await saveProduct(env.DB, await readProduct(request));
      }
      const shop = readStoreConfig(env);
      const lists = await listProducts(env.DB, env.STORE_PUMP_CATALOG, env.STORE_SLIM_CATALOG);
      return json(request, env, 200, {
        enabled: shop.enabled,
        mode: shop.mode,
        pump: lists.pump,
        slim: lists.slim,
        products: [...lists.pump, ...lists.slim],
        orders: shop.enabled ? await adminOrders(env.DB) : [],
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/admin/orders/delete") {
      await assertAdmin(request, env);
      const body = assertKeys(await readJson(request), ["orderId"]);
      if (typeof body.orderId !== "string" || !/^[a-f0-9]{8,32}$/i.test(body.orderId)) {
        throw new GameError(400, "Order id is missing.");
      }
      return json(request, env, 200, await deleteOrder(env.DB, body.orderId));
    }
    if (request.method === "GET" && url.pathname === "/v1/store/catalog") {
      const shop = readStoreConfig(env);
      if (!shop.enabled) return json(request, env, 404, { error: "Not found." });
      const user = await userFromToken(env.DB, bearer(request));
      const ageConfirmed = request.headers.get("X-Age-Confirm") === "18";
      return json(request, env, 200, {
        ...(await publicStore(env.DB, shop, env.STORE_PUMP_CATALOG, env.STORE_SLIM_CATALOG, ageConfirmed)),
        orders: await playerOrders(env.DB, user.id),
      });
    }
    if (request.method === "POST" && url.pathname === "/v1/store/checkout") {
      const shop = readStoreConfig(env);
      if (!shop.enabled) return json(request, env, 404, { error: "Not found." });
      const user = await userFromToken(env.DB, bearer(request));
      const body = cleanOrder(await readLoose(request, 200));
      const origin = request.headers.get("Origin") || "http://127.0.0.1:8788";
      const page = `${origin}/pay-sandbox.html`;
      return json(request, env, 200, await placeOrder(env.DB, user.id, now.toISOString().slice(0, 10), shop, body, { pump: env.STORE_PUMP_CATALOG, slim: env.STORE_SLIM_CATALOG }, env, page));
    }
    if (request.method === "POST" && url.pathname === "/v1/store/sandbox-complete") {
      const shop = readStoreConfig(env);
      if (!shop.enabled) return json(request, env, 404, { error: "Not found." });
      const body = assertKeys(await readJson(request), ["orderId", "proof"]);
      if (typeof body.orderId !== "string" || typeof body.proof !== "string") throw new GameError(400, "Payment is missing.");
      return json(request, env, 200, await completeSandboxOrder(env.DB, body.orderId, body.proof));
    }
    return json(request, env, 404, { error: "Not found." });
  } catch (err) {
    const status = err instanceof GameError ? err.status : 500;
    const message = err instanceof GameError ? err.message : "The game server had a problem.";
    if (!(err instanceof GameError)) {
      console.error(JSON.stringify({
        service: "fitcouple-game",
        error: err instanceof Error ? err.message : "unknown",
      }));
    }
    return json(request, env, status, { error: message });
  }
}

async function readProduct(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4000) throw new GameError(413, "Request is too large.");
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new GameError(400, "Send JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameError(400, "Product is not valid.");
  const copy = { ...(body as Record<string, unknown>) };
  const link = copy.linkUrl ?? copy.link_url ?? copy.shopeeUrl ?? copy.shopee_url;
  delete copy.linkUrl;
  delete copy.link_url;
  delete copy.shopeeUrl;
  delete copy.shopee_url;
  for (const value of Object.values(copy)) {
    if (typeof value === "string" && (value.includes("@") || /https?:\/\//i.test(value))) {
      throw new GameError(400, "Links and email addresses are not accepted.");
    }
  }
  if (link != null) copy.linkUrl = link;
  return copy;
}

async function readLoose(request: Request, maxString: number): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4000) throw new GameError(413, "Request is too large.");
  if (!text) throw new GameError(400, "Send JSON.");
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { throw new GameError(400, "Send JSON."); }
  assertNoPrivateFields(body, 0, maxString);
  return body;
}

async function readJson(request: Request): Promise<unknown> {
  const body = await readBody(request);
  assertNoPrivateFields(body);
  return body;
}

function parseEvents(value: unknown): QuestEvent[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new GameError(400, "Events must be a list.");
  return value.map((item) => {
    const event = assertKeys(item, ["questId", "count", "completed", "source", "hasProof", "durationMin"]);
    if (typeof event.questId !== "string") throw new GameError(400, "Quest id is missing.");
    const parsed: QuestEvent = { questId: event.questId, source: "manual" };
    if (event.source != null) {
      if (event.source !== "manual" && event.source !== "timer" && event.source !== "photo" && event.source !== "wearable") {
        throw new GameError(400, "Source must be manual, timer, photo, or wearable.");
      }
      parsed.source = event.source;
    }
    if (event.count != null) {
      if (!Number.isInteger(event.count)) throw new GameError(400, "Count must be a whole number.");
      parsed.count = event.count as number;
    }
    if (event.completed != null) {
      if (typeof event.completed !== "boolean") throw new GameError(400, "Completed must be true or false.");
      parsed.completed = event.completed;
    }
    if (event.hasProof != null) {
      if (typeof event.hasProof !== "boolean") throw new GameError(400, "Proof must be yes or no.");
      parsed.hasProof = event.hasProof;
    }
    if (event.durationMin != null) {
      if (!Number.isInteger(event.durationMin)) throw new GameError(400, "Duration must be a whole number of minutes.");
      parsed.durationMin = event.durationMin as number;
    }
    return parsed;
  });
}
