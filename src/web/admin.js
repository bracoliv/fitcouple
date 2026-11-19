import { createApi } from "./api.js";
import { localDay } from "./summary.js";

const config = window.FIT_GAME_CONFIG || { workerUrl: "http://127.0.0.1:8787" };
const api = createApi(config.workerUrl);

async function ownerShop(path, key, body) {
  const headers = { Authorization: "Bearer " + key };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(String(config.workerUrl || "").replace(/\/$/, "") + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "The shop could not be updated.");
    error.status = res.status;
    throw error;
  }
  return data;
}

function loadOwnerShop(key) {
  return ownerShop("/v1/admin/products", key);
}

function saveOwnerProduct(key, product) {
  return ownerShop("/v1/admin/products", key, product);
}

function deleteOwnerOrder(key, orderId) {
  return ownerShop("/v1/admin/orders/delete", key, { orderId });
}
const KEY = "fitAdminKey";
const filters = ["all", "improving", "steady", "slipping", "inactive"];
const state = { key: sessionStorage.getItem(KEY) || "", report: null, shop: null, ai: null, support: null, supportQuery: "", error: "", filter: "all", query: "", loading: false };

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sign(n) {
  if (n > 0) return "+" + n;
  return String(n);
}

function spark(points) {
  if (!points || !points.length) return "";
  const values = points.map((point) => point.xp);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return `<div class="spark" title="XP over recent days">${points.map((point) => `<i style="height:${Math.max(8, Math.round(((point.xp - min) / span) * 100))}%"></i>`).join("")}</div>`;
}

function playerCard(player) {
  const attrs = ["strength", "discipline", "health", "mind"].map((name) => {
    const item = player.attributes[name];
    return `${name} ${item.now} (${sign(item.delta7)} / 7d, ${sign(item.delta30)} / 30d)`;
  }).join(" · ");
  return `<article class="card player" data-status="${esc(player.status)}">
    <div><strong>${esc(player.displayName || "No name")}</strong> <span class="badge">${esc(player.status)}</span></div>
    <div class="id">${esc(player.id)}</div>
    <div class="stats"><span>Lv ${player.level}</span><span>${player.xp} XP</span><span>streak ${player.streak}</span><span>last ${esc(player.lastActiveDay || "—")}</span><span>day ${player.programDay}/${player.programLength}</span></div>
    <div class="stats"><span>${sign(player.xpGained7)} XP in 7 days</span><span>${sign(player.xpGained30)} XP in 30 days</span></div>
    <p class="hint">${esc(player.statusReason)}</p>
    ${player.flagged ? `<p class="bad">Check this player. ${esc(player.flagReason || "")}</p>` : ""}
    <p class="hint">${esc(attrs)}</p>
    ${spark(player.history)}
  </article>`;
}

function visible(player) {
  if (state.filter !== "all" && player.status !== state.filter) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return (player.displayName || "").toLowerCase().includes(q) || player.id.toLowerCase().includes(q);
}

