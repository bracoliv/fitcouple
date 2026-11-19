import { GameError } from "./errors.ts";

interface AccessJwk extends JsonWebKey {
  kid?: string;
}

let cached: { domain: string; keys: AccessJwk[]; until: number } | null = null;

export function clearAccessKeyCache(): void {
  cached = null;
}

function teamHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
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

export function accessRequired(aud: string | undefined): boolean {
  return Boolean(String(aud || "").trim());
}

export async function assertAccessJwt(request: Request, teamDomain: string | undefined, aud: string | undefined, fetcher: typeof fetch = fetch): Promise<void> {
  const audience = String(aud || "").trim();
  if (!audience) return;
  const host = teamHost(teamDomain || "");
  if (!host.endsWith(".cloudflareaccess.com")) {
    throw new GameError(503, "Set CF_ACCESS_TEAM_DOMAIN to your team host, such as fit.cloudflareaccess.com.");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  const parts = token.split(".");
  if (parts.length !== 3) throw new GameError(403, "Open the owner page through Cloudflare Access.");
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new GameError(403, "Open the owner page through Cloudflare Access.");
  const now = Date.now();
  if (!cached || cached.domain !== host || cached.until < now) {
    const res = await fetcher(`https://${host}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new GameError(403, "Cloudflare Access could not be checked.");
    const data = await res.json() as { keys?: AccessJwk[] };
    const keys = (data.keys || []).filter((key) => key && key.kty === "RSA" && typeof key.kid === "string");
    if (!keys.length) throw new GameError(403, "Cloudflare Access could not be checked.");
    cached = { domain: host, keys, until: now + 60 * 60 * 1000 };
  }
  const jwk = cached.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new GameError(403, "Open the owner page through Cloudflare Access.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytesFromBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new GameError(403, "Open the owner page through Cloudflare Access.");
  if (payload.iss !== `https://${host}`) throw new GameError(403, "Open the owner page through Cloudflare Access.");
  const claim = payload.aud;
  const audiences = Array.isArray(claim) ? claim : [claim];
  if (!audiences.includes(audience)) throw new GameError(403, "Open the owner page through Cloudflare Access.");
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 < now - 60_000) throw new GameError(403, "Open the owner page through Cloudflare Access.");
}
