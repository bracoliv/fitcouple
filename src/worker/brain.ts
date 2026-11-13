import { GameError } from "./errors.ts";

export const PROGRAM_LENGTH = 66;
export const TEAM_QUEST_XP = 20;
export const PARTNER_BONUS_XP = 15;
export const MAX_TEAM = 12;
export const DAILY_QUEST_CAP = 80;
export const STREAK_BONUS_PER_DAY = 6;
export const STREAK_BONUS_CAP = 48;
export const TIMER_MINUTES = [15, 25, 45];

export type Source = "manual" | "timer" | "photo" | "wearable";

export type Difficulty = "easy" | "normal" | "hard";
export type AttributeName = "strength" | "discipline" | "health" | "mind";
export type StatusName = "improving" | "steady" | "slipping" | "inactive";

export interface Player {
  xp: number;
  level: number;
  streak: number;
  lastActiveDay: string | null;
  strength: number;
  discipline: number;
  health: number;
  mind: number;
  difficulty: Difficulty;
  programStart: string;
}

export interface CompletionState {
  questId: string;
  count: number;
  done: boolean;
  xpAwarded: number;
  source?: string;
}

export interface QuestEvent {
  questId: string;
  count?: number;
  completed?: boolean;
  source?: Source;
  hasProof?: boolean;
  durationMin?: number;
}

export interface QuestView {
  id: string;
  title: string;
  detail: string;
  kind: "count" | "check";
  target: number;
  count: number;
  done: boolean;
  xp: number;
  attribute: AttributeName;
  required: boolean;
  bonus: boolean;
}

interface QuestDef {
  id: string;
  title: string;
  detail: string;
  kind: "count" | "check";
  targets: Record<Difficulty, number>;
  xp: Record<Difficulty, number>;
  attribute: AttributeName;
  required: Record<Difficulty, boolean>;
}

const QUESTS: QuestDef[] = [
  {
    id: "log_meals",
    title: "Log meals",
    detail: "How many meals you logged. The server never sees the food.",
    kind: "count",
    targets: { easy: 1, normal: 2, hard: 3 },
    xp: { easy: 15, normal: 25, hard: 40 },
    attribute: "discipline",
    required: { easy: true, normal: true, hard: true },
  },
  {
    id: "log_workout",
    title: "Move",
    detail: "How many workouts you logged. The server never sees the activity.",
    kind: "count",
    targets: { easy: 1, normal: 1, hard: 1 },
    xp: { easy: 15, normal: 25, hard: 40 },
    attribute: "strength",
    required: { easy: false, normal: true, hard: true },
  },
  {
    id: "water",
    title: "Water",
    detail: "A check-in, not an amount.",
    kind: "check",
    targets: { easy: 1, normal: 1, hard: 1 },
    xp: { easy: 10, normal: 15, hard: 25 },
    attribute: "health",
    required: { easy: true, normal: true, hard: true },
  },
  {
    id: "sleep",
    title: "Sleep",
    detail: "Mark that you slept. Hours stay on your phone.",
    kind: "check",
    targets: { easy: 1, normal: 1, hard: 1 },
    xp: { easy: 10, normal: 15, hard: 25 },
    attribute: "health",
    required: { easy: false, normal: true, hard: true },
  },
  {
    id: "focus",
    title: "Focus block",
    detail: "Finish the timer once.",
    kind: "check",
    targets: { easy: 1, normal: 1, hard: 1 },
    xp: { easy: 10, normal: 15, hard: 25 },
    attribute: "mind",
    required: { easy: false, normal: false, hard: true },
  },
];

const QUEST_BY_ID = new Map(QUESTS.map((quest) => [quest.id, quest]));
const CLEAR_XP: Record<Difficulty, number> = { easy: 20, normal: 30, hard: 40 };
const THEME_BONUS = 10;
const ATTR_CAP = 99;

