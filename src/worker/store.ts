import { GameError } from "./errors.ts";

export interface StoreProduct {
  id: string;
  store: "pump" | "slim";
  kind: string;
  brand: string;
  name: string;
  why: string;
  evidence: string;
  dose: string;
  testing: string;
  halal: "yes" | "no" | "not-stated";
  mal: string;
  audience: "all" | "adult";
  priceCents: number;
  listPriceCents: number;
  linkUrl: string;
  active: boolean;
}

export interface StoreSeller {
  name: string;
  line: string;
  contact: string;
}

export interface StoreConfig {
  enabled: boolean;
  mode: "external" | "checkout";
  gateway: "billplz" | "toyyibpay" | "stripe" | "";
  sandbox: boolean;
  currency: string;
  seller: StoreSeller;
}

export const STORE_OFF: StoreConfig = {
  enabled: false,
  mode: "external",
  gateway: "",
  sandbox: true,
  currency: "RM",
  seller: { name: "", line: "", contact: "" },
};

const BLOCKED = /cure|treat|heal|disease|clinically proven|boost testosterone|burns?\s+fat|fat[\s-]*burn|lose weight|weight loss|quick weight|blood pressure|medical|miracle|guaranteed|shred|get ripped|discount|promo|coupon|voucher|\bbundle\b|points|%\s*off|limited offer|buy one|app-only|exclusive deal/i;

const PUMP_EXCLUDED = /fat[\s-]*burn|slimming|mateburn|night booster|thermogenic|appetite suppress/i;

export const PUMP_KINDS = ["whey", "creatine", "vitamin-d3", "omega-3", "magnesium"] as const;

export const SLIM_AD_LINE = "This should be taken with a balanced diet and regular exercise";

export const PUMP_DISCLOSURE = "Some Pump Up links are affiliate links to the official store. Fit may earn a fee if you buy. The price is that store's price.";

export function hasBlockedProductCopy(text: string): boolean {
  return BLOCKED.test(text);
}

export function hasHealthClaim(text: string): boolean {
  return hasBlockedProductCopy(text);
}

export function cleanProductText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new GameError(400, `${label} is missing.`);
  const text = value.trim();
  if (!text || text.length > max) throw new GameError(400, `${label} is missing.`);
  if (hasBlockedProductCopy(text)) throw new GameError(400, "Product text cannot make a health claim or a sales pitch.");
  if (text.includes("@") || /https?:\/\//i.test(text)) throw new GameError(400, `${label} cannot include a link or email.`);
  return text;
}

export function cleanStoreLink(store: "pump" | "slim", value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new GameError(400, "A store link is required.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GameError(400, "Store link is not valid."); }
  if (url.protocol !== "https:") throw new GameError(400, "Store link must be https.");
  const host = url.hostname.toLowerCase();
  const shopee = /(^|\.)shopee\.com(\.my)?$/.test(host);
  if (store === "pump") {
    const myprotein = /(^|\.)myprotein\.(com(\.my)?|my)$/.test(host);
    const lazada = /(^|\.)lazada\.com\.my$/.test(host);
    const mall = shopee && /(^|\/)mall(\/|$)/i.test(url.pathname);
    if (!myprotein && !lazada && !mall) {
      throw new GameError(400, "Pump Up links must be Myprotein, Lazada, or a Shopee Mall link.");
    }
  } else {
    const whatsapp = host === "wa.me" || /(^|\.)whatsapp\.com$/.test(host);
    if (!shopee && !whatsapp) throw new GameError(400, "Slimming links must be Shopee or WhatsApp.");
  }
  return url.toString();
}

export function cleanShopeeUrl(value: unknown): string {
  return cleanStoreLink("slim", value);
}

function sellerText(value: string | undefined, max: number): string {
  return String(value || "").replace(/https?:\/\/\S+/gi, "").replace(/@/g, "").trim().slice(0, max);
}

export function readStoreConfig(env: {
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
}): StoreConfig {
  const enabled = String(env.STORE_ENABLED || "").trim() === "true";
  const mode = String(env.STORE_MODE || "external").trim() === "checkout" ? "checkout" : "external";
  const gatewayRaw = String(env.STORE_GATEWAY || "").trim().toLowerCase();
  const gateway = gatewayRaw === "billplz" || gatewayRaw === "toyyibpay" || gatewayRaw === "stripe" ? gatewayRaw : "";
  const currency = String(env.STORE_CURRENCY || "RM").replace(/[^A-Za-z]/g, "").slice(0, 6) || "RM";
  return {
    enabled,
    mode,
    gateway,
    sandbox: String(env.STORE_SANDBOX || "true").trim() !== "false",
    currency,
    seller: {
      name: sellerText(env.STORE_SELLER_NAME, 80),
      line: sellerText(env.STORE_SELLER_LINE, 160),
      contact: sellerText(env.STORE_SELLER_CONTACT, 40),
    },
  };
}

export function cleanOrder(body: unknown): {
  name: string;
  phone: string;
  address: string;
  items: { id: string; qty: number }[];
  consent: boolean;
  ageConfirm: boolean;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameError(400, "Send a JSON object.");
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["name", "phone", "address", "items", "consent", "ageConfirm"].includes(key)) {
      throw new GameError(400, "Unexpected field.");
    }
  }
  if (record.consent !== true) throw new GameError(400, "Tick the box to agree to the delivery privacy note.");
  const name = cleanProductText(record.name, "Name", 80);
  if (typeof record.phone !== "string" || !/^[0-9+\-\s]{8,20}$/.test(record.phone.trim())) {
    throw new GameError(400, "Enter a phone number for delivery.");
  }
  if (typeof record.address !== "string" || record.address.trim().length < 8 || record.address.trim().length > 200) {
    throw new GameError(400, "Enter a delivery address.");
  }
  if (hasBlockedProductCopy(record.address) || /https?:\/\//i.test(record.address)) {
    throw new GameError(400, "Enter a delivery address.");
  }
  if (!Array.isArray(record.items) || !record.items.length || record.items.length > 8) {
    throw new GameError(400, "Choose at least one product.");
  }
  const items = record.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new GameError(400, "That product is not valid.");
    const row = item as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (key !== "id" && key !== "qty") throw new GameError(400, "Unexpected field.");
    }
    const id = String(row.id || "").trim().toLowerCase();
    const qty = Number(row.qty);
    if (!/^[a-z0-9-]{1,32}$/.test(id) || !Number.isInteger(qty) || qty < 1 || qty > 10) {
      throw new GameError(400, "That product is not valid.");
    }
    return { id, qty };
  });
  return {
    name,
    phone: record.phone.trim(),
    address: record.address.trim(),
    items,
    consent: true,
    ageConfirm: record.ageConfirm === true,
  };
}

