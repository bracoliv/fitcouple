import { handle, type AppEnv } from "./http.ts";

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const started = Date.now();
    const path = new URL(request.url).pathname;
    const response = await handle(request, env);
    // Route and status only. Never log the body: it might be a rejected private field.
    console.log(JSON.stringify({
      service: "fitcouple-game",
      method: request.method,
      path,
      status: response.status,
      ms: Date.now() - started,
    }));
    return response;
  },
};
