import { buildEventsPayload } from "./summary.ts";

// Only quest ids, counts, and flags leave this file.
export function createApi(workerUrl?: any) : any {
  const base = String(workerUrl || "http://127.0.0.1:8787").replace(/\/$/, "");

  async function request(path?: any, { method = "GET", token, body, headers: extra }: any = {}) : Promise<any> {
    const headers = { ...(extra || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("Cannot reach the game server. Start it with npm run dev.");
    }
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const error = new Error(data.error || "The game server said no.");
      error.status = res.status;
      throw error;
    }
    return data;
  }

  return {
    session(idToken?: any, day?: any) : any {
      return request("/v1/session", { method: "POST", body: { idToken, day } });
    },
    me(token?: any, day?: any) : any {
      return request("/v1/me?day=" + encodeURIComponent(day), { token });
    },
    events(token?: any, day?: any, difficulty?: any, events?: any) : any {
      return request("/v1/events", {
        method: "POST",
        token,
        body: buildEventsPayload(day, difficulty, events),
      });
    },
    profile(token?: any, displayName?: any, day?: any) : any {
      return request("/v1/profile", { method: "POST", token, body: { displayName, day } });
    },
    createTeam(token?: any, day?: any) : any {
      return request("/v1/team", { method: "POST", token, body: { action: "create", day } });
    },
    joinTeam(token?: any, code?: any, day?: any) : any {
      return request("/v1/team", { method: "POST", token, body: { action: "join", code, day } });
    },
    confirmTeam(token?: any, day?: any) : any {
      return request("/v1/team", { method: "POST", token, body: { action: "confirm", day } });
    },
    program(token?: any, choice?: any, day?: any) : any {
      return request("/v1/profile", { method: "POST", token, body: { programChoice: choice, day } });
    },
    duel(token?: any, day?: any, opponentId?: any) : any {
      const body: any = { action: "duel", day };
      if (opponentId) body.opponentId = opponentId;
      return request("/v1/team", { method: "POST", token, body });
    },
    redeem(staffKey?: any, code?: any) : any {
      return request("/v1/vouchers/redeem", { method: "POST", token: staffKey, body: { code } });
    },
    coach(token?: any, day?: any, key?: any, host?: any) : any {
      return request("/v1/coach", {
        method: "POST",
        token,
        body: { day },
        headers: { "X-Ai-Key": key, "X-Ai-Host": host || "api.openai.com" },
      });
    },
    aiQuota(token?: any) : any {
      return request("/v1/ai/quota", { token });
    },
    aiFoodText(token?: any, text?: any) : any {
      return request("/v1/ai/food-text", { method: "POST", token, body: { text }, headers: { "X-Ai-Consent": "yes" } });
    },
    aiFoodPhoto(token?: any, image?: any) : any {
      return request("/v1/ai/food-photo", { method: "POST", token, body: { image, mime: "image/jpeg" }, headers: { "X-Ai-Consent": "yes" } });
    },
    aiMeals(token?: any, left?: any) : any {
      return request("/v1/ai/meals", { method: "POST", token, body: left, headers: { "X-Ai-Consent": "yes" } });
    },
    aiWorkout(token?: any, context?: any) : any {
      return request("/v1/ai/workout", { method: "POST", token, body: context, headers: { "X-Ai-Consent": "yes" } });
    },
    aiChat(token?: any, message?: any) : any {
      return request("/v1/ai/chat", { method: "POST", token, body: { message }, headers: { "X-Ai-Consent": "yes" } });
    },
    aiFeedback(token?: any) : any {
      return request("/v1/ai/feedback", { method: "POST", token, body: {}, headers: { "X-Ai-Consent": "yes" } });
    },
    redeemGift(token?: any, code?: any) : any {
      return request("/v1/gift/redeem", { method: "POST", token, body: { code } });
    },
    admin(key?: any, day?: any) : any {
      return request("/v1/admin/customers?day=" + encodeURIComponent(day), { token: key });
    },
  };
}
