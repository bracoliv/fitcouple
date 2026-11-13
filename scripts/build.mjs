import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";
import obfuscatorModule from "javascript-obfuscator";

const JavaScriptObfuscator = obfuscatorModule.obfuscate ? obfuscatorModule : obfuscatorModule.default;
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

const options = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  renameProperties: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.8,
};

async function bundle(entry, outfile) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    write: false,
    legalComments: "none",
  });
  const code = JavaScriptObfuscator.obfuscate(result.outputFiles[0].text, options).getObfuscatedCode();
  await writeFile(outfile, code);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const name of await readdir(root)) {
  if (!/\.(html|css|png|json|webmanifest)$/.test(name) && name !== ".nojekyll") continue;
  await cp(path.join(root, name), path.join(dist, name));
}

for (const file of ["fit.css"]) {
  const target = path.join(dist, file);
  const css = await esbuild.transform(await readFile(target, "utf8"), { loader: "css", minify: true });
  await writeFile(target, css.code);
}
for (const [source, name] of [["src/web/play.css", "play.css"], ["src/web/admin.css", "admin.css"]]) {
  const css = await esbuild.transform(await readFile(path.join(root, source), "utf8"), { loader: "css", minify: true });
  await writeFile(path.join(dist, name), css.code);
}

const fitMin = await esbuild.transform(await readFile(path.join(root, "fit.js"), "utf8"), { loader: "js", minify: true, legalComments: "none" });
await writeFile(path.join(dist, "fit.js"), JavaScriptObfuscator.obfuscate(fitMin.code, options).getObfuscatedCode());
await bundle(path.join(root, "src/web/main.js"), path.join(dist, "play.js"));
await bundle(path.join(root, "src/web/admin.js"), path.join(dist, "admin.js"));

let playHtml = await readFile(path.join(dist, "play.html"), "utf8");
playHtml = playHtml
  .replace('href="src/web/play.css"', 'href="play.css"')
  .replace('<script type="module" src="src/web/main.js"></script>', '<script src="play.js"></script>');
await writeFile(path.join(dist, "play.html"), playHtml);

let adminHtml = await readFile(path.join(dist, "admin.html"), "utf8");
adminHtml = adminHtml
  .replace('href="src/web/admin.css"', 'href="admin.css"')
  .replace('<script type="module" src="src/web/admin.js"></script>', '<script src="admin.js"></script>');
await writeFile(path.join(dist, "admin.html"), adminHtml);

let config = await readFile(path.join(root, "config.js"), "utf8");
if (process.env.GOOGLE_CLIENT_ID) {
  config = config.replace("YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com", process.env.GOOGLE_CLIENT_ID);
}
if (process.env.GOOGLE_API_KEY) {
  config = config.replace('googleApiKey: ""', "googleApiKey: " + JSON.stringify(process.env.GOOGLE_API_KEY));
}
if (process.env.GOOGLE_APP_ID) {
  config = config.replace('googleAppId: ""', "googleAppId: " + JSON.stringify(process.env.GOOGLE_APP_ID));
}
if (process.env.WORKER_URL) {
  config = config.replace("http://127.0.0.1:8787", process.env.WORKER_URL);
}
await writeFile(path.join(dist, "config.js"), config);

for (const file of ["play.js", "admin.js", "fit.js"]) {
  const checked = spawnSync(process.execPath, ["--check", path.join(dist, file)], { encoding: "utf8" });
  if (checked.status !== 0) {
    console.error(checked.stderr);
    process.exit(1);
  }
}

console.log("Built dist/. Publish that folder, not the src folder.");
