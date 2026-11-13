import { createApi } from "./api.js";
import { RECIPES, guidedLogEvent, videoFor } from "./catalog.js";
import { SHEETS_SCOPE, appendLog, clientIdReady, createSheet, pickSheet, readLog, requestGoogleToken } from "./google.js";
import { loadMeasurements, loadPhoto, saveMeasurement, savePhoto, shrinkPhoto } from "./progress.js";
import { voucherQr } from "./qr.js";
import { fetchLinkLog, loadPractice, savePractice, sheetIdFromUrl } from "./sheet.js";
import { countToday, countsPayload, localDay, peopleIn, rowCountsForScore } from "./summary.js";
import { bindShop, navClass, screenList, shopHtml } from "./shop-ui.js";

const config = window.FIT_GAME_CONFIG || { workerUrl: "http://127.0.0.1:8787", googleClientId: "" };
const api = createApi(config.workerUrl);

const state = {
  loading: true,
  error: "",
  profile: null,
  token: "",
  sheetMode: "",
  sheetId: "",
  sheetUrl: "",
  person: "",
  people: [],
  rows: [],
  googleToken: "",
  sheetStatus: "",
  timer: { total: 25 * 60, left: 25 * 60, running: false, endsAt: 0 },
  measures: [],
  photoUrls: { day1: "", day66: "" },
  coachReply: "",
};

