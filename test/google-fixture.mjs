import { generateKeyPairSync, sign } from "node:crypto";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function googleFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  function idToken(sub, options = {}) {
    const header = b64url(JSON.stringify({ alg: "RS256", kid: options.kid || "test-key", typ: "JWT" }));
    const email = options.email === null ? undefined : (options.email || `${sub}@players.test`);
    const payload = {
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
