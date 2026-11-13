import { parseMealText } from "./foods.js";
import { matchFaq } from "./knowledge.js";

const CONSENT = "fitGeminiConsent";
const TARGETS = { kcal: 2000, protein: 90, carbs: 220, fat: 60 };

const LABELS = {
  food_photo: "food photos",
  text_log: "text logs",
  recommend: "recommendations",
  chat: "chat replies",
};

export function consentGiven() {
  return localStorage.getItem(CONSENT) === "yes";
}

export function acceptConsent() {
  localStorage.setItem(CONSENT, "yes");
}

function remaining(rows, day) {
  const used = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const row of rows || []) {
    if (String(row.date || "").slice(0, 10) !== day) continue;
    if (row.workout) continue;
    used.kcal += Number(row.calories) || 0;
    used.protein += Number(row.protein) || 0;
    used.carbs += Number(row.carbs) || 0;
    used.fat += Number(row.fat) || 0;
  }
  return {
    kcal: Math.max(0, TARGETS.kcal - used.kcal),
    protein: Math.max(0, TARGETS.protein - used.protein),
    carbs: Math.max(0, TARGETS.carbs - used.carbs),
    fat: Math.max(0, TARGETS.fat - used.fat),
  };
}

function quotaLine(quota) {
  if (!quota) return "Assistant counts load with your game.";
  if (quota.premium) return "Premium: no daily cap. Fit still does not store the messages.";
  return (quota.features || []).map((item) => {
    const name = LABELS[item.feature] || item.feature;
    return `${item.left} ${name} left`;
  }).join(" · ");
}

function notice() {
  return `<p class="hint">Fit sends assistant requests through our server to Google Gemini. FitCouple does not store the photo, the meal text, or the reply. Google processes them under Google's terms, and on the free tier Google may use that content to improve Google's products. Not medical advice.</p>`;
}