const THEMES: { title: string; detail: string; bonusQuestId: string }[] = [
  { title: "Show up", detail: "Log one meal and start the day on purpose.", bonusQuestId: "log_meals" },
  { title: "Move", detail: "A single workout count is a win.", bonusQuestId: "log_workout" },
  { title: "Water", detail: "Check in once for water. Amounts are not stored.", bonusQuestId: "water" },
  { title: "Sleep", detail: "Mark sleep. Hours stay on your phone.", bonusQuestId: "sleep" },
  { title: "Focus", detail: "Finish one short focus block.", bonusQuestId: "focus" },
  { title: "Log again", detail: "Meals count. What you ate stays in your sheet.", bonusQuestId: "log_meals" },
  { title: "Together", detail: "Team quests count today. Share the team code.", bonusQuestId: "log_meals" },
];

export const PERSONAL_QUEST_IDS = QUESTS.map((quest) => quest.id);

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function shiftDay(day: string, delta: number): string {
  const time = Date.parse(day + "T00:00:00Z") + delta * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  return Math.round((end - start) / 86400000);
}

export function assertNearToday(day: string, now = new Date()): void {
  if (!isDay(day)) throw new GameError(400, "Send the day as YYYY-MM-DD.");
  const utc = now.toISOString().slice(0, 10);
  const allowed = new Set([shiftDay(utc, -1), utc, shiftDay(utc, 1)]);
  if (!allowed.has(day)) throw new GameError(400, "That day is outside the play window.");
}

export function levelProgress(xp: number): { level: number; xpIntoLevel: number; xpToNext: number } {
  let level = 1;
  let spent = 0;
  while (level < 99) {
    const need = 80 + 20 * level;
    if (xp < spent + need) return { level, xpIntoLevel: xp - spent, xpToNext: need };
    spent += need;
    level += 1;
  }
  const need = 80 + 20 * 99;
  const into = Math.max(0, xp - spent);
  return { level: 99, xpIntoLevel: Math.min(need, into), xpToNext: need };
}

export function planFor(day: number): { day: number; title: string; detail: string; bonusQuestId: string } {
  const safe = Math.min(PROGRAM_LENGTH, Math.max(1, day));
  const theme = THEMES[(safe - 1) % THEMES.length];
  const week = Math.ceil(safe / 7);
  return {
    day: safe,
    title: `Week ${week} · ${theme.title}`,
    detail: theme.detail,
    bonusQuestId: theme.bonusQuestId,
  };
}

export function programPosition(start: string, today: string) {
  const elapsed = daysBetween(start, today);
  const day = Math.min(PROGRAM_LENGTH, Math.max(1, elapsed + 1));
  return {
    length: PROGRAM_LENGTH,
    day,
    complete: day >= PROGRAM_LENGTH,
    dayOne: planFor(1),
    current: planFor(day),
  };
}

export function visibleStreak(streak: number, lastActiveDay: string | null, today: string): number {
  if (!lastActiveDay || streak <= 0) return 0;
  const gap = daysBetween(lastActiveDay, today);
  if (gap === 0 || gap === 1) return streak;
  return 0;
}

// Manual typing pays half. A finished focus timer pays full on that quest.
// A photo flag pays more than typing, only for meal and workout counts.
// Wearable is accepted in the schema but pays the manual rate until a real sync exists.
export function sourceWeight(source: Source | undefined, questId: string, hasProof?: boolean): number {
  if (source === "timer" && questId === "focus") return 1;
  if (source === "photo" && hasProof === true && (questId === "log_meals" || questId === "log_workout")) return 0.8;
  return 0.5;
}

export function durationProblem(event: QuestEvent): boolean {
  if (event.source === "timer") return !TIMER_MINUTES.includes(event.durationMin as number);
  if (event.durationMin == null) return false;
  return !Number.isInteger(event.durationMin) || event.durationMin < 1 || event.durationMin > 180;
}

const FLAG_TEXT: Record<string, string> = {
  volume: "Too many workouts were counted in one day.",
  rapid: "Too many updates were sent in a few minutes.",
  duration: "A duration was not believable.",
};

export function explainFlags(codes: string): string {
  return codes.split(",").filter(Boolean).map((code) => FLAG_TEXT[code] || code).join(" ");
}

