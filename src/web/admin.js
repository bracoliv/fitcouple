import { createApi } from "./api.js";
import { localDay } from "./summary.js";

const config = window.FIT_GAME_CONFIG || { workerUrl: "http://127.0.0.1:8787" };
const api = createApi(config.workerUrl);
const KEY = "fitAdminKey";
const filters = ["all", "improving", "steady", "slipping", "inactive"];
const state = { key: sessionStorage.getItem(KEY) || "", report: null, error: "", filter: "all", query: "", loading: false };

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
    <p class="hint">Each card is a player id, an optional name they chose, and scores. ${state.loading ? "Loading…" : ""}</p>
    ${state.error ? `<p class="bad">${esc(state.error)}</p>` : ""}
    <div class="filters">${filters.map((name) => `<button type="button" data-filter="${name}" class="${state.filter === name ? "on" : ""}">${name}${name === "all" || !report ? "" : " " + counts[name]}</button>`).join("")}
    <button type="button" id="reload">Refresh</button><button type="button" id="signOut">Sign out</button></div>
    <input id="find" placeholder="Find a name or id" value="${esc(state.query)}">
    ${report && report.vouchers ? `<section class="card"><h2>Restaurant vouchers</h2><p class="hint">${report.vouchers.enabled ? "On. Separate from SOSM+." : "Off. Players cannot see this. Set VOUCHERS_ENABLED to true only after you decide to use it."}</p><p>Issued ${report.vouchers.issued} · Redeemed ${report.vouchers.redeemed} · Expired ${report.vouchers.expired}</p>${report.vouchers.configError ? `<p class="bad">${esc(report.vouchers.configError)}</p>` : ""}</section>` : ""}
    ${report ? list.map(playerCard).join("") || `<p class="card">No players in this filter.</p>` : `<p class="card">No report yet.</p>`}
    <p class="hint">Improving means they were active in the last 3 days and this week's XP gain is ahead of the week before (new players with any XP count as improving). Steady means the two weeks match, or they are new and have not gained XP. Slipping means this week is behind the week before. Inactive means no finished quest for more than 3 days.</p>`;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-filter");
      render();
    });
  });
  document.getElementById("reload").addEventListener("click", load);
  document.getElementById("signOut").addEventListener("click", () => {
    state.key = "";
    state.report = null;
    sessionStorage.removeItem(KEY);
    render();
  });
  const find = document.getElementById("find");
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

async function load() {
  state.loading = true;
  state.error = "";
  render();
  try {
    state.report = await api.admin(state.key, localDay());
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