let busy = false;

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function store(key, value) {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function anonId() {
  const saved = localStorage.getItem("fitAnonId");
  if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = await sha256Hex(raw);
  localStorage.setItem("fitAnonId", id);
  return id;
}

async function ensureSession() {
  const day = localDay();
  state.token = localStorage.getItem("fitSessionToken") || "";
  if (state.token) return;
  try {
    const created = await api.session(await anonId(), day);
    state.token = created.token;
    localStorage.setItem("fitSessionToken", created.token);
    state.profile = created;
  } catch (err) {
    if (err.status !== 409) throw err;
    localStorage.removeItem("fitAnonId");
    localStorage.removeItem("fitSessionToken");
    const created = await api.session(await anonId(), day);
    state.token = created.token;
    localStorage.setItem("fitSessionToken", created.token);
    state.profile = created;
  }
}

function rememberSheet() {
  store("fitSheetMode", state.sheetMode);
  store("fitSheetId", state.sheetId);
  store("fitSheetUrl", state.sheetUrl);
  store("fitPerson", state.person);
}

async function restoreSheet() {
  state.sheetMode = localStorage.getItem("fitSheetMode") || "";
  state.sheetId = localStorage.getItem("fitSheetId") || "";
  state.sheetUrl = localStorage.getItem("fitSheetUrl") || "";
  state.person = localStorage.getItem("fitPerson") || "";
  if (state.sheetMode === "practice") state.rows = loadPractice();
  else if (state.sheetMode === "link" && state.sheetId) state.rows = await fetchLinkLog(state.sheetId);
  else if (state.sheetMode === "google") {
    state.rows = [];
    state.sheetStatus = "Sign in with Google again to refresh this private sheet.";
  }
  state.people = peopleIn(state.rows);
  if (!state.person && state.people.length === 1) state.person = state.people[0];
}

async function pushCounts() {
  if (!state.sheetMode) return;
  if (!state.profile) state.profile = await api.me(state.token, localDay());
  const counts = countToday(state.rows, state.person, localDay());
  const payload = countsPayload(localDay(), state.profile.difficulty, counts, { hasProof: state.photoProof === true });
  state.profile = await api.events(state.token, payload.day, payload.difficulty, payload.events);
}

async function run(fn) {
  if (busy) return;
  busy = true;
  try {
    const notice = await fn();
    state.error = notice || "";
  } catch (err) {
    state.error = err.message || "Something went wrong.";
  } finally {
    busy = false;
    render();
  }
}

function screenNow() {
  const name = location.hash.slice(1);
  if (name === "sheet") return "more";
  return screenList().includes(name) ? name : "today";
}

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function flame() {
  const on = state.profile && state.profile.streak > 0;
  return `<span class="streak ${on ? "" : "off"}"><svg class="flame" viewBox="0 0 18 22" aria-hidden="true"><path fill="${on ? "#ff7a45" : "#667085"}" d="M9 0s4 4.2 4 8.2c0 1.5-.6 2.6-1.3 3.5.8-.3 1.6-1.3 1.8-2.5 1.6 1.6 2.5 3.6 2.5 5.8C16 19 13 22 9 22S2 19 2 15c0-3.2 2.2-6.4 4.2-8.6C6.7 8.2 7 9.6 7 10.6 7 6.4 9 0 9 0z"/></svg>${state.profile ? state.profile.streak : 0}</span>`;
}

function questActions(quest) {
  if (quest.id === "focus") return `<span class="meta">Timer</span>`;
  if (quest.id === "steps") {
    return `<span class="step"><input id="stepsInput" inputmode="numeric" placeholder="Steps" aria-label="Steps today"><button type="button" id="saveSteps">Save</button></span>`;
  }
  if (quest.kind === "check") {
    return `<button type="button" data-check="${esc(quest.id)}" ${quest.done ? "disabled" : ""}>${quest.done ? "Done" : "Mark done"}</button>`;
  }
  if (state.sheetMode && quest.id !== "steps") return `<button type="button" data-refresh>Update</button>`;
  return `<button type="button" data-add="${esc(quest.id)}">Add one</button>`;
}

function todayHtml() {
  const profile = state.profile;
  if (!profile) return "";
  const pct = profile.xpToNext ? Math.min(100, Math.round(profile.xpIntoLevel / profile.xpToNext * 100)) : 0;
  const quests = profile.quests.map((quest) => {
    const progress = quest.kind === "count" ? `${quest.count}/${quest.target}` : (quest.done ? "Done" : "Not yet");
    const extra = quest.required ? "" : " · optional";
    const bonus = quest.bonus ? " · day bonus" : "";
    return `<li class="quest ${quest.done ? "done" : ""}"><div><strong>${esc(quest.title)}</strong><span class="sub">${esc(quest.detail)}</span><span class="meta">${progress} · ${quest.xp} XP · ${esc(quest.attribute)}${extra}${bonus}</span></div>${questActions(quest)}</li>`;
  }).join("");
  const cleared = profile.dayClear ? `<p class="banner">Day cleared. +${profile.dayClearXp} XP.</p>` : "";
  return `<section class="card"><div class="row"><span class="xp-label">Level ${profile.level}</span><span class="xp-label">${profile.xpIntoLevel} / ${profile.xpToNext} XP</span></div><div class="bar" aria-label="Experience"><span style="width:${pct}%"></span></div></section>
    <div class="seg" role="group" aria-label="Difficulty">${["easy", "normal", "hard"].map((level) => `<button type="button" data-diff="${level}" class="${profile.difficulty === level ? "on" : ""}">${level[0].toUpperCase()}${level.slice(1)}</button>`).join("")}</div>
    <p class="meta">Day ${profile.program.day} of ${profile.program.length}. Typing earns half XP. The focus timer earns full XP for that quest. A streak adds more than extra volume.</p>
    ${cleared}<ul class="quests">${quests}</ul>${attrGrid(profile.attributes)}`;
}

function attrGrid(attrs) {
  return `<div class="attrs">${["strength", "discipline", "health", "mind"].map((name) => `<div class="attr ${name}"><i></i><span class="meta">${name}</span><b>${attrs[name]}</b></div>`).join("")}</div>`;
}

function pathHtml() {
  const program = state.profile.program;
  const pct = Math.round(program.day / program.length * 100);
  const same = program.day === 1;
  const choices = (state.profile.programChoices || []).map((choice) => `<button type="button" data-program="${esc(choice.id)}" class="${state.profile.programChoice === choice.id ? "on" : ""}">${esc(choice.title)}</button>`).join("");
  const session = state.profile.session;
  const moves = session ? session.moves.map((move) => {
    const video = videoFor(move.videoKey);
    return `<li>${esc(move.name)}${video ? ` · <a href="${esc(video.url)}" target="_blank" rel="noopener">${esc(video.title)} on YouTube</a>` : ""}</li>`;
  }).join("") : "";
  const plan = `<section class="card"><h2>Exercise plan</h2><div class="actions">${choices}</div>${session ? `<p>${esc(session.title)}</p><p class="sub">${esc(session.note)}</p><ul>${moves}</ul><p class="hint">Videos play on YouTube. Fit does not host them. Mark Today's session on the Today tab when you finish.</p>` : `<p class="hint">Pick a plan. It drives one daily session. The server stores the plan name, not a workout diary.</p>`}</section>`;
  return `<section class="card"><p class="meta">66-day program</p><p class="day-no">Day ${program.day}</p><div class="track"><span style="width:${pct}%"></span></div><p class="meta">${program.complete ? "You reached day 66." : `${program.length - program.day} days left`}</p>${program.complete ? `<button type="button" id="printCert">66-Day Finisher certificate</button>` : ""}</section>
    ${plan}
    <div class="pair"><article class="card"><h2>Day 1</h2><p>${esc(program.dayOne.title)}</p><p class="sub">${esc(program.dayOne.detail)}</p></article>
    <article class="card"><h2>${same ? "You are on day 1" : "Today"}</h2><p>${esc(program.current.title)}</p><p class="sub">${esc(program.current.detail)}</p></article></div>
    ${attrGrid(state.profile.attributes)}
    ${program.complete ? `<article class="card cert"><h2>66-Day Finisher</h2><p>${esc(state.profile.displayName || "Player")}</p><p class="sub">Day 66 of ${esc(state.profile.programChoice || "the plan")}. A game certificate. Not medical proof. It cannot be spent, and there is no discount or voucher.</p></article>` : ""}`;
}

function focusHtml() {
  return `<section class="card"><p class="clock" id="clock" aria-live="polite">${formatTime(state.timer.left)}</p>
    <div class="seg">${[15, 25, 45].map((min) => `<button type="button" data-min="${min}" class="${state.timer.total === min * 60 ? "on" : ""}">${min} min</button>`).join("")}</div>
    <div class="actions"><button type="button" class="primary" id="timerToggle">${state.timer.running ? "Pause" : "Start"}</button><button type="button" id="timerReset">Reset</button></div>
    <p class="hint">The timer stays on this phone. Finishing it sends only “focus complete”.</p></section>`;
}

function teamHtml() {
  const profile = state.profile;
  const team = profile.team;
  const name = `<label>Name on the team board<input id="displayName" maxlength="24" value="${esc(profile.displayName || "")}" placeholder="Optional, 24 characters"></label><button type="button" id="saveName">Save name</button><p class="hint">Your team and the app owner can see this name. Do not put an email or health notes here.</p>`;
  if (!team) {
    return `<section class="card"><h2>Team quests</h2><p class="sub">For a couple or a family. Share the code. The server stores the code and scores, not your sheet.</p><div class="actions"><button type="button" class="primary" id="createTeam">Create a team</button></div><label>Join with a code<input id="joinCode" autocapitalize="characters" maxlength="8"></label><button type="button" id="joinTeam">Join</button></section><section class="card">${name}</section>`;
  }
  const members = team.members.map((member) => `<div class="member"><span>${esc(member.displayName || member.tag)}${member.you ? " · you" : ""}</span><span class="meta">#${member.rank || "-"} · Lv ${member.level} · ${member.xp} XP · ${member.streak} streak</span></div>`).join("");
  const quests = team.quests.map((quest) => `<li class="quest ${quest.done ? "done" : ""}"><div><strong>${esc(quest.title)}</strong><span class="sub">${esc(quest.detail)}</span><span class="meta">${quest.have}/${quest.need}</span></div></li>`).join("");
  const challenge = team.challenge ? `<p class="sub">${esc(team.challenge.detail)} ${team.challenge.have}/${team.challenge.need}${team.challenge.done ? " · done" : ""}</p>` : "";
  const duel = profile.duel;
  const duelText = duel
    ? `<p>Duel ${esc(duel.status)}. ${duel.winnerId ? (duel.winnerId === profile.id ? "You won." : "Your teammate won.") : "Finish today's session. More steps wins."}</p>`
    : `<button type="button" id="startDuel">Friendly duel</button><p class="hint">Both finish today's session. The higher step count wins XP and a title. No prizes you can spend.</p>`;
  return `<section class="card"><h2>Team ${esc(team.id)}</h2><p class="hint">Share this code with your household.</p><button type="button" id="copyCode">Copy code</button><button type="button" id="confirmTeam">Confirm the team showed up</button>${challenge}<div class="card">${duelText}</div><p class="hint">One confirmation a day. It adds bonus XP for teammates who already finished a quest. It does not send what anyone ate or did.</p><ul class="quests">${quests}</ul>${members}</section><section class="card">${name}</section>`;
}

function sheetHtml() {
  const ready = clientIdReady(config.googleClientId);
  const log = state.rows.filter((row) => String(row.date).slice(0, 10) === localDay()).slice(0, 30);
  const people = [`<option value="">Everyone in the sheet</option>`].concat(state.people.map((name) => `<option value="${esc(name)}" ${name === state.person ? "selected" : ""}>${esc(name)}</option>`)).join("");
  const write = state.sheetMode === "google" || state.sheetMode === "practice";
  const form = write ? `<form id="quickLog"><label>Quick add on this device<input name="text" required maxlength="200" placeholder="Oatmeal, or Workout: walk"></label><label>Person<input name="person" maxlength="40" value="${esc(state.person || "")}"></label><label>Calories, optional<input name="calories" inputmode="numeric" maxlength="6"></label><label class="hint"><input type="checkbox" id="photoProof" ${state.photoProof ? "checked" : ""}> A photo is in my Google Drive. Fit does not upload it.</label><button type="submit" class="primary">Add to ${state.sheetMode === "google" ? "your sheet" : "practice log"}</button><p class="hint">The words stay in your sheet or on this phone. The server gets a count, plus a yes/no if you checked the photo box. Typed counts earn half XP.</p></form>` : `<p class="hint">A shared view link is read-only. Sign in with Google to write, or use practice mode.</p>`;
  return `<section class="card"><h2>Your sheet</h2><p class="sub">Permission asked from Google: ${esc(SHEETS_SCOPE)}. That is drive.file: only a sheet this app creates, or one you pick.</p>
    <p class="meta">${esc(state.sheetStatus || modeLabel())}</p>
    <div class="actions"><button type="button" class="primary" id="googleSign">${ready ? "Sign in with Google" : "Google sign-in needs a client id"}</button>
    ${state.googleToken ? `<button type="button" id="createSheet">Create my sheet</button><button type="button" id="pickSheet">Choose a sheet</button>` : ""}</div>
    ${ready ? "" : `<p class="hint">Brian: paste the OAuth client id into config.js. Until then, paste a view link or use practice mode. The sign-in button is already wired to the narrow drive.file scope.</p>`}
    <form id="linkForm"><label>Or paste a view link<input name="url" type="url" placeholder="https://docs.google.com/spreadsheets/..." value="${esc(state.sheetUrl)}"></label><button type="submit">Use view link</button></form>
    <button type="button" id="practice">Practice on this phone</button>
    ${state.sheetMode ? `<label>Count quests for<select id="person">${people}</select></label>` : ""}
    ${state.sheetId ? `<p><a href="https://docs.google.com/spreadsheets/d/${esc(state.sheetId)}/edit" target="_blank" rel="noopener">Open the sheet</a></p>` : ""}
    <button type="button" id="disconnect">Disconnect</button></section>
    <section class="card">${form}<ul class="log">${log.map((row) => `<li><b>${esc(row.text)}</b> <span class="meta">${esc(row.person)} ${esc(row.time)}</span></li>`).join("") || `<li class="meta">Nothing for today yet.</li>`}</ul></section>
    <p class="hint">Classic dashboards: <a href="solo.html">Solo</a> · <a href="dashboard.html">Couple</a> · <a href="family.html">Family</a>. A private Google sheet will not load there until you share it as anyone with the link can view.</p>`;
}

function modeLabel() {
  if (state.sheetMode === "google") return "Connected with Google. The sheet stays private to your account.";
  if (state.sheetMode === "link") return "Reading a shared view link. Fit does not store the link on a server.";
  if (state.sheetMode === "practice") return "Practice log on this phone only.";
  return "No sheet yet.";
}

function moreHtml() {
  const recipes = RECIPES.map((recipe) => `<li class="quest"><div><strong>${esc(recipe.name)}</strong><span class="sub">${esc(recipe.note)}</span><span class="meta">${recipe.kcal} kcal per serving · estimate</span></div><button type="button" data-recipe="${esc(recipe.id)}">Log</button></li>`).join("");
  const badges = state.profile
    ? `<p><strong>${esc(state.profile.title || "Rookie")}</strong></p><p>${(state.profile.badges || []).map((badge) => `<span class="level">${esc(badge.title)}</span>`).join(" ") || "No badges yet."}</p><p class="hint">${esc(state.profile.rewards || "Badges and titles only. No discounts, vouchers, or shop rewards.")}</p>`
    : "";
  const measures = (state.measures || []).slice(-8).map((row) => `<li>${esc(row.day)} · ${esc(row.weight || "—")} kg · waist ${esc(row.waist || "—")} cm</li>`).join("");
  const photos = ["day1", "day66"].map((slot) => `<figure><figcaption>${slot === "day1" ? "Day 1" : "Day 66"}</figcaption>${state.photoUrls[slot] ? `<img class="shot" alt="" src="${state.photoUrls[slot]}">` : `<p class="hint">No photo on this phone</p>`}<input type="file" accept="image/*" data-photo="${slot}"></figure>`).join("");
  return `${voucherSection()}<section class="card"><h2>Recipes</h2><p class="hint">One tap writes the plate to your sheet or practice log. Fit's server only hears that a recipe was used, not which one.</p><ul class="quests">${recipes}</ul></section>
    <section class="card"><h2>Badges</h2>${badges}</section>
    <section class="card"><h2>Progress</h2><p class="hint">Weight, waist, and photos stay on this phone. Water, sleep, and steps are manual for now. The step quest is ready for a phone health app later.</p>
      <form id="measureForm"><label>Weight kg<input name="weight" inputmode="decimal"></label><label>Waist cm<input name="waist" inputmode="decimal"></label><button type="submit">Save on this phone</button></form>
      <ul class="log">${measures || `<li class="meta">No measurements yet.</li>`}</ul>
      <div class="pair">${photos}</div></section>
    <section class="card"><h2>Weekly coach</h2><p class="hint">Your own key, once a week. The server asks the coach using your level, streak, and plan name only. The key and the reply are not stored.</p>
      <label>AI key<input id="aiKey" type="password" autocomplete="off"></label>
      <label>Host<select id="aiHost"><option value="api.openai.com">OpenAI</option><option value="api.groq.com">Groq</option></select></label>
      <button type="button" id="coachBtn">Check in</button>
      ${state.coachReply ? `<p>${esc(state.coachReply)}</p>` : ""}</section>
    ${sheetHtml()}`;
}

function shell(screen) {
  const level = state.profile ? state.profile.level : 1;
  const parts = {
    today: state.profile ? todayHtml() : "",
    path: state.profile ? pathHtml() : "",
    focus: focusHtml(),
    team: state.profile ? teamHtml() : "",
    shop: shopHtml(state, esc),
    more: moreHtml(),
  };
  const problem = state.loading
    ? `<p class="banner">Loading your game…</p>`
    : (!state.profile && screen !== "more" && screen !== "focus" ? `<p class="banner bad">${esc(state.error || "The game server is not running.")}</p><button type="button" id="retry">Try again</button>` : (state.error ? `<p class="banner bad">${esc(state.error)}</p>` : ""));
  return `<div class="app"><header class="top"><div class="brand"><a href="index.html">Fit</a></div><span class="level">LV ${level}</span>${flame()}</header>${problem}${parts[screen] || ""}<p class="foot">Not medical advice. Food and workouts stay in your sheet. <a href="admin.html">Owner</a></p></div>
    <nav class="nav ${navClass()}">${screenList().map((name) => `<a href="#${name}" class="${screen === name ? "on" : ""}">${name[0].toUpperCase()}${name.slice(1)}</a>`).join("")}</nav>`;
}

function rememberVoucherCodes(codes) {
  if (!codes || !codes.length) return;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("fitVoucherCodes") || "{}"); } catch { saved = {}; }
  for (const item of codes) if (item && item.code) saved[item.id] = item.code;
  localStorage.setItem("fitVoucherCodes", JSON.stringify(saved));
}

