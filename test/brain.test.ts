import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyEvents,
  badgesFor,
  checkinAllowed,
  explainFlags,
  pickDuelWinner,
  levelProgress,
  planFor,
  programPosition,
  progressStatus,
  viewQuests,
  visibleStreak,
  windowReport,
  type Player,
} from "../src/worker/brain.ts";
import { cleanDisplayName } from "../src/worker/privacy.ts";
import { SCHEMA_SQL, PHASE2_SQL } from "../src/worker/schema.ts";
import { sessionFor } from "../src/worker/programs.ts";
import { STORE_SQL, VOUCHER_SQL } from "../src/worker/schema.ts";
import { cleanShopeeUrl, hasHealthClaim, productFrom, readStoreConfig } from "../src/worker/store.ts";
import { milestoneReached, parseMilestones } from "../src/worker/vouchers.ts";

function player(over: Partial<Player> = {}): Player {
  return {
    xp: 0,
    level: 1,
    streak: 0,
    lastActiveDay: null,
    strength: 1,
    discipline: 1,
    health: 1,
    mind: 1,
    difficulty: "normal",
    programStart: "2026-11-01",
    ...over,
  };
}

test("migration SQL matches the worker schema", () => {
  const file = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  assert.equal(file.trim(), SCHEMA_SQL.trim());
});

test("level curve", () => {
  assert.deepEqual(levelProgress(0), { level: 1, xpIntoLevel: 0, xpToNext: 100 });
  assert.equal(levelProgress(99).level, 1);
  assert.deepEqual(levelProgress(100), { level: 2, xpIntoLevel: 0, xpToNext: 120 });
  assert.equal(levelProgress(220).level, 3);
  assert.equal(levelProgress(999999).level, 99);
});

test("day 1 and a later day of the 66-day plan differ", () => {
  const first = planFor(1);
  const later = planFor(8);
  assert.equal(first.title, "Week 1 · Show up");
  assert.equal(later.title, "Week 2 · Show up");
  assert.notEqual(first.title, later.title);
  const position = programPosition("2026-11-01", "2026-11-11");
  assert.equal(position.day, 11);
  assert.equal(position.dayOne.day, 1);
  assert.equal(position.current.day, 11);
  assert.equal(programPosition("2026-01-01", "2026-11-13").day, 66);
  assert.equal(programPosition("2026-01-01", "2026-11-13").complete, true);
});

test("normal meals need 2, award XP once, and a theme bonus applies on day 1", () => {
  const start = player({ programStart: "2026-11-13" });
  const first = applyEvents(start, [], [{ questId: "log_meals", count: 2, source: "manual" }], "2026-11-13");
  assert.equal(first.player.xp, 24);
  assert.equal(first.player.discipline, 2);
  assert.equal(first.player.streak, 1);
  assert.equal(first.player.lastActiveDay, "2026-11-13");
  const quest = viewQuests(first.player, first.completions, "2026-11-13").find((item) => item.id === "log_meals");
  assert.equal(quest && quest.done, true);
  const again = applyEvents(first.player, first.completions, [{ questId: "log_meals", count: 2 }], "2026-11-13");
  assert.equal(again.player.xp, 24);
});

test("easy hides workout from the daily clear, hard requires focus", () => {
  const easy = viewQuests(player({ difficulty: "easy" }), [], "2026-11-13");
  assert.equal(easy.find((quest) => quest.id === "log_workout")?.required, false);
  assert.equal(easy.find((quest) => quest.id === "log_meals")?.target, 1);
  const hard = viewQuests(player({ difficulty: "hard" }), [], "2026-11-13");
  assert.equal(hard.find((quest) => quest.id === "focus")?.required, true);
  assert.equal(hard.find((quest) => quest.id === "log_meals")?.target, 3);
});

