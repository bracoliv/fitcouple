import { handle, type AppEnv } from "./http.ts";
import { runBackup } from "./backup.ts";
import { ensureSchema } from "./data.ts";

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const started = Date.now();
    const path = new URL(request.url).pathname;
    const response = await handle(request, env);
    console.log(JSON.stringify({
      service: "fitcouple-game",
      method: request.method,
      path,
      status: response.status,
      ms: Date.now() - started,
    }));
    return response;
  },
  async scheduled(_event: unknown, env: AppEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      await runBackup(env.DB, env);
    })());
  },
};