export function assistHtml(state, day, esc) {
  if (!consentGiven()) {
    return `<section class="card"><h2>Assistant</h2>${notice()}<button type="button" id="aiConsent" class="primary">I understand, continue</button></section>`;
  }
  const left = remaining(state.rows, day);
  const draft = (state.aiDraft || []).map((item, index) => `<label>${esc(item.name)}<input data-ai-field="name" data-ai-index="${index}" value="${esc(item.name)}"></label><label>Portion<input data-ai-field="portion" data-ai-index="${index}" value="${esc(item.portion || "")}"></label><label>kcal<input data-ai-field="kcal" data-ai-index="${index}" value="${esc(item.kcal)}"></label><label>Protein<input data-ai-field="protein" data-ai-index="${index}" value="${esc(item.protein)}"></label><label>Carbs<input data-ai-field="carbs" data-ai-index="${index}" value="${esc(item.carbs)}"></label><label>Fat<input data-ai-field="fat" data-ai-index="${index}" value="${esc(item.fat)}"></label>`).join("");
  return `<section class="card"><h2>Assistant</h2>${notice()}<p class="meta">${esc(quotaLine(state.aiQuota))}</p>
    <p class="meta">About ${left.kcal} kcal left today, from a general 2000 kcal sketch on this phone. P ${left.protein} · C ${left.carbs} · F ${left.fat}.</p>
    <label>Describe a meal<input id="foodText" maxlength="400" placeholder="two slices of bread and an egg"></label>
    <div class="actions"><button type="button" id="foodAsk">Estimate</button><label class="ghost">Photo of food<input id="foodPhoto" type="file" accept="image/*" capture="environment"></label></div>
    <div class="actions"><button type="button" id="mealAsk">Meal ideas</button><button type="button" id="workoutAsk">Workout idea</button></div>
    ${draft ? `<form id="aiConfirm">${draft}<button type="submit" class="primary">Save to my sheet</button><p class="hint">Nothing is saved until you confirm. The words go to your sheet or this phone, not to Fit's database.</p></form>` : ""}
    ${state.aiNote ? `<p>${esc(state.aiNote)}</p>` : ""}
    </section>`;
}

export function chatHtml(state, esc) {
  if (!consentGiven()) return "";
  const lines = (state.aiChat || []).map((line) => `<p><strong>${line.role === "you" ? "You" : "Assistant"}.</strong> ${esc(line.text)}</p>`).join("");
  return `<section class="card"><h2>Questions</h2><p class="hint">Nutrition and exercise only. Not medical advice. Common answers stay on this phone. Other questions go to Gemini and are not stored here.</p>
    <p class="meta">${esc(quotaLine(state.aiQuota))}</p>
    ${lines}
    <label>Question<input id="chatText" maxlength="500"></label>
    <button type="button" id="chatAsk">Ask</button></section>`;
}

async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bindAssist(ctx) {
  const { state, api, render, run, day, saveItems } = ctx;
  const consent = document.getElementById("aiConsent");
  if (consent) consent.addEventListener("click", () => {
    acceptConsent();
    render();
  });
  async function refreshQuota() {
    if (!state.token) return;
    state.aiQuota = await api.aiQuota(state.token);
  }
  const estimate = document.getElementById("foodAsk");
  if (estimate) estimate.addEventListener("click", () => run(async () => {
    const text = document.getElementById("foodText").value.trim();
    const local = parseMealText(text);
    if (local.complete) {
      state.aiDraft = local.items;
      state.aiNote = "Matched on this phone. No assistant call.";
      return "";
    }
    const result = await api.aiFoodText(state.token, text);
    state.aiDraft = result.items || [];
    state.aiNote = result.notice || "";
    await refreshQuota();
  }));
  const photo = document.getElementById("foodPhoto");
  if (photo) photo.addEventListener("change", () => run(async () => {
    const file = photo.files && photo.files[0];
    if (!file) return;
    const image = await shrinkPhoto(file);
    const result = await api.aiFoodPhoto(state.token, image);
    state.aiDraft = result.items || [];
    state.aiNote = result.notice || "";
    await refreshQuota();
  }));
  const meals = document.getElementById("mealAsk");
  if (meals) meals.addEventListener("click", () => run(async () => {
    const left = remaining(state.rows, day());
    const result = await api.aiMeals(state.token, left);
    state.aiDraft = result.meals || [];
    state.aiNote = result.notice || "";
    await refreshQuota();
  }));
  const workout = document.getElementById("workoutAsk");
  if (workout) workout.addEventListener("click", () => run(async () => {
    const profile = state.profile || {};
    const result = await api.aiWorkout(state.token, {
      level: profile.level || 1,
      streak: profile.streak || 0,
      plan: profile.programChoice || "",
      quests: (profile.quests || []).map((quest) => quest.id),
    });
    state.aiNote = `${result.notice || ""} ${result.session || ""} ${result.notes || ""}`.trim();
    await refreshQuota();
  }));
  const form = document.getElementById("aiConfirm");
  if (form) form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = (state.aiDraft || []).map((item, index) => {
      const read = (field) => {
        const input = form.querySelector(`[data-ai-field="${field}"][data-ai-index="${index}"]`);
        return input ? input.value : item[field];
      };
      return {
        name: read("name"),
        portion: read("portion"),
        kcal: Number(read("kcal")) || 0,
        protein: Number(read("protein")) || 0,
        carbs: Number(read("carbs")) || 0,
        fat: Number(read("fat")) || 0,
      };
    });
    run(async () => {
      await saveItems(next);
      state.aiDraft = null;
      return "Saved on your sheet or this phone.";
    });
  });
  const chat = document.getElementById("chatAsk");
  if (chat) chat.addEventListener("click", () => run(async () => {
    const text = document.getElementById("chatText").value.trim();
    if (!text) throw new Error("Write a question.");
    state.aiChat = (state.aiChat || []).concat([{ role: "you", text }]);
    const known = matchFaq(text);
    if (known) {
      state.aiChat = state.aiChat.concat([{ role: "assistant", text: `Not medical advice. ${known.en} ${known.zh}` }]);
      return "";
    }
    const result = await api.aiChat(state.token, text);
    state.aiChat = state.aiChat.concat([{ role: "assistant", text: `${result.notice || "Not medical advice."} ${result.reply || ""}` }]);
    await refreshQuota();
  }));
}
