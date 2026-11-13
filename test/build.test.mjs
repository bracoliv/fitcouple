import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  assert.ok(play.length > 1000);
  assert.ok(fit.length > 1000);
  for (const file of ["dist/play.js", "dist/admin.js", "dist/fit.js"]) {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(checked.status, 0, file + "\n" + checked.stderr);
  }
});
