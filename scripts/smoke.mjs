import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const dist = path.resolve("dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(dist, rel));
  if (!file.startsWith(dist)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("missing");
  }
});

await new Promise((resolve) => server.listen(8791, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const failures = [];
async function check(pathname, text) {
  const response = await page.goto("http://127.0.0.1:8791" + pathname, { waitUntil: "domcontentloaded" });
  if (!response || response.status() >= 400) failures.push(pathname + " status " + (response && response.status()));
  try {
    await page.waitForFunction((expected) => document.body && document.body.innerText.includes(expected), text, { timeout: 8000 });
  } catch {
    const seen = await page.locator("body").innerText().catch(() => "");
    failures.push(pathname + " missing " + text + " saw " + seen.slice(0, 120).replace(/\n/g, " "));
  }
}

try {
  await check("/", "Fit");
  await check("/solo.html", "FitSolo");
  await check("/dashboard.html", "FitCouple");
  await check("/family.html", "FitFamily");
  await check("/play.html", "Sign in to the game");
  await check("/admin.html", "Owner");
  const direct = await fetch("http://127.0.0.1:8791/admin/");
  const directHtml = await direct.text();
  if (!direct.ok || !directHtml.includes("Open the owner page")) failures.push("/admin/ missing redirect");
  const manifest = await page.goto("http://127.0.0.1:8791/manifest-solo.json");
  if (!manifest || manifest.status() !== 200) failures.push("solo manifest");
  const sw = await page.goto("http://127.0.0.1:8791/sw.js");
  if (!sw || sw.status() !== 200) failures.push("service worker");
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Smoke checks passed.");
