import { GameError } from "./errors.ts";

export interface CheckoutRequest {
  orderId: string;
  amountCents: number;
  title: string;
  name: string;
  phone: string;
  returnUrl: string;
}

export interface CheckoutResult {
  url: string;
  ref: string;
  sandbox: true;
}

export interface PaymentEnv {
  STORE_SANDBOX?: string;
  BILLPLZ_API_KEY?: string;
  BILLPLZ_COLLECTION_ID?: string;
  TOYYIBPAY_SECRET?: string;
  TOYYIBPAY_CATEGORY?: string;
  STRIPE_SECRET?: string;
}

export function assertSandboxOnly(env: PaymentEnv): void {
  if (String(env.STORE_SANDBOX || "true").trim() === "false") {
    throw new GameError(403, "Live payments are not enabled. Keep STORE_SANDBOX true.");
  }
  const stripe = env.STRIPE_SECRET || "";
  if (stripe.startsWith("sk_live_")) throw new GameError(403, "A live Stripe key cannot be used.");
}

export async function startSandboxPayment(
  gateway: "billplz" | "toyyibpay" | "stripe" | "",
  order: CheckoutRequest,
  env: PaymentEnv,
  sandboxToken: string,
): Promise<CheckoutResult> {
  assertSandboxOnly(env);
  if (gateway === "billplz" && env.BILLPLZ_API_KEY && env.BILLPLZ_COLLECTION_ID) {
    return billplz(order, env);
  }
  if (gateway === "toyyibpay" && env.TOYYIBPAY_SECRET && env.TOYYIBPAY_CATEGORY) {
    return toyyib(order, env);
  }
  if (gateway === "stripe" && env.STRIPE_SECRET) {
    return stripe(order, env);
  }
  const url = new URL(order.returnUrl);
  url.searchParams.set("order", order.orderId);
  url.searchParams.set("proof", sandboxToken);
  return { url: url.toString(), ref: `sandbox:${sandboxToken}`, sandbox: true };
}

async function billplz(order: CheckoutRequest, env: PaymentEnv): Promise<CheckoutResult> {
  const body = new URLSearchParams({
    collection_id: env.BILLPLZ_COLLECTION_ID || "",
    description: order.title.slice(0, 80),
    name: order.name.slice(0, 80),
    amount: String(order.amountCents),
    phone: order.phone,
    redirect_url: order.returnUrl,
    callback_url: order.returnUrl,
  });
  const res = await fetch("https://www.billplz-sandbox.com/api/v3/bills", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.BILLPLZ_API_KEY}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GameError(502, "Billplz sandbox did not start. No charge was made.");
  const data = await res.json() as { id?: string; url?: string };
  if (!data.url || !data.id) throw new GameError(502, "Billplz sandbox did not start. No charge was made.");
  return { url: data.url, ref: data.id, sandbox: true };
}

async function toyyib(order: CheckoutRequest, env: PaymentEnv): Promise<CheckoutResult> {
  const body = new URLSearchParams({
    userSecretKey: env.TOYYIBPAY_SECRET || "",
    categoryCode: env.TOYYIBPAY_CATEGORY || "",
    billName: order.title.slice(0, 30),
    billDescription: "Fit order",
    billPriceSetting: "1",
    billPayorInfo: "1",
    billAmount: String(order.amountCents),
    billReturnUrl: order.returnUrl,
    billCallbackUrl: order.returnUrl,
    billExternalReferenceNo: order.orderId,
    billTo: order.name.slice(0, 80),
    billEmail: "order@example.com",
    billPhone: order.phone.replace(/\D/g, "").slice(0, 15),
  });
  const res = await fetch("https://dev.toyyibpay.com/index.php/api/createBill", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GameError(502, "ToyyibPay sandbox did not start. No charge was made.");
  const data = await res.json() as { BillCode?: string }[];
  const code = data?.[0]?.BillCode;
  if (!code) throw new GameError(502, "ToyyibPay sandbox did not start. No charge was made.");
  return { url: `https://dev.toyyibpay.com/${code}`, ref: code, sandbox: true };
}

async function stripe(order: CheckoutRequest, env: PaymentEnv): Promise<CheckoutResult> {
  const secret = env.STRIPE_SECRET || "";
  if (!secret.startsWith("sk_test_")) throw new GameError(403, "Stripe must use a test key.");
  const body = new URLSearchParams({
    mode: "payment",
    success_url: order.returnUrl,
    cancel_url: order.returnUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "myr",
    "line_items[0][price_data][unit_amount]": String(order.amountCents),
    "line_items[0][price_data][product_data][name]": order.title.slice(0, 80),
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GameError(502, "Stripe test mode did not start. No charge was made.");
  const data = await res.json() as { id?: string; url?: string };
  if (!data.url || !data.id) throw new GameError(502, "Stripe test mode did not start. No charge was made.");
  return { url: data.url, ref: data.id, sandbox: true };
}