function aiCard() {
  const ai = state.ai;
  if (!ai) return "";
  const limits = ai.limits || {};
  const fields = ["food_photo", "text_log", "recommend", "chat"].map((name) => `<label>${esc(name)}<input name="${esc(name)}" inputmode="numeric" value="${esc(limits[name] ?? "")}"></label>`).join("");
  const usage = (ai.usage || []).map((row) => `<li>${esc(row.feature)} · ${esc(row.total)} today</li>`).join("");
  const people = (ai.premium || []).map((row) => `<li>${esc(row.user_id)}</li>`).join("");
  const windows = ((ai.cost && ai.cost.windows) || []).map((window) => {
    const money = (cost) => cost ? `$${Number(cost.usd).toFixed(4)} · RM ${Number(cost.rm).toFixed(4)}` : "";
    const providers = (window.providers || []).map((row) => `<li>${esc(row.provider)} · ${row.calls} calls · in ${row.inputTokens} · out ${row.outputTokens} · ${money(row.cost)} · fallbacks ${row.fallbacks}</li>`).join("");
    const features = (window.features || []).map((row) => `<li>${esc(row.feature)} · ${row.calls} calls · in ${row.inputTokens} · out ${row.outputTokens} · ${money(row.cost)}</li>`).join("");
    const users = (window.topUsers || []).map((row) => `<li>${esc(row.userId)} · ${row.calls} calls · in ${row.inputTokens} · out ${row.outputTokens} · ${money(row.cost)}</li>`).join("");
    return `<h3>${esc(window.label)}</h3><p>Active users ${window.activeUsers}. Average ${money(window.average)}. Total ${money(window.cost)}.</p><ul class="log">${providers || `<li class="meta">No provider calls.</li>`}</ul><ul class="log">${features || `<li class="meta">No feature calls.</li>`}</ul><ul class="log">${users || `<li class="meta">No users.</li>`}</ul>`;
  }).join("");
  return `<section class="card"><h2>Assistant limits</h2><p class="hint">Today's spend $${Number(ai.budget?.spentUsd || 0).toFixed(4)} of $${Number(ai.budget?.budgetUsd ?? 5).toFixed(2)}. ${ai.budget?.warn ? `Past the ${Math.round((ai.budget.warnAtUsd / ai.budget.budgetUsd) * 100)}% warning.` : "Under the warning line."} ${esc(ai.budget?.window || "Resets at 00:00 UTC.")}</p><p class="hint">Counts, token totals, and cost only. This page does not show meals, photos, or chat text. Premium has no daily cap. Payments stay off unless PREMIUM_PAYMENTS_ENABLED is true, and even then no charge is live. RM uses the configured rate${ai.cost ? ` (${ai.cost.usdToRm})` : ""}.</p>
    <form id="limitForm">${fields}<button type="submit">Save limits</button></form>
    <ul class="log">${usage || `<li class="meta">No assistant use today.</li>`}</ul>
    ${windows}
    <h3>Refusals today</h3>
    <ul class="log">${(ai.refusals || []).map((row) => `<li>${esc(row.user_id)} · ${esc(row.count)}</li>`).join("") || `<li class="meta">None.</li>`}</ul>
    <p class="hint">Players said a refusal was really a health question: ${esc(ai.feedback || 0)} today. The question text is not stored.</p>
    <form id="controlForm"><label>Player id<input name="userId" required></label><label class="hint"><input name="paused" type="checkbox"> Pause the assistant</label><label>Photo cap<input name="food_photo" inputmode="numeric" placeholder="blank keeps the shared cap"></label><label>Text cap<input name="text_log" inputmode="numeric"></label><label>Recommendation cap<input name="recommend" inputmode="numeric"></label><label>Chat cap<input name="chat" inputmode="numeric"></label><button type="submit">Save this player's limits</button></form>
    <form id="premiumForm"><label>Player id<input name="userId" required></label><button type="submit" name="grant" value="yes">Grant premium</button><button type="submit" name="grant" value="no">Remove premium</button></form>
    <ul class="log">${people || `<li class="meta">No premium players.</li>`}</ul></section>`;
}

function personLine(person) {
  const usage = (person.usage || []).map((row) => `${row.feature} ${row.count}`).join(", ") || "none";
  const caps = person.caps || {};
  return `<li><strong>${esc(person.email || "No email")}</strong> · ${esc(person.name || "No name")}<br>
    <span class="id">${esc(person.id)}</span><br>
    Lv ${person.level} · ${person.xp} XP · streak ${person.streak} · last ${esc(person.lastActiveDay || "—")} · ${esc(person.plan)}${person.giftExpires ? ` until ${esc(person.giftExpires)}` : ""}<br>
    Today ${esc(usage)} · in ${person.tokens?.input || 0} · out ${person.tokens?.output || 0} · $${Number(person.cost?.usd || 0).toFixed(4)}
    ${person.paused ? " · assistant paused" : ""}
    ${caps.chat != null ? ` · chat cap ${caps.chat}` : ""}
    ${person.note ? `<br>Note: ${esc(person.note)}` : ""}</li>`;
}

