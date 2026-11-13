import { spawn } from "node:child_process";
import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { startStatic } from "./static.mjs";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

try {
  await access(".dev.vars");
} catch {
  await copyFile(".dev.vars.example", ".dev.vars");
  console.log("Created .dev.vars from the example. The local owner key is in that file.");
}

const server = await startStatic(root, 8788);
const worker = spawn(
  "npx",
  ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", "--local", "--show-interactive-dev-session", "false"],
  { stdio: "inherit", env: process.env },
);

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:8787/health");
      if (res.ok) return true;
    } catch {
      // The worker is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const up = await waitForHealth();
if (up) {
  console.log("\nPlay:  http://127.0.0.1:8788/play.html");
  console.log("Owner: http://127.0.0.1:8788/admin.html");
  console.log("Home:  http://127.0.0.1:8788/\n");
} else {
  console.error("The game server did not answer on port 8787.");
}

function shutdown() {
  worker.kill("SIGTERM");
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
worker.on("exit", (code) => {
  server.close();
  process.exit(code || 0);
});