test("daily clear bonus and attribute cap", () => {
  let result = applyEvents(player({ difficulty: "easy", programStart: "2026-11-13" }), [], [
    { questId: "log_meals", count: 1 },
    { questId: "water", completed: true },
  ], "2026-11-13", "easy");
  assert.equal(result.player.discipline >= 3, true);
  assert.equal(result.player.health, 2);
  assert.ok(result.completions.find((row) => row.questId === "daily_clear" && row.xpAwarded === 10));
  result = applyEvents(player({ strength: 99 }), [], [{ questId: "log_workout", count: 1 }], "2026-11-13");
  assert.equal(result.player.strength, 99);
});

test("streak continues, holds, and resets", () => {
  const day1 = applyEvents(player(), [{ questId: "water", count: 0, done: false, xpAwarded: 0 }], [{ questId: "water", completed: true }], "2026-11-01");
  assert.equal(day1.player.streak, 1);
  const day2 = applyEvents(day1.player, [], [{ questId: "water", completed: true }], "2026-11-02");
  assert.equal(day2.player.streak, 2);
  assert.equal(visibleStreak(day2.player.streak, day2.player.lastActiveDay, "2026-11-03"), 2);
  assert.equal(visibleStreak(day2.player.streak, day2.player.lastActiveDay, "2026-11-06"), 0);
  const later = applyEvents(day2.player, [], [{ questId: "water", completed: true }], "2026-11-06");
  assert.equal(later.player.streak, 1);
  const back = applyEvents(day2.player, [], [{ questId: "sleep", completed: true }], "2026-11-01");
  assert.equal(back.player.streak, 2);
  assert.equal(back.player.lastActiveDay, "2026-11-02");
});

test("unknown quest and bad count are rejected", () => {
  assert.throws(() => applyEvents(player(), [], [{ questId: "food", count: 1 }], "2026-11-13"), /Unknown quest/);
  assert.throws(() => applyEvents(player(), [], [{ questId: "log_meals", count: 1.5 }], "2026-11-13"), /count/);
});

test("display names are short labels", () => {
  assert.equal(cleanDisplayName("Aisyah"), "Aisyah");
  assert.equal(cleanDisplayName("  "), null);
  assert.throws(() => cleanDisplayName("a@b.com"), /email|notes/i);
  assert.throws(() => cleanDisplayName("https://example.com"), /email|notes/i);
});

test("XP windows and owner status", () => {
  const snaps = [
    { day: "2026-10-01", xp: 20, strength: 1, discipline: 1, health: 1, mind: 1 },
    { day: "2026-10-30", xp: 80, strength: 2, discipline: 2, health: 1, mind: 1 },
  ];
  const report = windowReport({ xp: 100, strength: 3, discipline: 2, health: 1, mind: 1 }, snaps, "2026-11-06");
  assert.equal(report.xp7, 20);
  assert.equal(report.xpPrev7, 60);
  assert.equal(report.hasPriorWindow, true);
  assert.equal(report.attributes.strength.delta7, 1);
  const slipping = progressStatus({
    today: "2026-11-06",
    lastActiveDay: "2026-11-06",
    programStart: "2026-10-01",
    xp7: report.xp7,
    xpPrev7: report.xpPrev7,
    hasPriorWindow: true,
  });
  assert.equal(slipping.status, "slipping");
  const improving = progressStatus({
    today: "2026-11-06",
    lastActiveDay: "2026-11-05",
    programStart: "2026-11-06",
    xp7: 40,
    xpPrev7: 0,
    hasPriorWindow: false,
  });
  assert.equal(improving.status, "improving");
  const inactive = progressStatus({
    today: "2026-11-13",
    lastActiveDay: "2026-11-01",
    programStart: "2026-11-01",
    xp7: 0,
    xpPrev7: 0,
    hasPriorWindow: true,
  });
  assert.equal(inactive.status, "inactive");
  const steadyNew = progressStatus({
    today: "2026-11-13",
    lastActiveDay: null,
    programStart: "2026-11-13",
    xp7: 0,
    xpPrev7: 0,
    hasPriorWindow: false,
  });
  assert.equal(steadyNew.status, "steady");
});