const PRODUCT_KEYS = new Set([
  "id", "store", "kind", "brand", "name", "why", "evidence", "dose", "testing", "halal", "mal", "audience",
  "priceCents", "price_cents", "listPriceCents", "list_price_cents", "linkUrl", "link_url", "shopeeUrl", "shopee_url", "active",
]);

export function parseCatalog(raw: string | undefined, store: "pump" | "slim"): StoreProduct[] {
  if (!raw || !raw.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new GameError(500, "Store catalog config is not valid."); }
  if (!Array.isArray(data)) throw new GameError(500, "Store catalog config is not valid.");
  return data.slice(0, 40).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new GameError(500, "Store catalog config is not valid.");
    const row = { ...(item as Record<string, unknown>) };
    const named = String(row.store || store).trim().toLowerCase();
    if (named !== store) throw new GameError(500, "A catalog config mixes the two stores.");
    row.store = store;
    return productFrom(row);
  });
}

export function productFrom(item: unknown): StoreProduct {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new GameError(400, "Product is not valid.");
  const row = item as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!PRODUCT_KEYS.has(key)) throw new GameError(400, "Unexpected field.");
  }
  const id = String(row.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  if (!id) throw new GameError(400, "Product id is missing.");
  const price = Number(row.priceCents ?? row.price_cents);
  const listPrice = Number(row.listPriceCents ?? row.list_price_cents);
  if (!Number.isInteger(price) || price < 100 || price > 1000000) throw new GameError(400, "Price must be a whole number of sen.");
  if (!Number.isInteger(listPrice) || listPrice < 100 || listPrice > 1000000) {
    throw new GameError(400, "Supplier list price must be a whole number of sen.");
  }
  if (price < listPrice) throw new GameError(400, "Price cannot be below the supplier list price.");
  const halalRaw = String(row.halal || "").trim().toLowerCase();
  if (halalRaw !== "yes" && halalRaw !== "no" && halalRaw !== "not-stated") {
    throw new GameError(400, "Halal must be yes, no, or not-stated.");
  }
  const mal = cleanProductText(row.mal, "MAL", 40);
  const store = String(row.store || "").trim().toLowerCase();
  if (store !== "pump" && store !== "slim") throw new GameError(400, "Store must be pump or slim.");
  const name = cleanProductText(row.name, "Name", 80);
  const why = cleanProductText(row.why, "Why it is listed", 200);
  const evidence = cleanProductText(row.evidence, "Evidence", 200);
  const dose = cleanProductText(row.dose, "Dose", 120);
  const testing = cleanProductText(row.testing, "Third-party testing", 160);
  const copy = `${name} ${why} ${evidence} ${dose} ${testing}`;
  const link = cleanStoreLink(store, row.linkUrl ?? row.link_url ?? row.shopeeUrl ?? row.shopee_url);
  if (store === "pump") {
    if (String(row.brand || "").trim().toLowerCase() === "sosm") {
      throw new GameError(400, "SOSM+ products belong in the Slimming store.");
    }
    const kind = String(row.kind || "").trim().toLowerCase();
    if (!PUMP_KINDS.includes(kind as typeof PUMP_KINDS[number])) {
      throw new GameError(400, "Pump Up only lists whey, creatine, vitamin D3, omega-3, or magnesium.");
    }
    if (PUMP_EXCLUDED.test(copy)) throw new GameError(400, "Fat burners and slimming products cannot be listed in Pump Up.");
    return {
      id, brand: "other", store, kind, name, why, evidence, dose, testing,
      halal: halalRaw, mal, audience: "all", priceCents: price, listPriceCents: listPrice, linkUrl: link,
      active: row.active !== false && row.active !== 0,
    };
  }
  if (String(row.brand || "").trim().toLowerCase() !== "sosm") {
    throw new GameError(400, "The Slimming store is only the owner's SOSM+ products.");
  }
  return {
    id, brand: "sosm", store, kind: "sosm", name, why, evidence, dose, testing,
    halal: halalRaw, mal, audience: "adult", priceCents: price, listPriceCents: listPrice, linkUrl: link,
    active: row.active !== false && row.active !== 0,
  };
}
