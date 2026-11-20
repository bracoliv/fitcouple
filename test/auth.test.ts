import assert from "node:assert/strict";
import test from "node:test";
import { clearGoogleKeyCache, legacyAccountId, plainAccountId, verifyGoogleIdToken } from "../src/worker/google-auth.ts";
import { googleFixture } from "./google-fixture.ts";

const CLIENT = "test-client.apps.googleusercontent.com";
const fx = googleFixture();

function fetcher() {
  return new Response(JSON.stringify({ keys: [fx.jwk] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("a Google ID token is checked and only the subject is kept", async () => {
  clearGoogleKeyCache();
  const claims = await verifyGoogleIdToken(fx.idToken("8844221100", { email: "Person@Example.com", name: "Aisyah" }), CLIENT, async () => fetcher());
  assert.equal(claims.sub, "8844221100");
  assert.equal(claims.email, "person@example.com");
  assert.equal(claims.name, "Aisyah");
  const id = await plainAccountId(claims.sub);
  assert.equal(id.length, 64);
  assert.equal(await plainAccountId(claims.sub), id);
  assert.notEqual(await legacyAccountId(claims.sub, "test-salt-value-0123456789"), id);
  assert.equal(await legacyAccountId(claims.sub, "short"), null);
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { email_verified: false }), CLIENT, async () => fetcher()));
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { aud: "other.apps.googleusercontent.com" }), CLIENT, async () => fetcher()));
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { iss: "https://evil.example" }), CLIENT, async () => fetcher()));
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { exp: Math.floor(Date.now() / 1000) - 600 }), CLIENT, async () => fetcher()));
  const broken = fx.idToken("8844221100").slice(0, -4) + "aaaa";
  await assert.rejects(() => verifyGoogleIdToken(broken, CLIENT, async () => fetcher()));
});