function supportCard() {
  const support = state.support;
  if (!support) return "";
  const codes = (support.codes || []).map((row) => `<li>${esc(row.code)} · ${esc(row.status)} · ${row.giftDays} days · redeem by ${esc(row.redeemBy)}${row.label ? ` · ${esc(row.label)}` : ""}${row.redeemedBy ? ` · ${esc(row.redeemedBy)}` : ""}</li>`).join("");
  const audit = (support.audit || []).map((row) => `<li>${esc(row.at)} · ${esc(row.actor)} · ${esc(row.action)} · ${esc(row.detail)}</li>`).join("");
  return `<section class="card"><h2>Accounts</h2>
    <p class="hint">Email and name are stored so you can find a customer. Meals, workouts, weights, photos, and chat text are not. Gift codes are single use. Redeeming while a gift is still running adds the new days onto the current expiry. Purchase history is not in the app, so ending a gift for that reason is your decision. ${support.autoRevokeDays ? `A gift ends automatically after ${support.autoRevokeDays} inactive days.` : "Automatic early end is off (AUTO_REVOKE_INACTIVE_DAYS is 0)."} Redeeming is ${support.giftsEnabled ? "on" : "off"}.</p>
    <form id="supportFind"><label>Email, name, or id<input name="q" value="${esc(state.supportQuery)}"></label><button type="submit">Search</button></form>
    <ul class="log">${(support.people || []).map(personLine).join("") || `<li class="meta">No matches.</li>`}</ul>
    <h3>Inactive</h3><ul class="log">${(support.inactive || []).map(personLine).join("") || `<li class="meta">None in the last search window.</li>`}</ul>
    <h3>Gifts ending soon</h3><ul class="log">${(support.ending || []).map(personLine).join("") || `<li class="meta">None.</li>`}</ul>
    <form id="noteForm"><label>Player id<input name="userId" required></label><label>Note<input name="supportNote" maxlength="200" placeholder="Order ref or why you are watching this account"></label><button type="submit">Save note</button></form>
    <form id="giftUserForm"><label>Player id<input name="userId" required></label><label>Action<select name="action"><option value="grant">Grant days</option><option value="extend">Extend</option><option value="shorten">Shorten</option><option value="set">Set end date</option><option value="revoke">Revoke now</option></select></label><label>Days<input name="days" inputmode="numeric" value="66"></label><label>End date<input name="expiresDay" placeholder="YYYY-MM-DD"></label><button type="submit">Update gift</button></form>
    <form id="codeForm"><label>How many<input name="count" inputmode="numeric" value="1"></label><label>Label<input name="label" maxlength="80" placeholder="Customer or order ref"></label><label>Days to redeem<input name="redeemDays" inputmode="numeric" value="30"></label><label>Gift length<input name="giftDays" inputmode="numeric" value="66"></label><button type="submit">Make codes</button></form>
    <ul class="log">${codes || `<li class="meta">No codes.</li>`}</ul>
    <form id="revokeCodeForm"><label>Unused code<input name="code" required></label><button type="submit">Revoke code</button></form>
    <h3>Owner actions</h3><ul class="log">${audit || `<li class="meta">None yet.</li>`}</ul></section>`;
}

