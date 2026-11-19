import assert from "node:assert/strict";
import test from "node:test";
import { accountIdFromSub, clearGoogleKeyCache, verifyGoogleIdToken } from "../src/worker/google-auth.ts";
import { googleFixture } from "./google-fixture.mjs";

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
  const claims = await verifyGoogleIdToken(fx.idToken("8844221100", { email: "person@example.com" }), CLIENT, async () => fetcher());
  assert.equal(claims.sub, "8844221100");
  assert.equal("email" in claims, false);
  const id = await accountIdFromSub(claims.sub, "test-salt-value-0123456789");
  assert.equal(id.length, 64);
  assert.equal(id.includes("8844221100"), false);
  assert.equal(await accountIdFromSub(claims.sub, "test-salt-value-0123456789"), id);
  assert.notEqual(await accountIdFromSub(claims.sub, "other-salt-value-0123456789"), id);
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { aud: "other.apps.googleusercontent.com" }), CLIENT, async () => fetcher()));
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { iss: "https://evil.example" }), CLIENT, async () => fetcher()));
  await assert.rejects(() => verifyGoogleIdToken(fx.idToken("8844221100", { exp: Math.floor(Date.now() / 1000) - 600 }), CLIENT, async () => fetcher()));
  const broken = fx.idToken("8844221100").slice(0, -4) + "aaaa";
  await assert.rejects(() => verifyGoogleIdToken(broken, CLIENT, async () => fetcher()));
});
