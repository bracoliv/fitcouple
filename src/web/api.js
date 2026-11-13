import { buildEventsPayload } from "./summary.js";

// Only quest ids, counts, and flags leave this file.
export function createApi(workerUrl) {
  const base = String(workerUrl || "http://127.0.0.1:8787").replace(/\/$/, "");

  async function request(path, { method = "GET", token, body, headers: extra } = {}) {
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
    let data = {};
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
    session(anonId, day) {
      return request("/v1/session", { method: "POST", body: { anonId, day } });
    },
    me(token, day) {
      return request("/v1/me?day=" + encodeURIComponent(day), { token });
    },
    events(token, day, difficulty, events) {
      return request("/v1/events", {
        method: "POST",
        token,
        body: buildEventsPayload(day, difficulty, events),
      });
    },
    profile(token, displayName, day) {
      return request("/v1/profile", { method: "POST", token, body: { displayName, day } });
    },
    createTeam(token, day) {
      return request("/v1/team", { method: "POST", token, body: { action: "create", day } });
    },
    joinTeam(token, code, day) {
      return request("/v1/team", { method: "POST", token, body: { action: "join", code, day } });
    },
    confirmTeam(token, day) {
      return request("/v1/team", { method: "POST", token, body: { action: "confirm", day } });
    },
    program(token, choice, day) {
      return request("/v1/profile", { method: "POST", token, body: { programChoice: choice, day } });
    },
    duel(token, day, opponentId) {
      const body = { action: "duel", day };
      if (opponentId) body.opponentId = opponentId;
      return request("/v1/team", { method: "POST", token, body });
    },
    checkout(token, order) {
      return request("/v1/store/checkout", { method: "POST", token, body: order });
    },
    shopAdmin(key) {
      return request("/v1/admin/products", { token: key });
    },
    saveProduct(key, product) {
      return request("/v1/admin/products", { method: "POST", token: key, body: product });
    },
    deleteOrder(key, orderId) {
      return request("/v1/admin/orders/delete", { method: "POST", token: key, body: { orderId } });
    },
    redeem(staffKey, code) {
      return request("/v1/vouchers/redeem", { method: "POST", token: staffKey, body: { code } });
    },
    coach(token, day, key, host) {
      return request("/v1/coach", {
        method: "POST",
        token,
        body: { day },
        headers: { "X-Ai-Key": key, "X-Ai-Host": host || "api.openai.com" },
      });
    },
    admin(key, day) {
      return request("/v1/admin/customers?day=" + encodeURIComponent(day), { token: key });
    },
  };
}