function voucherSection() {
  const profile = state.profile;
  if (!profile || profile.vouchersEnabled !== true) return "";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("fitVoucherCodes") || "{}"); } catch { saved = {}; }
  const cards = (profile.vouchers || []).map((item) => {
    const code = saved[item.id] || "";
    const qr = code && item.status === "issued" ? voucherQr(code) : "";
    return `<article class="card"><p><strong>${esc(profile.voucherLabel || "value")} ${item.value}</strong> · ${esc(item.status)}</p><p class="meta">${esc(item.milestone)} · until ${esc(item.expiresDay)}</p>${qr}${code ? `<p class="id">${esc(code)}</p>` : `<p class="hint">The code was saved on the phone that earned this.</p>`}</article>`;
  }).join("");
  return `<section><h2>Restaurant vouchers</h2><p class="hint">Separate from SOSM+. One use. Show the code at the restaurant. Streaks unlock them. Level rewards also need a verified timer, photo, or future health-app day.</p>${cards || `<p class="hint">None yet.</p>`}</section>`;
}

function render() {
  if (state.profile && state.profile.voucherCodes) {
    rememberVoucherCodes(state.profile.voucherCodes);
    state.profile.voucherCodes = [];
  }
  const app = document.getElementById("app");
  if (!app) return;
  const screen = screenNow();
  app.innerHTML = shell(screen);
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };
  on("retry", () => boot());
  document.querySelectorAll("[data-diff]").forEach((button) => {
    button.addEventListener("click", () => run(() => setDifficulty(button.getAttribute("data-diff"))));
  });
  document.querySelectorAll("[data-check]").forEach((button) => {
    button.addEventListener("click", () => run(() => checkQuest(button.getAttribute("data-check"))));
  });
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => run(() => addCount(button.getAttribute("data-add"))));
  });
  document.querySelectorAll("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => run(() => refreshSheet()));
  });
  document.querySelectorAll("[data-min]").forEach((button) => {
    button.addEventListener("click", () => {
      const minutes = Number(button.getAttribute("data-min"));
      state.timer.total = minutes * 60;
      state.timer.left = state.timer.total;
      state.timer.running = false;
      render();
    });
  });
  on("timerToggle", () => {
    if (state.timer.running) {
      state.timer.running = false;
      state.timer.left = Math.max(0, Math.round((state.timer.endsAt - Date.now()) / 1000));
    } else {
      if (state.timer.left <= 0) state.timer.left = state.timer.total;
      state.timer.endsAt = Date.now() + state.timer.left * 1000;
      state.timer.running = true;
    }
    render();
  });
  on("timerReset", () => {
    state.timer.running = false;
    state.timer.left = state.timer.total;
    render();
  });
  on("createTeam", () => run(async () => {
    state.profile = await api.createTeam(state.token, localDay());
  }));
  on("joinTeam", () => run(async () => {
    const code = document.getElementById("joinCode").value;
    state.profile = await api.joinTeam(state.token, code, localDay());
  }));
  on("confirmTeam", () => run(async () => {
    state.profile = await api.confirmTeam(state.token, localDay());
    return "Team confirmation sent.";
  }));
  on("startDuel", () => run(async () => {
    state.profile = await api.duel(state.token, localDay());
    return "Duel started. Finish today's session.";
  }));
  on("saveSteps", () => run(async () => {
    const raw = Number(document.getElementById("stepsInput").value);
    if (!Number.isInteger(raw) || raw < 0 || raw > 100000) throw new Error("Enter a whole step count up to 100000.");
    state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [{ questId: "steps", count: raw, source: "manual" }]);
  }));
  on("printCert", () => window.print());
  on("coachBtn", () => run(async () => {
    const key = document.getElementById("aiKey").value.trim();
    const host = document.getElementById("aiHost").value;
    localStorage.setItem("fitAiKey", key);
    localStorage.setItem("fitAiHost", host);
    const result = await api.coach(state.token, localDay(), key, host);
    state.coachReply = result.reply || "";
    state.profile = result;
  }));
  document.querySelectorAll("[data-program]").forEach((button) => {
    button.addEventListener("click", () => run(async () => {
      state.profile = await api.program(state.token, button.getAttribute("data-program"), localDay());
    }));
  });
  bindShop({ state, config, run, render });
  document.querySelectorAll("[data-recipe]").forEach((button) => {
    button.addEventListener("click", () => run(() => logRecipe(button.getAttribute("data-recipe"))));
  });
  const measure = document.getElementById("measureForm");
  if (measure) measure.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(measure);
    state.measures = saveMeasurement({
      day: localDay(),
      weight: String(data.get("weight") || "").trim(),
      waist: String(data.get("waist") || "").trim(),
    });
    render();
  });
  document.querySelectorAll("[data-photo]").forEach((input) => {
    input.addEventListener("change", () => run(async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const blob = await shrinkPhoto(file);
      const slot = input.getAttribute("data-photo");
      await savePhoto(slot, blob);
      if (state.photoUrls[slot]) URL.revokeObjectURL(state.photoUrls[slot]);
      state.photoUrls[slot] = URL.createObjectURL(blob);
      if (state.token) {
        state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [{ questId: "progress_photo", completed: true, source: "photo", hasProof: true }]);
      }
      return "Photo saved on this phone. It was not uploaded to Fit.";
    }));
  });
  const aiKey = document.getElementById("aiKey");
  if (aiKey) aiKey.value = localStorage.getItem("fitAiKey") || "";
  const aiHost = document.getElementById("aiHost");
  if (aiHost) aiHost.value = localStorage.getItem("fitAiHost") || "api.openai.com";
  on("copyCode", () => run(async () => {
    await navigator.clipboard.writeText(state.profile.team.id);
    state.sheetStatus = "Team code copied.";
  }));
  on("saveName", () => run(async () => {
    const name = document.getElementById("displayName").value;
    state.profile = await api.profile(state.token, name, localDay());
  }));
  on("googleSign", () => run(async () => {
    state.googleToken = await requestGoogleToken(config);
    state.sheetStatus = "Signed in with Google. Create a sheet, or pick one.";
    if (state.sheetMode === "google" && state.sheetId) {
      state.rows = await readLog(state.googleToken, state.sheetId);
      state.people = peopleIn(state.rows);
      await pushCounts();
    }
  }));
  on("createSheet", () => run(async () => {
    const created = await createSheet(state.googleToken);
    state.sheetMode = "google";
    state.sheetId = created.id;
    state.sheetUrl = created.url;
    state.rows = [];
    state.people = [];
    state.sheetStatus = "New private sheet created in your Google Drive.";
    rememberSheet();
    await pushCounts();
  }));
  on("pickSheet", () => run(async () => {
    const id = await pickSheet(config, state.googleToken);
    state.sheetMode = "google";
    state.sheetId = id;
    state.sheetUrl = "https://docs.google.com/spreadsheets/d/" + id + "/edit";
    state.rows = await readLog(state.googleToken, id);
    state.people = peopleIn(state.rows);
    if (!state.person && state.people[0]) state.person = state.people[0];
    state.sheetStatus = "Using the sheet you picked.";
    rememberSheet();
    await pushCounts();
  }));
  const linkForm = document.getElementById("linkForm");
  if (linkForm) linkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async () => {
      const url = new FormData(linkForm).get("url");
      const id = sheetIdFromUrl(url);
      if (!id) throw new Error("That does not look like a Google Sheets link.");
      state.rows = await fetchLinkLog(id);
      state.sheetMode = "link";
      state.sheetId = id;
      state.sheetUrl = String(url);
      state.people = peopleIn(state.rows);
      if (!state.person && state.people.length === 1) state.person = state.people[0];
      state.sheetStatus = "Reading the shared view link in this browser.";
      rememberSheet();
      await pushCounts();
    });
  });
  on("practice", () => run(async () => {
    state.sheetMode = "practice";
    state.sheetId = "";
    state.sheetUrl = "";
    state.rows = loadPractice();
    state.people = peopleIn(state.rows);
    state.sheetStatus = "Practice log stays on this phone.";
    rememberSheet();
    await pushCounts();
  }));
  const person = document.getElementById("person");
  if (person) person.addEventListener("change", () => run(async () => {
    state.person = person.value;
    store("fitPerson", state.person);
    await pushCounts();
  }));
  on("disconnect", () => run(async () => {
    state.sheetMode = "";
    state.sheetId = "";
    state.sheetUrl = "";
    state.rows = [];
    state.people = [];
    state.googleToken = "";
    state.sheetStatus = "Disconnected on this phone. Your Google file was not deleted.";
    rememberSheet();
  }));
  const photo = document.getElementById("photoProof");
  if (photo) photo.addEventListener("change", () => {
    state.photoProof = photo.checked;
  });
  const quick = document.getElementById("quickLog");
  if (quick) quick.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(quick);
    run(() => addRow({
      text: String(data.get("text") || "").trim(),
      person: String(data.get("person") || "").trim(),
      calories: String(data.get("calories") || "").trim(),
    }));
  });
}

