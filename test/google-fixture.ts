import { generateKeyPairSync, sign } from "node:crypto";

interface IdTokenOptions {
  kid?: string;
  email?: string | null;
  aud?: string;
  iss?: string;
  exp?: number;
  name?: string;
  email_verified?: boolean;
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function googleFixture(): { jwk: JsonWebKey; idToken: (sub: string, options?: IdTokenOptions) => string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported = publicKey.export({ format: "jwk" });
  if (typeof exported === "string" || Buffer.isBuffer(exported)) throw new Error("Expected a JWK");
  const jwk = exported;
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  function idToken(sub: string, options: IdTokenOptions = {}): string {
    const header = b64url(JSON.stringify({ alg: "RS256", kid: options.kid || "test-key", typ: "JWT" }));
    const email = options.email === null ? undefined : (options.email || `${sub}@players.test`);
    const payload: {
      sub: string;
      aud: string;
      iss: string;
      exp: number;
      name: string;
      email?: string;
      email_verified?: boolean;
    } = {
      sub,
      aud: options.aud || "test-client.apps.googleusercontent.com",
      iss: options.iss || "https://accounts.google.com",
      exp: options.exp ?? Math.floor(Date.now() / 1000) + 3600,
      name: options.name || "Player",
    };
    if (email) {
      payload.email = email;
      payload.email_verified = options.email_verified !== false;
    }
    const encoded = b64url(JSON.stringify(payload));
    const data = `${header}.${encoded}`;
    const sig = sign("RSA-SHA256", Buffer.from(data), privateKey);
    return `${data}.${sig.toString("base64url")}`;
  }
  return { jwk, idToken };
}
