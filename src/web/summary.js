// Turns a sheet into counts. Food text never leaves this module's count helpers.

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = String(text || "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      if (quoted && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

export function rowsFromTable(table) {
  if (!table || !table.length) return [];
  const headers = table[0].map((value) => String(value || "").trim());
  const hasHeader = headers.some((value) => /date/i.test(value));
  const start = hasHeader ? 1 : 0;
  const idx = hasHeader
    ? {
        date: headers.findIndex((value) => /date/i.test(value)),
        time: headers.findIndex((value) => /time/i.test(value)),
        person: headers.findIndex((value) => /person/i.test(value)),
        text: headers.findIndex((value) => /food|workout/i.test(value)),
      }
    : { date: 0, time: 1, person: 2, text: 3 };
  const rows = [];
  for (let i = start; i < table.length; i++) {
    const line = table[i];
    const text = String(idx.text >= 0 ? line[idx.text] || "" : "").trim();
    const date = String(idx.date >= 0 ? line[idx.date] || "" : "").trim();
    if (!text && !date) continue;
    rows.push({
      date,
      time: String(idx.time >= 0 ? line[idx.time] || "" : "").trim(),
      person: String(idx.person >= 0 ? line[idx.person] || "" : "").trim(),
      text,
      workout: /^workout\b/i.test(text),
    });
  }
  return rows;
}

// A typed calorie or duration that cannot be real does not count. The number stays here.
export function rowCountsForScore(row) {
  if (row.calories != null && String(row.calories).trim() !== "") {
    const n = Number(String(row.calories).replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 4000) return false;
  }
  const mins = /(\d{1,5})\s*(min|mins|minutes|hour|hours|hr)\b/i.exec(row.text || "");
  if (mins) {
    let n = Number(mins[1]);
    if (/hour|hr/i.test(mins[2])) n *= 60;
    if (n < 1 || n > 180) return false;
  }
  return true;
}

export function countToday(rows, person, day) {
  let meals = 0;
  let workouts = 0;
  for (const row of rows || []) {
    if (String(row.date || "").slice(0, 10) !== day) continue;
    if (person && row.person && row.person !== person) continue;
    if (!rowCountsForScore(row)) continue;
    if (row.workout) workouts += 1;
    else if (row.text) meals += 1;
  }
  return { meals, workouts };
}

export function peopleIn(rows) {
  const names = [];
  for (const row of rows || []) {
    if (row.person && !names.includes(row.person)) names.push(row.person);
  }
  return names;
}

const QUESTS = new Set(["log_meals", "log_workout", "water", "sleep", "focus"]);
const SOURCES = new Set(["manual", "timer", "photo", "wearable"]);
const EVENT_KEYS = new Set(["questId", "count", "completed", "source", "hasProof", "durationMin"]);

// Rebuilds the only object the game server is allowed to see.
export function buildEventsPayload(day, difficulty, events) {
  const payload = {
    day,
    events: (events || []).map((event) => {
      const item = { questId: event.questId, source: SOURCES.has(event.source) ? event.source : "manual" };
      if (Number.isInteger(event.count)) item.count = event.count;
      if (typeof event.completed === "boolean") item.completed = event.completed;
      if (event.hasProof === true) item.hasProof = true;
      if (Number.isInteger(event.durationMin)) item.durationMin = event.durationMin;
      return item;
    }),
  };
  if (difficulty) payload.difficulty = difficulty;
  const top = Object.keys(payload).sort().join(",");
  if (top !== "day,difficulty,events" && top !== "day,events") throw new Error("Unexpected quest payload.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.day)) throw new Error("Bad day.");
  if (payload.difficulty && !["easy", "normal", "hard"].includes(payload.difficulty)) {
    throw new Error("Bad difficulty.");
  }
  for (const event of payload.events) {
    for (const key of Object.keys(event)) {
      if (!EVENT_KEYS.has(key)) throw new Error("Unexpected quest field.");
    }
    if (!QUESTS.has(event.questId)) throw new Error("Unexpected quest.");
    if (!SOURCES.has(event.source)) throw new Error("Unexpected source.");
    if ("count" in event && !Number.isInteger(event.count)) throw new Error("Bad count.");
    if ("completed" in event && typeof event.completed !== "boolean") throw new Error("Bad flag.");
  }
  return payload;
}

export function countsPayload(day, difficulty, counts, extra = {}) {
  const source = extra.hasProof ? "photo" : (extra.source || "manual");
  const meal = { questId: "log_meals", count: counts.meals, source };
  const workout = { questId: "log_workout", count: counts.workouts, source };
  if (extra.hasProof) {
    meal.hasProof = true;
    workout.hasProof = true;
  }
  return buildEventsPayload(day, difficulty, [meal, workout]);
}