function shopCard() {
  const shop = state.shop;
  if (!shop) return "";
  const products = (shop.products || []).map((item) => `<li>${item.store === "slim" ? "Slimming" : "Pump Up"} · ${esc(item.name)} · ${item.priceCents} sen · list ${item.listPriceCents} sen</li>`).join("");
  const orders = (shop.orders || []).map((item) => `<li>${esc(item.day)} · ${esc(item.status)} · ${esc(item.name)} · ${esc(item.phone)} · ${esc(item.address)} <button type="button" data-delete-order="${esc(item.id)}">Delete</button></li>`).join("");
  return `<section class="card"><h2>Shop</h2><p class="hint">${shop.enabled ? "The server flag is on. Players only see a Shop tab after you rebuild the site with STORE_ENABLED=true." : "Off. The released player app has no Shop tab and the shop address answers Not found. Rebuild with STORE_ENABLED=true only when you mean to show it."}</p><ul class="log">${products || `<li class="meta">No products yet.</li>`}</ul>
    <form id="productForm"><label>Id<input name="id" required maxlength="32"></label><label>Name<input name="name" required maxlength="80"></label><label>Why it is listed<input name="why" required maxlength="200" placeholder="Plain reason. No health claim and no sales pitch."></label><label>Evidence<input name="evidence" required maxlength="200" placeholder="Label fact or source."></label><label>Dose<input name="dose" required maxlength="120"></label><label>Third-party testing<input name="testing" required maxlength="160" placeholder="Name the lab, or write Not third-party tested."></label><label>Halal<select name="halal"><option value="not-stated">Not stated</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>MAL<input name="mal" required maxlength="40" placeholder="MAL number, not-stated, or not-applicable"></label><label>Store<select name="store"><option value="pump">Pump Up</option><option value="slim">Slimming, owner's SOSM+</option></select></label><label>Kind<select name="kind"><option value="whey">Whey</option><option value="creatine">Creatine</option><option value="vitamin-d3">Vitamin D3</option><option value="omega-3">Omega-3</option><option value="magnesium">Magnesium</option><option value="sosm">SOSM+</option></select></label><label>Price in sen<input name="priceCents" inputmode="numeric" required></label><label>Supplier list price in sen<input name="listPriceCents" inputmode="numeric" required></label><label>Store link<input name="linkUrl" required placeholder="Myprotein, LazMall, or Shopee Mall for Pump Up. Shopee or WhatsApp for Slimming."></label><button type="submit">Save product</button></form>
    ${orders ? `<h3>Orders</h3><p class="hint">Name, phone, and address are for delivery only. They are not used to recommend products. Delete a row if the buyer asks.</p><ul class="log">${orders}</ul>` : ""}</section>`;
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  if (!state.key) {
    const local = /127\.0\.0\.1|localhost/.test(config.workerUrl || "");
    app.innerHTML = `<p><a href="play.html">Back to Play</a></p><h1>Owner</h1>
      <p class="hint">Scores only. This page cannot show meals, workouts, weights, or notes.</p>
      <form id="gate" class="card"><label>Owner key<input id="adminKey" type="password" autocomplete="current-password"></label>
      <button type="submit">Open</button>${state.error ? `<p class="bad">${esc(state.error)}</p>` : ""}
      <p class="hint">${local ? "On this computer the key is in the file .dev.vars. It is not the live key." : "Use the key you set with wrangler secret put. It is not stored in the page."}</p></form>`;
    document.getElementById("gate").addEventListener("submit", (event) => {
      event.preventDefault();
      state.key = document.getElementById("adminKey").value.trim();
      sessionStorage.setItem(KEY, state.key);
      load();
    });
    return;
  }
  const report = state.report;
  const counts = report ? report.counts : { improving: 0, steady: 0, slipping: 0, inactive: 0 };
  const list = report ? report.customers.filter(visible) : [];
  app.innerHTML = `<p><a href="play.html">Back to Play</a></p><h1>Are they still improving?</h1>
    <p class="hint">Each card is a player id, an optional name they chose, and scores. The Accounts section also shows the Google email and name. ${state.loading ? "Loading…" : ""}</p>
    ${state.error ? `<p class="bad">${esc(state.error)}</p>` : ""}
    <div class="filters">${filters.map((name) => `<button type="button" data-filter="${name}" class="${state.filter === name ? "on" : ""}">${name}${name === "all" || !report ? "" : " " + counts[name]}</button>`).join("")}
    <button type="button" id="reload">Refresh</button><button type="button" id="signOut">Sign out</button></div>
    <input id="find" placeholder="Find a name or id" value="${esc(state.query)}">
    ${shopCard()}
    ${supportCard()}
    ${aiCard()}
    ${report && report.vouchers ? `<section class="card"><h2>Restaurant vouchers</h2><p class="hint">${report.vouchers.enabled ? "On. Separate from SOSM+." : "Off. Players cannot see this. Set VOUCHERS_ENABLED to true only after you decide to use it."}</p><p>Issued ${report.vouchers.issued} · Redeemed ${report.vouchers.redeemed} · Expired ${report.vouchers.expired}</p>${report.vouchers.configError ? `<p class="bad">${esc(report.vouchers.configError)}</p>` : ""}</section>` : ""}
    ${report ? list.map(playerCard).join("") || `<p class="card">No players in this filter.</p>` : `<p class="card">No report yet.</p>`}
    <p class="hint">Improving means they were active in the last 3 days and this week's XP gain is ahead of the week before (new players with any XP count as improving). Steady means the two weeks match, or they are new and have not gained XP. Slipping means this week is behind the week before. Inactive means no finished quest for more than 3 days.</p>`;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-filter");
      render();
    });
  });
  const limitForm = document.getElementById("limitForm");
  if (limitForm) limitForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveLimits(new FormData(limitForm));
  });
  const controlForm = document.getElementById("controlForm");
  if (controlForm) controlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveControl(new FormData(controlForm));
  });
  const premiumForm = document.getElementById("premiumForm");
  if (premiumForm) premiumForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const grant = event.submitter && event.submitter.value === "yes";
    savePremium(new FormData(premiumForm).get("userId"), grant);
  });
  const productForm = document.getElementById("productForm");
  if (productForm) productForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(productForm);
    saveShopProduct(data);
  });
  document.querySelectorAll("[data-delete-order]").forEach((button) => {
    button.addEventListener("click", () => removeOrder(button.getAttribute("data-delete-order")));
  });
  document.getElementById("reload").addEventListener("click", load);
  document.getElementById("signOut").addEventListener("click", () => {
    state.key = "";
    state.report = null;
    sessionStorage.removeItem(KEY);
    render();
  });
  const find = document.getElementById("find");
  const supportFind = document.getElementById("supportFind");
  if (supportFind) supportFind.addEventListener("submit", (event) => {
    event.preventDefault();
    state.supportQuery = String(new FormData(supportFind).get("q") || "");
    refreshSupport();
  });
  const noteForm = document.getElementById("noteForm");
  if (noteForm) noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(noteForm);
    runSupport(() => ownerShop("/v1/admin/support/note", state.key, { userId: String(data.get("userId") || ""), supportNote: String(data.get("supportNote") || "") }));
  });
  const giftUserForm = document.getElementById("giftUserForm");
  if (giftUserForm) giftUserForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(giftUserForm);
    const expiresDay = String(data.get("expiresDay") || "").trim();
    runSupport(() => ownerShop("/v1/admin/gifts/user", state.key, {
      userId: String(data.get("userId") || ""),
      action: expiresDay ? "set" : String(data.get("action") || "grant"),
      days: Number(data.get("days") || 66),
      expiresDay: expiresDay || null,
    }));
  });
  const codeForm = document.getElementById("codeForm");
  if (codeForm) codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(codeForm);
    runSupport(async () => {
      const made = await ownerShop("/v1/admin/gifts/codes", state.key, {
        count: Number(data.get("count") || 1),
        label: String(data.get("label") || ""),
        redeemDays: Number(data.get("redeemDays") || 30),
        giftDays: Number(data.get("giftDays") || 66),
      });
      state.error = made.codes ? `Codes: ${made.codes.join(", ")}` : "";
    });
  });
  const revokeCodeForm = document.getElementById("revokeCodeForm");
  if (revokeCodeForm) revokeCodeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runSupport(() => ownerShop("/v1/admin/gifts/revoke", state.key, { code: String(new FormData(revokeCodeForm).get("code") || "") }));
  });
  find.addEventListener("input", () => {
    state.query = find.value;
    const start = find.selectionStart;
    render();
    const next = document.getElementById("find");
    if (next) {
      next.focus();
      next.setSelectionRange(start, start);
    }
  });
}

