import assert from "node:assert/strict";
import test from "node:test";
import { buildEventsPayload, countToday, countsPayload, parseCsv, rowCountsForScore, rowsFromTable } from "../src/web/summary.js";

const csv = `Date,Time,Person,Food/Workout,Calories (kcal)
2026-11-13,08:00,Ari,"Chicken, rice",500
2026-11-13,12:00,Sam,Soup,200
2026-11-13,18:00,Ari,Workout: run,180
`;

test("sheet rows become counts and the payload has no food text", () => {
  const rows = rowsFromTable(parseCsv(csv));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].text.includes("Chicken"), true);
  const counts = countToday(rows, "Ari", "2026-11-13");
  assert.deepEqual(counts, { meals: 1, workouts: 1 });
  const payload = countsPayload("2026-11-13", "normal", counts);
  const encoded = JSON.stringify(payload);
  assert.equal(encoded.includes("Chicken"), false);
  assert.equal(encoded.includes("Soup"), false);
  assert.equal(encoded.includes("run"), false);
  assert.deepEqual(payload.events, [
    { questId: "log_meals", count: 1, source: "manual" },
    { questId: "log_workout", count: 1, source: "manual" },
  ]);
});

test("quest payload drops anything that is not a count or a flag", () => {
  const payload = buildEventsPayload("2026-11-13", "hard", [
    { questId: "water", completed: true, food: "rice", note: "salty", weight: 70 },
  ]);
  assert.deepEqual(payload, {
    day: "2026-11-13",
    difficulty: "hard",
    events: [{ questId: "water", completed: true, source: "manual" }],
  });
  assert.throws(() => buildEventsPayload("2026-11-13", "normal", [{ questId: "ate-nasi", completed: true }]));
  const absurd = {
    date: "2026-11-13",
    person: "Ari",
    text: "Workout: 900 min",
    calories: "9000",
    workout: true,
  };
  assert.equal(rowCountsForScore(absurd), false);
  assert.equal(countToday([absurd], "Ari", "2026-11-13").workouts, 0);
  const proof = countsPayload("2026-11-13", "normal", { meals: 1, workouts: 0 }, { hasProof: true });
  assert.equal(proof.events[0].source, "photo");
  assert.equal(proof.events[0].hasProof, true);
  assert.equal(JSON.stringify(proof).includes("9000"), false);
});
