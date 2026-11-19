import { sha256Hex } from "./crypto.ts";
import { GameError } from "./errors.ts";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

interface GoogleJwk extends JsonWebKey {
  kid?: string;
}

interface Claims {
  sub: string;
  email: string;
  name: string;
}

let cached: { keys: GoogleJwk[]; until: number } | null = null;

export function clearGoogleKeyCache(): void {
  cached = null;
}

function bytesFromBase64Url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonPart(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(value))) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function loadKeys(fetcher: typeof fetch): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (cached && cached.until > now) return cached.keys;
  const res = await fetcher(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new GameError(503, "Google sign-in could not be checked. Try again.");
  const data = await res.json() as { keys?: GoogleJwk[] };
  const keys = (data.keys || []).filter((key) => key && key.kty === "RSA" && typeof key.kid === "string");
  if (!keys.length) throw new GameError(503, "Google sign-in could not be checked. Try again.");
  cached = { keys, until: now + 60 * 60 * 1000 };
  return keys;
}

export async function verifyGoogleIdToken(token: string, clientId: string, fetcher: typeof fetch = fetch): Promise<Claims> {
  const audience = clientId.trim();
  if (!audience.endsWith(".apps.googleusercontent.com") || audience.includes("YOUR_GOOGLE_CLIENT_ID")) {
    throw new GameError(503, "Set GOOGLE_CLIENT_ID on the server to the same web client id as the site.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new GameError(401, "Google sign-in was not valid. Try again.");
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new GameError(401, "Google sign-in was not valid. Try again.");
  }
  const jwk = (await loadKeys(fetcher)).find((key) => key.kid === header.kid);
  if (!jwk) throw new GameError(401, "Google sign-in was not valid. Try again.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytesFromBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new GameError(401, "Google sign-in was not valid. Try again.");
  const iss = payload.iss;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    throw new GameError(401, "Google sign-in was not valid. Try again.");
  }
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(audience)) throw new GameError(401, "Google sign-in was not valid. Try again.");
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() - 60_000) {
    throw new GameError(401, "Google sign-in expired. Try again.");
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sub)) throw new GameError(401, "Google sign-in was not valid. Try again.");
  if (payload.email_verified !== true) throw new GameError(401, "Google did not confirm this email. Try again.");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw new GameError(401, "Google did not confirm this email. Try again.");
  }
  const name = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  return { sub, email, name };
}

export async function plainAccountId(sub: string): Promise<string> {
  return sha256Hex(`fitcouple-google-sub:${sub}`);
}

export async function legacyAccountId(sub: string, salt: string | undefined): Promise<string | null> {
  const pepper = String(salt || "").trim();
  if (pepper.length < 16) return null;
  return sha256Hex(`fitcouple-google-sub:${pepper}:${sub}`);
}