async function saveShopProduct(data) {
  try {
    state.shop = await saveOwnerProduct(state.key, {
      id: String(data.get("id") || ""),
      store: String(data.get("store") || "pump"),
      kind: String(data.get("kind") || ""),
      brand: String(data.get("store") || "") === "slim" ? "sosm" : "other",
      name: String(data.get("name") || ""),
      why: String(data.get("why") || ""),
      evidence: String(data.get("evidence") || ""),
      dose: String(data.get("dose") || ""),
      testing: String(data.get("testing") || ""),
      halal: String(data.get("halal") || "not-stated"),
      mal: String(data.get("mal") || ""),
      priceCents: Number(data.get("priceCents") || 0),
      listPriceCents: Number(data.get("listPriceCents") || 0),
      linkUrl: String(data.get("linkUrl") || ""),
      active: true,
    });
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not save the product.";
  }
  render();
}

async function removeOrder(orderId) {
  try {
    await deleteOwnerOrder(state.key, orderId);
    state.shop = await loadOwnerShop(state.key);
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not delete the order.";
  }
  render();
}

async function saveLimits(data) {
  try {
    for (const name of ["food_photo", "text_log", "recommend", "chat"]) {
      await ownerShop("/v1/admin/ai/limits", state.key, { feature: name, dailyCap: Number(data.get(name)) });
    }
    state.ai = await ownerShop("/v1/admin/ai", state.key);
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not save the limits.";
  }
  render();
}

