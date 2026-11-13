import { createApi } from "./api.js";

const config = window.FIT_GAME_CONFIG || { workerUrl: "http://127.0.0.1:8787" };
const api = createApi(config.workerUrl);
const KEY = "fitStaffKey";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const state = {
  key: sessionStorage.getItem(KEY) || "",
  message: "",
  ok: false,
};

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `<h1>Check a code</h1>
    <p class="hint">Staff only.</p>
    <form id="redeem" class="card">
      <label>Staff key<input id="staffKey" type="password" autocomplete="current-password"></label>
      <label>Voucher code<input id="code" autocomplete="off" autocapitalize="characters"></label>
      <div class="actions"><button type="submit">Check code</button><button type="button" id="scan">Scan QR</button></div>
      ${state.message ? `<p class="${state.ok ? "hint" : "bad"}">${esc(state.message)}</p>` : ""}
    </form>`;
  document.getElementById("staffKey").value = state.key;
  document.getElementById("redeem").addEventListener("submit", (event) => {
    event.preventDefault();
    state.key = document.getElementById("staffKey").value.trim();
    sessionStorage.setItem(KEY, state.key);
    submit(document.getElementById("code").value.trim());
  });
  document.getElementById("scan").addEventListener("click", scan);
}

async function submit(code) {
  if (!code) {
    state.ok = false;
    state.message = "Enter the code from the QR.";
    render();
    return;
  }
  try {
    await api.redeem(state.key, code);
    state.ok = true;
    state.message = "Redeemed. This code cannot be used again.";
  } catch (err) {
    state.ok = false;
    state.message = err.message || "Could not redeem.";
  }
  render();
}

async function scan() {
  if (!("BarcodeDetector" in window)) {
    state.ok = false;
    state.message = "This browser cannot scan. Type the code instead.";
    render();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
  let found = "";
  for (let i = 0; i < 40 && !found; i++) {
    const codes = await detector.detect(video);
    if (codes[0] && codes[0].rawValue) found = codes[0].rawValue;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stream.getTracks().forEach((track) => track.stop());
  if (!found) {
    state.ok = false;
    state.message = "No QR found. Type the code.";
    render();
    return;
  }
  state.key = document.getElementById("staffKey") ? document.getElementById("staffKey").value.trim() : state.key;
  await submit(found.trim());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
else render();
