import path from "node:path";
import { startStatic } from "./static.mjs";

const dist = path.resolve(import.meta.dirname, "..", "dist");
await startStatic(dist, 8790);
console.log("Built site: http://127.0.0.1:8790/play.html");
console.log("Owner:      http://127.0.0.1:8790/admin.html");
