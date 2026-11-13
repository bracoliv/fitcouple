import { GameError } from "./errors.ts";

export interface StoreProduct {
  id: string;
  brand: string;
  name: string;
  blurb: string;
  priceCents: number;
  shopeeUrl: string;
  suggest: "" | "after_workout";
  active: boolean;
}

export interface StoreConfig {
  enabled: boolean;
  mode: "external" | "checkout";
  gateway: "billplz" | "toyyibpay" | "stripe" | "";
  sandbox: boolean;
  currency: string;
}

export const STORE_OFF: StoreConfig = {
  enabled: false,
  mode: "external",
  gateway: "",
  sandbox: true,
  currency: "RM",
};

const CLAIM = /cure|treat|heal|disease|clinically proven|boost testosterone|burns?\s+fat|lose weight|weight loss|medical/i;

export function hasHealthClaim(text: string): boolean {
  return CLAIM.test(text);
}

export function cleanProductText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new GameError(400, `${label} is missing.`);
  const text = value.trim();
  if (!text || text.length > max) throw new GameError(400, `${label} is missing.`);
  if (hasHealthClaim(text)) throw new GameError(400, "Product text cannot make a health claim.");
  if (text.includes("@") || /https?:\/\//i.test(text)) throw new GameError(400, `${label} cannot include a link or email.`);
  return text;
}

export function cleanShopeeUrl(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new GameError(400, "Shopee link is not valid.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GameError(400, "Shopee link is not valid."); }
  if (url.protocol !== "https:" || !/(^|\.)shopee\.com(\.my)?$/.test(url.hostname)) {
    throw new GameError(400, "Use an https Shopee link.");
  }
  return url.toString();
}

export function readStoreConfig(env: {
  STORE_ENABLED?: string;
  STORE_MODE?: string;
  STORE_GATEWAY?: string;
  STORE_SANDBOX?: string;
  STORE_CURRENCY?: string;
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
  };
}

export function cleanOrder(body: unknown): { name: string; phone: string; address: string; items: { id: string; qty: number }[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GameError(400, "Send a JSON object.");
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["name", "phone", "address", "items"].includes(key)) throw new GameError(400, "Unexpected field.");
  }
  const name = cleanProductText(record.name, "Name", 80);
  if (typeof record.phone !== "string" || !/^[0-9+\-\s]{8,20}$/.test(record.phone.trim())) {
    throw new GameError(400, "Enter a phone number for delivery.");
  }
  if (typeof record.address !== "string" || record.address.trim().length < 8 || record.address.trim().length > 200) {
    throw new GameError(400, "Enter a delivery address.");
  }
  if (hasHealthClaim(record.address) || /https?:\/\//i.test(record.address)) {
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
  return { name, phone: record.phone.trim(), address: record.address.trim(), items };
}

export function parseCatalog(raw: string | undefined): StoreProduct[] {
  if (!raw || !raw.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new GameError(500, "Store catalog config is not valid."); }
  if (!Array.isArray(data)) throw new GameError(500, "Store catalog config is not valid.");
  return data.slice(0, 40).map((item) => productFrom(item));
}

export function productFrom(item: unknown, idOverride?: string): StoreProduct {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new GameError(400, "Product is not valid.");
  const row = item as Record<string, unknown>;
  const id = (idOverride || String(row.id || "")).trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  if (!id) throw new GameError(400, "Product id is missing.");
  const brand = String(row.brand || "").trim().toLowerCase() === "sosm" ? "sosm" : "other";
  const price = Number(row.priceCents ?? row.price_cents);
  if (!Number.isInteger(price) || price < 100 || price > 1000000) throw new GameError(400, "Price must be a whole number of sen.");
  const suggest = row.suggest === "after_workout" ? "after_workout" : "";
  return {
    id,
    brand,
    name: cleanProductText(row.name, "Name", 80),
    blurb: cleanProductText(row.blurb, "Description", 180),
    priceCents: price,
    shopeeUrl: cleanShopeeUrl(row.shopeeUrl ?? row.shopee_url),
    suggest,
    active: row.active !== false && row.active !== 0,
  };
}
