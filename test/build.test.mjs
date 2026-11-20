import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("publish build minifies and obfuscates the front end", () => {
  const built = spawnSync(process.execPath, ["scripts/build.mjs"], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const play = readFileSync("dist/play.js", "utf8");
  const admin = readFileSync("dist/admin.js", "utf8");
  const fit = readFileSync("dist/fit.js", "utf8");
  const html = readFileSync("dist/play.html", "utf8");
  assert.equal(html.includes("src/web/main.js"), false);
  assert.equal(html.includes("play.js"), true);
  assert.equal(play.includes("CREATE TABLE"), false);
  assert.equal(play.includes("countToday"), false);
  assert.equal(admin.includes("local-dev-admin-key"), false);
  assert.equal(admin.includes("ADMIN_KEY"), false);
  assert.equal(readFileSync("dist/shop-build.txt", "utf8"), "off");
  assert.equal(existsSync("dist/shop-terms.html"), false);
  assert.equal(existsSync("dist/pay-sandbox.html"), false);
  assert.equal(existsSync("dist/sw.js"), true);
  assert.equal(existsSync("dist/admin/index.html"), true);
  assert.equal(readFileSync("dist/_headers", "utf8").includes("frame-ancestors 'none'"), true);
  assert.equal(readFileSync("dist/_headers", "utf8").includes("https://accounts.google.com"), true);
  assert.ok(fit.length > 1000);
  for (const file of ["dist/play.js", "dist/admin.js", "dist/redeem.js", "dist/fit.js"]) {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(checked.status, 0, file + "\n" + checked.stderr);
  }
});

test("a shop build keeps the Shop tab in the player bundle", () => {
  const on = spawnSync(process.execPath, ["scripts/build.mjs"], {
    encoding: "utf8",
    env: { ...process.env, STORE_ENABLED: "true" },
  });
  assert.equal(on.status, 0, on.stderr || on.stdout);
  assert.equal(readFileSync("dist/shop-build.txt", "utf8"), "on");
  assert.equal(existsSync("dist/shop-terms.html"), true);
  assert.equal(readFileSync("dist/shop-terms.html", "utf8").includes("play.css"), true);
  const off = spawnSync(process.execPath, ["scripts/build.mjs"], {
    encoding: "utf8",
    env: { ...process.env, STORE_ENABLED: "false", GOOGLE_API_KEY: "shared-test-key", GEMINI_API_KEY: "shared-test-key" },
  });
  assert.equal(off.status, 0, off.stderr || off.stdout);
  assert.equal(off.stderr.includes("its own key"), true);
  assert.equal(readFileSync("dist/shop-build.txt", "utf8"), "off");
});
