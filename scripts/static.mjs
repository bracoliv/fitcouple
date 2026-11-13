import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

export function startStatic(rootDir, port) {
  const root = path.resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const full = path.resolve(root, "." + pathname);
      const inside = full === root || full.startsWith(root + path.sep);
      if (!inside || path.basename(full).startsWith(".")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const info = await stat(full).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(full).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("Error");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