async function saveControl(data) {
  const blank = (name) => {
    const value = String(data.get(name) || "").trim();
    return value === "" ? null : Number(value);
  };
  try {
    await ownerShop("/v1/admin/ai/control", state.key, {
      userId: String(data.get("userId") || ""),
      paused: data.get("paused") === "on",
      food_photo: blank("food_photo"),
      text_log: blank("text_log"),
      recommend: blank("recommend"),
      chat: blank("chat"),
    });
    state.ai = await ownerShop("/v1/admin/ai", state.key);
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not update that player.";
  }
  render();
}

async function savePremium(userId, grant) {
  try {
    await ownerShop("/v1/admin/ai/premium", state.key, { userId: String(userId || ""), grant });
    state.ai = await ownerShop("/v1/admin/ai", state.key);
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not update premium.";
  }
  render();
}

async function refreshSupport() {
  try {
    const q = encodeURIComponent(state.supportQuery || "");
    state.support = await ownerShop(`/v1/admin/support?q=${q}&inactiveDays=14&endingDays=7`, state.key);
    state.error = state.error && state.error.startsWith("Codes:") ? state.error : "";
  } catch (err) {
    state.error = err.message || "Could not load accounts.";
  }
  render();
}

async function runSupport(task) {
  try {
    await task();
    await refreshSupport();
  } catch (err) {
    state.error = err.message || "Could not update that account.";
    render();
  }
}

async function load() {
  state.loading = true;
  state.error = "";
  render();
  try {
    state.report = await api.admin(state.key, localDay());
    state.shop = await loadOwnerShop(state.key);
    state.ai = await ownerShop("/v1/admin/ai", state.key);
    state.support = await ownerShop("/v1/admin/support?inactiveDays=14&endingDays=7&q=" + encodeURIComponent(state.supportQuery || ""), state.key);
  } catch (err) {
    state.report = null;
    state.error = err.message || "Could not load the owner page.";
    if (err.status === 401) {
      state.key = "";
      sessionStorage.removeItem(KEY);
    }
  } finally {
    state.loading = false;
    render();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => (state.key ? load() : render()));
else if (state.key) load();
else render();