export function applyEvents(
  player: Player,
  completions: CompletionState[],
  events: QuestEvent[],
  today: string,
  difficulty?: Difficulty,
): { player: Player; completions: CompletionState[]; dirty: boolean; flags: string[] } {
  if (events.length > 8) throw new GameError(400, "Too many quest updates.");
  const next: Player = { ...player };
  const flags: string[] = [];
  let dirty = false;
  if (difficulty && difficulty !== next.difficulty) {
    next.difficulty = difficulty;
    dirty = true;
  }
  const map = new Map(completions.map((row) => [row.questId, { ...row }]));
  let awarded = false;
  const theme = planFor(programPosition(next.programStart, today).day);
  const outside = new Set(["streak_bonus", "partner_confirm", "team_show_up", "team_move", "gave_confirm"]);
  let spent = 0;
  for (const row of completions) {
    if (!outside.has(row.questId)) spent += row.xpAwarded;
  }
  const take = (gain: number) => {
    const room = Math.max(0, DAILY_QUEST_CAP - spent);
    const given = Math.min(Math.max(0, gain), room);
    spent += given;
    return given;
  };

  for (const event of events) {
    const quest = QUEST_BY_ID.get(event.questId);
    if (!quest) throw new GameError(400, "Unknown quest.");
    const prev = map.get(quest.id) || { questId: quest.id, count: 0, done: false, xpAwarded: 0 };
    let count = prev.count;
    let done = prev.done;
    if (quest.kind === "count") {
      if (!Number.isInteger(event.count) || (event.count as number) < 0 || (event.count as number) > 20) {
        throw new GameError(400, "Send a count from 0 to 20.");
      }
      count = Math.max(prev.count, event.count as number);
      if (quest.id === "log_workout" && count > 4) flags.push("volume");
      if (count >= quest.targets[next.difficulty]) done = true;
    } else if (event.completed === true) {
      count = Math.max(count, 1);
      done = true;
    } else if (event.completed !== false && event.completed != null) {
      throw new GameError(400, "Completed must be true or false.");
    }
    let xpAwarded = prev.xpAwarded;
    if (done && !prev.done) {
      let gain = quest.xp[next.difficulty];
      if (theme.bonusQuestId === quest.id) gain += THEME_BONUS;
      gain = Math.round(gain * sourceWeight(event.source, quest.id, event.hasProof));
      gain = take(gain);
      xpAwarded = gain;
      next.xp += gain;
      if (gain > 0) next[quest.attribute] = Math.min(ATTR_CAP, next[quest.attribute] + 1);
      awarded = true;
    }
    if (count !== prev.count || done !== prev.done || xpAwarded !== prev.xpAwarded) dirty = true;
    map.set(quest.id, { questId: quest.id, count, done, xpAwarded, source: event.source || prev.source });
  }

  const required = QUESTS.filter((quest) => quest.required[next.difficulty]);
  const allDone = required.every((quest) => map.get(quest.id)?.done);
  const clear = map.get("daily_clear") || { questId: "daily_clear", count: 0, done: false, xpAwarded: 0 };
  if (allDone && !clear.done) {
    const gain = take(Math.round(CLEAR_XP[next.difficulty] * 0.5));
    clear.done = true;
    clear.count = 1;
    clear.xpAwarded = gain;
    next.xp += gain;
    if (gain > 0) next.discipline = Math.min(ATTR_CAP, next.discipline + 1);
    map.set("daily_clear", clear);
    awarded = true;
    dirty = true;
  }

  if (awarded && (!next.lastActiveDay || today > next.lastActiveDay)) {
    if (next.lastActiveDay && next.lastActiveDay === shiftDay(today, -1)) next.streak += 1;
    else next.streak = 1;
    next.lastActiveDay = today;
  }

  const streakBonus = map.get("streak_bonus") || { questId: "streak_bonus", count: 0, done: false, xpAwarded: 0 };
  if (awarded && !streakBonus.done && next.streak > 0) {
    const gain = Math.min(STREAK_BONUS_CAP, next.streak * STREAK_BONUS_PER_DAY);
    streakBonus.done = true;
    streakBonus.count = next.streak;
    streakBonus.xpAwarded = gain;
    next.xp += gain;
    map.set("streak_bonus", streakBonus);
    dirty = true;
  }

  const levels = levelProgress(next.xp);
  if (next.level !== levels.level) dirty = true;
  next.level = levels.level;
  return { player: next, completions: [...map.values()], dirty, flags: [...new Set(flags)] };
}