test("manual pays half, a real timer pays full, and a fake wearable does not", () => {
  const day = "2026-11-13";
  const manual = applyEvents(player({ programStart: day }), [], [{ questId: "focus", completed: true, source: "manual" }], day);
  const timer = applyEvents(player({ programStart: day }), [], [{ questId: "focus", completed: true, source: "timer", durationMin: 25 }], day);
  const wearable = applyEvents(player({ programStart: day }), [], [{ questId: "water", completed: true, source: "wearable" }], day);
  const typed = applyEvents(player({ programStart: day }), [], [{ questId: "water", completed: true, source: "manual" }], day);
  assert.ok(timer.player.xp > manual.player.xp);
  assert.equal(wearable.player.xp, typed.player.xp);
  const photo = applyEvents(player({ programStart: day }), [], [{ questId: "log_meals", count: 2, source: "photo", hasProof: true }], day);
  const typedMeals = applyEvents(player({ programStart: day }), [], [{ questId: "log_meals", count: 2 }], day);
  assert.ok(photo.player.xp > typedMeals.player.xp);
});

test("daily quest XP is capped and a streak still pays on top", () => {
  const day = "2026-11-13";
  const result = applyEvents(player({ difficulty: "hard", programStart: day }), [], [
    { questId: "log_meals", count: 3, source: "photo", hasProof: true },
    { questId: "log_workout", count: 1, source: "photo", hasProof: true },
    { questId: "water", completed: true, source: "manual" },
    { questId: "sleep", completed: true, source: "manual" },
    { questId: "focus", completed: true, source: "timer", durationMin: 25 },
  ], day, "hard");
  const questXp = result.completions.filter((row) => row.questId !== "streak_bonus").reduce((sum, row) => sum + row.xpAwarded, 0);
  const streak = result.completions.find((row) => row.questId === "streak_bonus");
  assert.ok(questXp <= 80);
  assert.equal(streak && streak.xpAwarded, 6);
  assert.equal(result.flags.includes("volume"), false);
  const heavy = applyEvents(player({ programStart: day }), [], [{ questId: "log_workout", count: 6 }], day);
  assert.equal(heavy.flags.includes("volume"), true);
  assert.equal(heavy.completions.find((row) => row.questId === "log_workout")?.done, true);
});

test("phase 2 schema matches the migration", () => {
  const file = readFileSync(new URL("../migrations/0002_phase2.sql", import.meta.url), "utf8");
  assert.equal(file.trim(), PHASE2_SQL.trim());
});

test("steps, plans, badges, and duels stay free of meal text", () => {
  const day = "2026-11-13";
  const steps = applyEvents(player({ difficulty: "normal", programStart: day }), [], [{ questId: "steps", count: 7000, source: "manual" }], day);
  assert.equal(steps.completions.find((row) => row.questId === "steps")?.done, true);
  assert.throws(() => applyEvents(player(), [], [{ questId: "steps", count: 100001 }], day), /100000/);
  const home = sessionFor("home", 1);
  const later = sessionFor("home", 8);
  assert.ok(home && home.moves.length >= 2);
  assert.notEqual(home && home.title, later && later.title);
  assert.equal(JSON.stringify(home).includes("nasi"), false);
  assert.equal(badgesFor({ streak: 1, level: 1, programDay: 66, duelWins: 0 }).some((badge) => badge.id === "finisher"), true);
  assert.equal(pickDuelWinner({ id: "a", session: true, steps: 8000 }, { id: "b", session: true, steps: 4000 }).winnerId, "a");
  assert.equal(pickDuelWinner({ id: "a", session: true, steps: 10 }, { id: "b", session: false, steps: 0 }).status, "open");
  assert.equal(checkinAllowed("2026-11-01", "2026-11-01"), false);
  assert.equal(checkinAllowed("2026-11-01", "2026-11-08"), true);
  const shown = viewQuests(player({ programStart: day }), [], day, "home");
  assert.equal(shown.some((quest) => quest.id === "program_session"), true);
  assert.equal(shown.some((quest) => quest.id === "steps"), true);
  assert.equal(viewQuests(player({ programStart: day }), [], day, null).some((quest) => quest.id === "program_session"), false);
});

