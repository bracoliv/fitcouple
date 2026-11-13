import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tierFor } from "../src/web/avatar.js";

test("avatar tiers follow level and the module does not call the game server", () => {
  assert.equal(tierFor(1), "stone");
  assert.equal(tierFor(5), "bronze");
  assert.equal(tierFor(10), "gold");
  assert.equal(tierFor(20), "flame");
  const src = readFileSync(new URL("../src/web/avatar.js", import.meta.url), "utf8");
  assert.equal(/\/v1\/(me|events|session|team|store|coach|admin)/.test(src), false);
  assert.equal(src.includes("8787"), false);
  assert.equal(src.includes("indexedDB"), true);
  assert.equal(src.includes("api.openai.com/v1/images/edits"), true);
  assert.equal(src.includes("googleapis.com"), true);
});