async function setDifficulty(level) {
  state.profile = await api.events(state.token, localDay(), level, []);
}

async function checkQuest(questId) {
  state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [{ questId, completed: true, source: "manual" }]);
}

async function addCount(questId) {
  const quest = state.profile.quests.find((item) => item.id === questId);
  const next = Math.min(20, (quest ? quest.count : 0) + 1);
  state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [{ questId, count: next, source: "manual" }]);
}

async function refreshSheet() {
  if (state.sheetMode === "link") state.rows = await fetchLinkLog(state.sheetId);
  else if (state.sheetMode === "google") {
    if (!state.googleToken) throw new Error("Sign in with Google again to refresh this private sheet.");
    state.rows = await readLog(state.googleToken, state.sheetId);
  } else if (state.sheetMode === "practice") state.rows = loadPractice();
  state.people = peopleIn(state.rows);
  await pushCounts();
}

async function addRow(row) {
  if (!row.text) throw new Error("Write what you want to log.");
  const now = new Date();
  const entry = {
    date: localDay(now),
    time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
    person: row.person || state.person || "Me",
    text: row.text,
    calories: row.calories,
    workout: /^workout\b/i.test(row.text),
  };
  if (state.sheetMode === "link") throw new Error("A view link is read-only. Use practice mode or Google sign-in to log.");
  if (state.sheetMode === "google") {
    if (!state.googleToken) throw new Error("Sign in with Google again.");
    await appendLog(state.googleToken, state.sheetId, entry);
    state.rows = await readLog(state.googleToken, state.sheetId);
  } else {
    if (!state.sheetMode) state.sheetMode = "practice";
    state.rows = loadPractice().concat([entry]);
    savePractice(state.rows);
  }
  state.people = peopleIn(state.rows);
  if (!state.person) state.person = entry.person;
  rememberSheet();
  await pushCounts();
  if (!rowCountsForScore(entry)) {
    return "That number looks too high to count for XP. It stays on this phone and was not sent.";
  }
}

