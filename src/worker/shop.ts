import { randomHex } from "./crypto.ts";
import type { Db } from "./data.ts";
import { GameError } from "./errors.ts";
import { startSandboxPayment, type PaymentEnv } from "./payments.ts";
import { parseCatalog, productFrom, type StoreConfig, type StoreProduct } from "./store.ts";

interface ProductRow {
  id: string;
  brand: string;
  name: string;
  why: string;
  evidence: string;
  dose: string;
  testing: string;
  halal: string;
  mal: string;
  audience: string;
  price_cents: number;
  list_price_cents: number;
  shopee_url: string;
  active: number;
}

function mapProduct(row: ProductRow): StoreProduct {
  const halal = row.halal === "yes" || row.halal === "no" ? row.halal : "not-stated";
  return {
    id: row.id,
    brand: row.brand === "sosm" ? "sosm" : "other",
    name: row.name,
    why: row.why,
    evidence: row.evidence,
    dose: row.dose,
    testing: row.testing,
    halal,
    mal: row.mal,
    audience: row.audience === "adult" ? "adult" : "all",
    priceCents: row.price_cents,
    listPriceCents: row.list_price_cents,
    shopeeUrl: row.shopee_url,
    active: row.active === 1,
  };
}

export async function listProducts(db: Db, catalogJson: string | undefined): Promise<StoreProduct[]> {
  const rows = await db.prepare(
    `SELECT id, brand, name, why, evidence, dose, testing, halal, mal, audience,
            price_cents, list_price_cents, shopee_url, active
     FROM products ORDER BY name ASC`,
  ).all<ProductRow>();
  const stored = (rows.results || []).map(mapProduct);
  if (stored.length) return stored;
  return parseCatalog(catalogJson);
}

export async function saveProduct(db: Db, input: unknown): Promise<void> {
  const product = productFrom(input);
  await db.prepare(
    `INSERT INTO products (
       id, brand, name, why, evidence, dose, testing, halal, mal, audience,
       price_cents, list_price_cents, shopee_url, active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       brand = excluded.brand, name = excluded.name, why = excluded.why,
       evidence = excluded.evidence, dose = excluded.dose, testing = excluded.testing,
       halal = excluded.halal, mal = excluded.mal, audience = excluded.audience,
       price_cents = excluded.price_cents, list_price_cents = excluded.list_price_cents,
       shopee_url = excluded.shopee_url, active = excluded.active`,
  ).bind(
    product.id, product.brand, product.name, product.why, product.evidence, product.dose,
    product.testing, product.halal, product.mal, product.audience, product.priceCents,
    product.listPriceCents, product.shopeeUrl, product.active ? 1 : 0,
  ).run();
}

export async function publicStore(db: Db, config: StoreConfig, catalogJson: string | undefined, ageConfirmed: boolean) {
  const products = (await listProducts(db, catalogJson)).filter((item) => item.active);
  const adultCount = products.filter((item) => item.audience === "adult").length;
  return {
    enabled: true,
    mode: config.mode,
    currency: config.currency,
    seller: config.seller,
    recommended: products.filter((item) => item.audience !== "adult"),
    adult: ageConfirmed ? products.filter((item) => item.audience === "adult") : [],
    adultLocked: adultCount > 0 && !ageConfirmed,
    pages: {
      terms: "shop-terms.html",
      refund: "shop-refund.html",
      privacy: "shop-privacy.html",
    },
    notice: "Physical goods at or above the supplier list price. No promo codes, points, or bundles. Not an in-app purchase.",
    privacy: "Your name, phone, and address are kept only to deliver an order. They are not mixed with your food or workout log, and they are not used to pick products.",
  };
}

export async function placeOrder(
  db: Db,
  userId: string,
  day: string,
  config: StoreConfig,
  input: { name: string; phone: string; address: string; items: { id: string; qty: number }[]; consent: boolean; ageConfirm: boolean },
  catalogJson: string | undefined,
  env: PaymentEnv,
  sandboxPage: string,
) {
  if (config.mode !== "checkout") throw new GameError(400, "This shop sends you to Shopee. There is no in-app payment.");
  if (!config.gateway) throw new GameError(400, "Set STORE_GATEWAY to billplz, toyyibpay, or stripe.");
  if (!config.seller.name) throw new GameError(400, "Add the seller name before taking payment.");
  if (!input.consent) throw new GameError(400, "Tick the box to agree to the delivery privacy note.");
  const catalog = (await listProducts(db, catalogJson)).filter((item) => item.active);
  const lines = input.items.map((item) => {
    const product = catalog.find((row) => row.id === item.id);
    if (!product) throw new GameError(400, "That product is not in the shop.");
    if (product.priceCents < product.listPriceCents) throw new GameError(400, "Price cannot be below the supplier list price.");
    if (product.audience === "adult" && !input.ageConfirm) throw new GameError(400, "Confirm you are 18 or older for that product.");
    return { id: product.id, name: product.name, qty: item.qty, priceCents: product.priceCents };
  });
  const total = lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  const id = randomHex(8);
  const token = randomHex(16);
  await db.prepare(
    `INSERT INTO orders (id, user_id, name, phone, address, items, total_cents, status, gateway, provider_ref, created_day, consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1)`,
  ).bind(id, userId, input.name, input.phone, input.address, JSON.stringify(lines), total, config.gateway, `sandbox:${token}`, day).run();
  const payment = await startSandboxPayment(config.gateway, {
    orderId: id,
    amountCents: total,
    title: "Fit order",
    name: input.name,
    phone: input.phone,
    returnUrl: sandboxPage,
  }, env, token);
  if (!payment.ref.startsWith("sandbox:")) {
    await db.prepare("UPDATE orders SET provider_ref = ? WHERE id = ?").bind(payment.ref, id).run();
  }
  return { orderId: id, url: payment.url, sandbox: true as const, totalCents: total };
}

export async function completeSandboxOrder(db: Db, orderId: string, token: string) {
  const row = await db.prepare(
    "SELECT status, provider_ref FROM orders WHERE id = ?",
  ).bind(orderId).first<{ status: string; provider_ref: string | null }>();
  if (!row || row.provider_ref !== `sandbox:${token}`) throw new GameError(404, "That sandbox payment was not found.");
  if (row.status === "paid") return { ok: true, status: "paid" };
  await db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'").bind(orderId).run();
  return { ok: true, status: "paid" };
}

export async function playerOrders(db: Db, userId: string) {
  const rows = await db.prepare(
    "SELECT id, status, total_cents, created_day FROM orders WHERE user_id = ? ORDER BY created_day DESC LIMIT 20",
  ).bind(userId).all<{ id: string; status: string; total_cents: number; created_day: string }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    status: row.status,
    totalCents: row.total_cents,
    day: row.created_day,
  }));
}

export async function adminOrders(db: Db) {
  const rows = await db.prepare(
    "SELECT id, name, phone, address, items, total_cents, status, created_day FROM orders ORDER BY created_day DESC LIMIT 50",
  ).all<{ id: string; name: string; phone: string; address: string; items: string; total_cents: number; status: string; created_day: string }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    items: row.items,
    totalCents: row.total_cents,
    status: row.status,
    day: row.created_day,
  }));
}

export async function deleteOrder(db: Db, orderId: string) {
  await db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId).run();
  return { ok: true };
}