function sampleProduct() {
  return {
    id: "whey",
    store: "pump",
    kind: "whey",
    brand: "other",
    name: "ON Gold Standard Whey, Double Rich Chocolate",
    why: "A widely sold whey with the serving printed on the tub.",
    evidence: "The label lists the serving size.",
    dose: "One scoop, as printed on the tub.",
    testing: "Not third-party tested.",
    halal: "not-stated",
    mal: "not-stated",
    priceCents: 19900,
    listPriceCents: 19900,
    linkUrl: "https://www.myprotein.com.my/sports-nutrition/whey",
    active: true,
  };
}

test("the shop stays off unless the flag is exactly true", () => {
  const file = readFileSync(new URL("../migrations/0004_store.sql", import.meta.url), "utf8");
  assert.equal(file.trim(), STORE_SQL.trim());
  assert.equal(readStoreConfig({}).enabled, false);
  assert.equal(readStoreConfig({}).mode, "external");
  assert.equal(readStoreConfig({ STORE_ENABLED: "false" }).enabled, false);
  assert.equal(readStoreConfig({ STORE_ENABLED: "true", STORE_MODE: "checkout", STORE_GATEWAY: "billplz" }).mode, "checkout");
  assert.equal(hasHealthClaim("Burns fat fast"), true);
  assert.equal(hasHealthClaim("Limited offer, 20% off"), true);
  assert.equal(hasHealthClaim("Chocolate whey, 900 g"), false);
  const listed = productFrom(sampleProduct());
  assert.equal(listed.audience, "all");
  assert.equal(listed.listPriceCents, 19900);
  assert.equal(listed.store, "pump");
  assert.throws(() => productFrom({ ...sampleProduct(), priceCents: 1000, listPriceCents: 19900 }));
  assert.throws(() => productFrom({ ...sampleProduct(), id: "pack", name: "Starter bundle" }));
  assert.throws(() => productFrom({ ...sampleProduct(), suggest: "after_workout" }));
  assert.throws(() => productFrom({ ...sampleProduct(), id: "burn", name: "MateBurn" }));
  assert.throws(() => productFrom({ ...sampleProduct(), id: "sosm-whey", brand: "sosm" }));
  const slim = productFrom({
    ...sampleProduct(),
    id: "mate",
    store: "slim",
    kind: "sosm",
    brand: "sosm",
    name: "MateBurn",
    linkUrl: "https://shopee.com.my/mateburn",
  });
  assert.equal(slim.store, "slim");
  assert.equal(slim.audience, "adult");
  assert.throws(() => productFrom({ ...slim, store: "slim", why: "Burns fat fast" }));
  assert.throws(() => productFrom({ ...sampleProduct(), id: "other", store: "slim", brand: "other", linkUrl: "https://shopee.com.my/whey" }));
  assert.equal(cleanShopeeUrl("https://shopee.com.my/protein-powder").includes("shopee.com.my"), true);
  assert.throws(() => cleanShopeeUrl("https://example.com/shop"));
  assert.throws(() => productFrom({ ...sampleProduct(), linkUrl: "https://shopee.com.my/not-a-mall-link" }));
});

test("voucher rules come from config and favour verified activity", () => {
  const file = readFileSync(new URL("../migrations/0003_vouchers.sql", import.meta.url), "utf8");
  assert.equal(file.trim(), VOUCHER_SQL.trim());
  const rules = parseMilestones("streak:7:5,level:10:15,verified:3:8");
  assert.equal(rules.length, 3);
  assert.throws(() => parseMilestones("food:1:1"));
  const config = { enabled: true, milestones: rules, expiryDays: 30, valueLabel: "value", verifiedDays: 1, prefix: "FIT", configError: "" };
  assert.equal(milestoneReached(rules[0], { streak: 7, level: 1, verifiedDays: 0 }, config), true);
  assert.equal(milestoneReached(rules[1], { streak: 7, level: 10, verifiedDays: 0 }, config), false);
  assert.equal(milestoneReached(rules[1], { streak: 7, level: 10, verifiedDays: 1 }, config), true);
});

test("flag text stays free of health details", () => {
  assert.equal(explainFlags("rapid,volume").includes("food"), false);
  assert.match(explainFlags("duration"), /duration/i);
});