async function logRecipe(id) {
  const recipe = RECIPES.find((item) => item.id === id);
  if (!recipe) throw new Error("That recipe is missing.");
  const notice = await addRow({ text: recipe.name, calories: String(recipe.kcal), person: state.person || "Me" });
  state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [guidedLogEvent()]);
  return notice;
}

async function finishFocus() {
  if (!state.token || !state.profile) return;
  try {
    state.profile = await api.events(state.token, localDay(), state.profile.difficulty, [{
      questId: "focus",
      completed: true,
      source: "timer",
      durationMin: Math.round(state.timer.total / 60),
    }]);
    state.error = "";
  } catch (err) {
    state.error = err.message || "The focus block finished, but the server did not get it.";
  }
  render();
}

async function boot() {
  state.loading = true;
  state.error = "";
  render();
  try {
    state.measures = loadMeasurements();
    for (const slot of ["day1", "day66"]) {
      const blob = await loadPhoto(slot).catch(() => null);
      if (blob) state.photoUrls[slot] = URL.createObjectURL(blob);
    }
    await ensureSession();
    await restoreSheet();
    if (state.sheetMode) await pushCounts();
    if (!state.profile) state.profile = await api.me(state.token, localDay());
  } catch (err) {
    state.error = err.message || "The game server is not running.";
  } finally {
    state.loading = false;
    render();
  }
}

setInterval(() => {
  if (!state.timer.running) return;
  const left = Math.max(0, Math.round((state.timer.endsAt - Date.now()) / 1000));
  state.timer.left = left;
  const clock = document.getElementById("clock");
  if (clock) clock.textContent = formatTime(left);
  if (left <= 0) {
    state.timer.running = false;
    finishFocus();
  }
}, 250);

window.addEventListener("hashchange", render);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
