import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 8788, strictPort: true },
  appType: "mpa",
});