export function viewQuests(player: Player, completions: CompletionState[], today: string): QuestView[] {
  const theme = planFor(programPosition(player.programStart, today).day);
  return QUESTS.map((quest) => {
    const row = completions.find((item) => item.questId === quest.id);
    const full = quest.xp[player.difficulty] + (theme.bonusQuestId === quest.id ? THEME_BONUS : 0);
    const listed = quest.id === "focus" ? full : Math.round(full * 0.5);
    return {
      id: quest.id,
      title: quest.title,
      detail: quest.detail,
      kind: quest.kind,
      target: quest.targets[player.difficulty],
      count: row?.count || 0,
      done: Boolean(row?.done),
      xp: row && row.done ? row.xpAwarded : listed,
      attribute: quest.attribute,
      required: quest.required[player.difficulty],
      bonus: theme.bonusQuestId === quest.id,
    };
  });
}

export interface SnapPoint {
  day: string;
  xp: number;
  strength: number;
  discipline: number;
  health: number;
  mind: number;
}

export function latestSnap(snaps: SnapPoint[], onOrBefore: string): SnapPoint | null {
  let best: SnapPoint | null = null;
  for (const snap of snaps) {
    if (snap.day <= onOrBefore && (!best || snap.day > best.day)) best = snap;
  }
  return best;
}

export function progressStatus(input: {
  today: string;
  lastActiveDay: string | null;
  programStart: string;
  xp7: number;
  xpPrev7: number;
  hasPriorWindow: boolean;
}): { status: StatusName; reason: string } {
  const never = !input.lastActiveDay;
  const stale = !never && daysBetween(input.lastActiveDay as string, input.today) >= 4;
  const newAndQuiet = never && daysBetween(input.programStart, input.today) >= 4;
  if (stale || newAndQuiet) {
    return {
      status: "inactive",
      reason: input.lastActiveDay ? `No finished quest since ${input.lastActiveDay}.` : "No finished quest yet.",
    };
  }
  if (!input.hasPriorWindow) {
    if (input.xp7 > 0) return { status: "improving", reason: "New player, and they have gained XP." };
    return { status: "steady", reason: "No finished quest yet." };
  }
  if (input.xp7 > input.xpPrev7) return { status: "improving", reason: "This week's XP is ahead of the week before." };
  if (input.xp7 < input.xpPrev7) return { status: "slipping", reason: "This week's XP is behind the week before." };
  return { status: "steady", reason: "This week's XP matches the week before." };
}

export function windowReport(
  current: { xp: number; strength: number; discipline: number; health: number; mind: number },
  snaps: SnapPoint[],
  today: string,
) {
  const b7 = latestSnap(snaps, shiftDay(today, -7));
  const b14 = latestSnap(snaps, shiftDay(today, -14));
  const b30 = latestSnap(snaps, shiftDay(today, -30));
  const attr = (name: AttributeName) => ({
    now: current[name],
    delta7: current[name] - (b7 ? b7[name] : 1),
    delta30: current[name] - (b30 ? b30[name] : 1),
  });
  return {
    xp7: current.xp - (b7 ? b7.xp : 0),
    xp30: current.xp - (b30 ? b30.xp : 0),
    xpPrev7: b7 && b14 ? b7.xp - b14.xp : 0,
    hasPriorWindow: Boolean(b14),
    attributes: {
      strength: attr("strength"),
      discipline: attr("discipline"),
      health: attr("health"),
      mind: attr("mind"),
    },
  };
}
