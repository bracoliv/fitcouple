import {
  type CompletionState,
  type Difficulty,
  type Player,
  type QuestEvent,
  type SnapPoint,
  PERSONAL_QUEST_IDS,
  PROGRAM_LENGTH,
  TEAM_QUEST_XP,
  PARTNER_BONUS_XP,
  MAX_TEAM,
  applyEvents,
  badgesFor,
  checkinAllowed,
  durationProblem,
  explainFlags,
  isDifficulty,
  pickDuelWinner,
  shiftDay,
  titleFor,
  levelProgress,
  programPosition,
  progressStatus,
  viewQuests,
  visibleStreak,
  windowReport,
} from "./brain.ts";
import { makeTeamCode, normalizeTeamCode, randomHex, sha256Hex } from "./crypto.ts";
import { GameError } from "./errors.ts";
import { cleanDisplayName, isAnonId } from "./privacy.ts";
import { PHASE2_SQL, SCHEMA_SQL, STORE_SQL, VOUCHER_SQL } from "./schema.ts";
import { hashVoucherCode, milestoneReached, shiftDay as addDays, VOUCHERS_OFF, type VoucherConfig } from "./vouchers.ts";
import { isProgramId, PROGRAM_CHOICES, sessionFor } from "./programs.ts";
import { askCoach } from "./coach.ts";

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface Db {
  prepare(query: string): DbStatement;
  exec(query: string): Promise<unknown>;
  batch(statements: DbStatement[]): Promise<unknown>;
}

interface UserRow {
  id: string;
  display_name: string | null;
  xp: number;
  level: number;
  streak: number;
  last_active_day: string | null;
  strength: number;
  discipline: number;
  health: number;
  mind: number;
  difficulty: string;
  program_start: string | null;
  team_id: string | null;
  rank: number | null;
  flagged: number | null;
  flag_codes: string | null;
  burst_start: number | null;
  burst_count: number | null;
  program_choice: string | null;
  duel_wins: number | null;
}

export interface StoredUser extends Player {
  id: string;
  displayName: string | null;
  teamId: string | null;
  rank: number | null;
  flagged: boolean;
  flagCodes: string;
  burstStart: number;
  burstCount: number;
  programChoice: string | null;
  duelWins: number;
}

const ready = new WeakMap<Db, Promise<void>>();

export function ensureSchema(db: Db): Promise<void> {
  let job = ready.get(db);
  if (!job) {
    job = applySchema(db).catch((err: unknown) => {
      ready.delete(db);
      throw err;
    });
    ready.set(db, job);
  }
  return job;
}

async function applySchema(db: Db): Promise<void> {
  // Local D1's exec() rejects these CREATE statements. prepare().run() applies them.
  const parts = SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) await db.prepare(part).run();
  const alters = [
    "ALTER TABLE users ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN flag_codes TEXT",
    "ALTER TABLE users ADD COLUMN burst_start INTEGER",
    "ALTER TABLE users ADD COLUMN burst_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE completions ADD COLUMN source TEXT",
  ];
  for (const sql of alters) {
    try {
      await db.prepare(sql).run();
    } catch {
      // The column is already there on databases created from the current schema.
    }
  }
  const phase2 = PHASE2_SQL.split(";").map((part) => part.trim()).filter(Boolean);
  for (const sql of phase2) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Phase 2 columns already exist after the first boot.
    }
  }
  const voucherSql = VOUCHER_SQL.split(";").map((part) => part.trim()).filter(Boolean);
  for (const sql of voucherSql) await db.prepare(sql).run();
  const storeSql = STORE_SQL.split(";").map((part) => part.trim()).filter(Boolean);
  for (const sql of storeSql) await db.prepare(sql).run();
}

function mapUser(row: UserRow): StoredUser {
  const difficulty: Difficulty = isDifficulty(row.difficulty) ? row.difficulty : "normal";
  return {
    id: row.id,
    displayName: row.display_name,
    xp: row.xp,
    level: row.level,
    streak: row.streak,
    lastActiveDay: row.last_active_day,
    strength: row.strength,
    discipline: row.discipline,
    health: row.health,
    mind: row.mind,
    difficulty,
    programStart: row.program_start || "1970-01-01",
    teamId: row.team_id,
    rank: row.rank,
    flagged: row.flagged === 1,
    flagCodes: row.flag_codes || "",
    burstStart: row.burst_start || 0,
    burstCount: row.burst_count || 0,
    programChoice: isProgramId(row.program_choice) ? row.program_choice : null,
    duelWins: row.duel_wins || 0,
  };
}

const USER_COLUMNS = `id, display_name, xp, level, streak, last_active_day, strength, discipline, health, mind, difficulty, program_start, team_id, rank, flagged, flag_codes, burst_start, burst_count, program_choice, duel_wins`;

async function reload(db: Db, id: string): Promise<StoredUser> {
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!row) throw new GameError(404, "Player not found.");
  return mapUser(row);
}

async function loadCompletions(db: Db, userId: string, day: string): Promise<CompletionState[]> {
  const rows = await db.prepare(
    "SELECT quest_id, count, done, xp_awarded FROM completions WHERE user_id = ? AND day = ?",
  ).bind(userId, day).all<{ quest_id: string; count: number; done: number; xp_awarded: number }>();
  return (rows.results || []).map((row) => ({
    questId: row.quest_id,
    count: row.count,
    done: row.done === 1,
    xpAwarded: row.xp_awarded,
  }));
}

function snapshotStatement(db: Db, user: StoredUser, day: string) {
  return db.prepare(
    `INSERT INTO snapshots (user_id, day, xp, level, streak, strength, discipline, health, mind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET
       xp = excluded.xp, level = excluded.level, streak = excluded.streak,
       strength = excluded.strength, discipline = excluded.discipline,
       health = excluded.health, mind = excluded.mind`,
  ).bind(user.id, day, user.xp, user.level, user.streak, user.strength, user.discipline, user.health, user.mind);
}

async function touchSnapshot(db: Db, user: StoredUser, day: string): Promise<void> {
  const existing = await db.prepare(
    "SELECT xp, level, strength, discipline, health, mind FROM snapshots WHERE user_id = ? AND day = ?",
  ).bind(user.id, day).first<{ xp: number; level: number; strength: number; discipline: number; health: number; mind: number }>();
  if (
    existing &&
    existing.xp === user.xp &&
    existing.level === user.level &&
    existing.strength === user.strength &&
    existing.discipline === user.discipline &&
    existing.health === user.health &&
    existing.mind === user.mind
  ) return;
  await snapshotStatement(db, user, day).run();
}

export async function refreshRanks(db: Db, teamId: string | null): Promise<void> {
  if (!teamId) return;
  const rows = await db.prepare(
    "SELECT id, xp FROM users WHERE team_id = ? ORDER BY xp DESC, id ASC",
  ).bind(teamId).all<{ id: string; xp: number }>();
  const list = rows.results || [];
  let rank = 1;
  let prev: number | null = null;
  const stmts: DbStatement[] = [];
  list.forEach((row, index) => {
    if (prev !== null && row.xp < prev) rank = index + 1;
    prev = row.xp;
    stmts.push(db.prepare("UPDATE users SET rank = ? WHERE id = ?").bind(rank, row.id));
  });
  if (stmts.length) await db.batch(stmts);
}

async function settleTeam(db: Db, teamId: string, day: string): Promise<void> {
  const memberRows = await db.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE team_id = ?`,
  ).bind(teamId).all<UserRow>();
  const members = (memberRows.results || []).map(mapUser);
  if (members.length < 2) {
    await refreshRanks(db, teamId);
    return;
  }
  const compRows = await db.prepare(
    `SELECT c.user_id, c.quest_id, c.done, c.xp_awarded
     FROM completions c
     JOIN users u ON u.id = c.user_id
     WHERE c.day = ? AND u.team_id = ?`,
  ).bind(day, teamId).all<{ user_id: string; quest_id: string; done: number; xp_awarded: number }>();
  const byUser = new Map<string, { quest_id: string; done: number; xp_awarded: number }[]>();
  for (const row of compRows.results || []) {
    const list = byUser.get(row.user_id) || [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  const personal = (id: string) => (byUser.get(id) || []).filter((row) => PERSONAL_QUEST_IDS.includes(row.quest_id));
  const showedUp = (id: string) => personal(id).some((row) => row.done === 1);
  const moved = (id: string) => personal(id).some((row) => row.quest_id === "log_workout" && row.done === 1);
  const awarded = (id: string, questId: string) => (byUser.get(id) || []).some((row) => row.quest_id === questId && row.xp_awarded > 0);
  const allShow = members.every((member) => showedUp(member.id));
  const allMove = members.every((member) => moved(member.id));
  const stmts: DbStatement[] = [];
  for (const member of members) {
    let xp = member.xp;
    let changed = false;
    if (allShow && !awarded(member.id, "team_show_up")) {
      xp += TEAM_QUEST_XP;
      stmts.push(completionUpsert(db, member.id, day, "team_show_up", 1, TEAM_QUEST_XP));
      changed = true;
    }
    if (allMove && !awarded(member.id, "team_move")) {
      xp += TEAM_QUEST_XP;
      stmts.push(completionUpsert(db, member.id, day, "team_move", 1, TEAM_QUEST_XP));
      changed = true;
    }
    if (changed) {
      const level = levelProgress(xp).level;
      const updated: StoredUser = { ...member, xp, level };
      stmts.push(db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").bind(xp, level, member.id));
      stmts.push(snapshotStatement(db, updated, day));
    }
  }
  if (stmts.length) await db.batch(stmts);
  await refreshRanks(db, teamId);
}

function completionUpsert(db: Db, userId: string, day: string, questId: string, count: number, xp: number) {
  return db.prepare(
    `INSERT INTO completions (user_id, day, quest_id, count, done, xp_awarded)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, day, quest_id) DO UPDATE SET
       count = excluded.count, done = excluded.done, xp_awarded = excluded.xp_awarded`,
  ).bind(userId, day, questId, count, xp);
}

async function saveProgress(db: Db, user: StoredUser, player: Player, completions: CompletionState[], day: string): Promise<void> {
  const stmts: DbStatement[] = [
    db.prepare(
      `UPDATE users SET xp = ?, level = ?, streak = ?, last_active_day = ?, strength = ?, discipline = ?, health = ?, mind = ?, difficulty = ?
       WHERE id = ?`,
    ).bind(
      player.xp, player.level, player.streak, player.lastActiveDay,
      player.strength, player.discipline, player.health, player.mind,
      player.difficulty, user.id,
    ),
  ];
  const snapUser: StoredUser = { ...user, ...player };
  stmts.push(snapshotStatement(db, snapUser, day));
  for (const row of completions) {
    stmts.push(db.prepare(
      `INSERT INTO completions (user_id, day, quest_id, count, done, xp_awarded, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day, quest_id) DO UPDATE SET
         count = excluded.count, done = excluded.done, xp_awarded = excluded.xp_awarded, source = excluded.source`,
    ).bind(user.id, day, row.questId, row.count, row.done ? 1 : 0, row.xpAwarded, row.source || null));
  }
  await db.batch(stmts);
}

async function teamView(db: Db, user: StoredUser, day: string) {
  const memberRows = await db.prepare(
    `SELECT id, display_name, xp, level, streak, last_active_day, rank FROM users WHERE team_id = ? ORDER BY rank ASC, xp DESC, id ASC`,
  ).bind(user.teamId).all<{ id: string; display_name: string | null; xp: number; level: number; streak: number; last_active_day: string | null; rank: number | null }>();
  const members = memberRows.results || [];
  const compRows = await db.prepare(
    `SELECT c.user_id, c.quest_id, c.done
     FROM completions c JOIN users u ON u.id = c.user_id
     WHERE c.day = ? AND u.team_id = ?`,
  ).bind(day, user.teamId).all<{ user_id: string; quest_id: string; done: number }>();
  const comps = compRows.results || [];
  const showed = (id: string) => comps.some((row) => row.user_id === id && row.done === 1 && PERSONAL_QUEST_IDS.includes(row.quest_id));
  const moved = (id: string) => comps.some((row) => row.user_id === id && row.quest_id === "log_workout" && row.done === 1);
  const showHave = members.filter((member) => showed(member.id)).length;
  const moveHave = members.filter((member) => moved(member.id)).length;
  const need = members.length;
  return {
    id: user.teamId,
    members: members.map((member) => ({
      id: member.id,
      tag: member.display_name || member.id.slice(0, 4),
      displayName: member.display_name,
      level: member.level,
      xp: member.xp,
      streak: visibleStreak(member.streak, member.last_active_day, day),
      rank: member.rank,
      you: member.id === user.id,
    })),
    quests: [
      {
        id: "team_show_up",
        title: "Everyone shows up",
        detail: need < 2 ? "Invite one more person with the code." : "Each person finishes at least one quest today.",
        done: need >= 2 && showHave === need,
        have: showHave,
        need,
      },
      {
        id: "team_move",
        title: "Everyone moves",
        detail: "Each person logs a workout today.",
        done: need >= 2 && moveHave === need,
        have: moveHave,
        need,
      },
    ],
  };
}

export async function stateFor(db: Db, userId: string, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  let user = await reload(db, userId);
  let challenge: { done: boolean; have: number; need: number; detail: string } | null = null;
  if (user.teamId) {
    await settleTeam(db, user.teamId, day);
    challenge = await weekChallenge(db, user.teamId, day);
    user = await reload(db, userId);
  }
  await touchSnapshot(db, user, day);
  const completions = await loadCompletions(db, user.id, day);
  const quests = viewQuests(user, completions, day, user.programChoice, vouchers.enabled);
  const voucherCards = vouchers.enabled ? await syncVouchers(db, user, day, vouchers) : null;
  const levels = levelProgress(user.xp);
  const clear = completions.find((row) => row.questId === "daily_clear");
  const position = programPosition(user.programStart, day);
  const badges = badgesFor({
    streak: visibleStreak(user.streak, user.lastActiveDay, day),
    level: levels.level,
    programDay: position.day,
    duelWins: user.duelWins,
  });
  let team = user.teamId ? await teamView(db, user, day) : null;
  if (team && challenge) team = { ...team, challenge };
  const duel = user.teamId ? await duelView(db, user, day) : null;
  return {
    id: user.id,
    displayName: user.displayName,
    xp: user.xp,
    level: levels.level,
    xpIntoLevel: levels.xpIntoLevel,
    xpToNext: levels.xpToNext,
    streak: visibleStreak(user.streak, user.lastActiveDay, day),
    lastActiveDay: user.lastActiveDay,
    attributes: {
      strength: user.strength,
      discipline: user.discipline,
      health: user.health,
      mind: user.mind,
    },
    difficulty: user.difficulty,
    rank: user.rank,
    dayClear: quests.filter((quest) => quest.required).every((quest) => quest.done),
    dayClearXp: clear?.xpAwarded || 0,
    program: position,
    programChoice: user.programChoice,
    programChoices: PROGRAM_CHOICES,
    session: sessionFor(user.programChoice, position.day),
    badges,
    title: titleFor(badges, levels.level),
    rewards: vouchers.enabled
      ? "Restaurant vouchers are on. They are separate from SOSM+."
      : "Badges and titles only. No discounts, vouchers, or shop rewards.",
    vouchersEnabled: vouchers.enabled,
    ...(voucherCards ? { vouchers: voucherCards.cards, voucherCodes: voucherCards.fresh, voucherLabel: vouchers.valueLabel } : {}),
    quests,
    team,
    duel,
  };
}

export async function createSession(db: Db, anonId: string, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (!isAnonId(anonId)) throw new GameError(400, "Player id must be a 64-character hash.");
  const existing = await db.prepare("SELECT id FROM users WHERE id = ?").bind(anonId).first();
  if (existing) {
    throw new GameError(409, "This device already has a game profile, but the saved key is missing.");
  }
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  await db.prepare(
    `INSERT INTO users (id, token_hash, xp, level, streak, strength, discipline, health, mind, difficulty, program_start)
     VALUES (?, ?, 0, 1, 0, 1, 1, 1, 1, 'normal', ?)`,
  ).bind(anonId, tokenHash, day).run();
  const state = await stateFor(db, anonId, day, vouchers);
  return { token, ...state };
}

export async function userFromToken(db: Db, token: string): Promise<StoredUser> {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new GameError(401, "Sign in to the game again on this device.");
  const hash = await sha256Hex(token.toLowerCase());
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE token_hash = ?`).bind(hash).first<UserRow>();
  if (!row) throw new GameError(401, "Sign in to the game again on this device.");
  return mapUser(row);
}

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 6;

async function noteBurst(db: Db, user: StoredUser, nowMs = Date.now()): Promise<boolean> {
  let start = user.burstStart;
  let count = user.burstCount;
  if (!start || nowMs - start > BURST_WINDOW_MS) {
    start = nowMs;
    count = 0;
  }
  count += 1;
  await db.prepare("UPDATE users SET burst_start = ?, burst_count = ? WHERE id = ?").bind(start, count, user.id).run();
  if (count > BURST_LIMIT) {
    await addFlags(db, user.id, ["rapid"]);
    return true;
  }
  return false;
}

async function addFlags(db: Db, userId: string, codes: string[]): Promise<void> {
  const row = await db.prepare("SELECT flag_codes FROM users WHERE id = ?").bind(userId).first<{ flag_codes: string | null }>();
  const have = new Set((row?.flag_codes || "").split(",").filter(Boolean));
  for (const code of codes) if (code) have.add(code);
  if (!have.size) return;
  await db.prepare("UPDATE users SET flagged = 1, flag_codes = ? WHERE id = ?").bind([...have].sort().join(","), userId).run();
}

export async function recordEvents(db: Db, user: StoredUser, events: QuestEvent[], day: string, difficulty?: Difficulty, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (await noteBurst(db, user)) {
    throw new GameError(429, "Too many updates in a few minutes. XP was not added.");
  }
  const flags = new Set<string>();
  const accepted: QuestEvent[] = [];
  for (const event of events) {
    if (durationProblem(event)) {
      flags.add("duration");
      continue;
    }
    accepted.push(event);
  }
  let scoring = vouchers.enabled ? accepted : accepted.filter((event) => event.questId !== "restaurant_meal");
  if (scoring.some((event) => event.questId === "weekly_checkin" && event.completed)) {
    const last = await db.prepare(
      "SELECT day FROM completions WHERE user_id = ? AND quest_id = 'weekly_checkin' AND done = 1 ORDER BY day DESC LIMIT 1",
    ).bind(user.id).first<{ day: string }>();
    if (last && !checkinAllowed(last.day, day)) {
      scoring = scoring.filter((event) => event.questId !== "weekly_checkin");
    }
  }
  const completions = await loadCompletions(db, user.id, day);
  const result = applyEvents(user, completions, scoring, day, difficulty);
  for (const flag of result.flags) flags.add(flag);
  if (flags.size) await addFlags(db, user.id, [...flags]);
  if (result.dirty) await saveProgress(db, user, result.player, result.completions, day);
  if (user.teamId) await resolveOpenDuel(db, user.teamId, day);
  const state = await stateFor(db, user.id, day, vouchers);
  if (flags.has("duration")) {
    return { ...state, warning: "A duration was ignored, so it did not earn XP." };
  }
  return state;
}

export async function setDisplayName(db: Db, user: StoredUser, value: unknown, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  const name = cleanDisplayName(value);
  await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, user.id).run();
  return stateFor(db, user.id, day, vouchers);
}

export async function createTeam(db: Db, user: StoredUser, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (user.teamId) throw new GameError(409, "You are already on a team.");
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = makeTeamCode();
    const taken = await db.prepare("SELECT id FROM teams WHERE id = ?").bind(code).first();
    if (!taken) break;
    code = "";
  }
  if (!code) throw new GameError(500, "Could not create a team code.");
  await db.batch([
    db.prepare("INSERT INTO teams (id, created_day) VALUES (?, ?)").bind(code, day),
    db.prepare("UPDATE users SET team_id = ?, rank = 1 WHERE id = ?").bind(code, user.id),
  ]);
  return stateFor(db, user.id, day, vouchers);
}

export async function joinTeam(db: Db, user: StoredUser, codeValue: unknown, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  const code = normalizeTeamCode(codeValue);
  if (user.teamId && user.teamId !== code) throw new GameError(409, "You are already on a team.");
  const team = await db.prepare("SELECT id FROM teams WHERE id = ?").bind(code).first();
  if (!team) throw new GameError(404, "No team with that code.");
  if (user.teamId === code) return stateFor(db, user.id, day, vouchers);
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ?").bind(code).first<{ n: number }>();
  if (Number(countRow?.n || 0) >= MAX_TEAM) throw new GameError(400, "This team is full.");
  await db.prepare("UPDATE users SET team_id = ? WHERE id = ?").bind(code, user.id).run();
  await refreshRanks(db, code);
  return stateFor(db, user.id, day, vouchers);
}

export async function setProgramChoice(db: Db, user: StoredUser, value: unknown, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (value !== "" && value != null && !isProgramId(value)) {
    throw new GameError(400, "Pick home, beginner gym, fat loss, or muscle.");
  }
  const choice = value === "" || value == null ? null : value;
  await db.prepare("UPDATE users SET program_choice = ? WHERE id = ?").bind(choice, user.id).run();
  return stateFor(db, user.id, day, vouchers);
}

export async function startDuel(db: Db, user: StoredUser, day: string, opponentId?: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (!user.teamId) throw new GameError(400, "Join a team first.");
  const memberRows = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE team_id = ?`).bind(user.teamId).all<UserRow>();
  const members = (memberRows.results || []).map(mapUser).filter((member) => member.id !== user.id);
  if (!members.length) throw new GameError(400, "A duel needs a teammate.");
  const opponent = opponentId ? members.find((member) => member.id === opponentId) : members[0];
  if (!opponent) throw new GameError(400, "That teammate is not on your team.");
  const existing = await db.prepare(
    "SELECT id FROM duels WHERE team_id = ? AND day = ? AND status = 'open'",
  ).bind(user.teamId, day).first();
  if (!existing) {
    await db.prepare(
      `INSERT INTO duels (id, team_id, challenger_id, opponent_id, day, status, winner_id, created_ms)
       VALUES (?, ?, ?, ?, ?, 'open', NULL, ?)`,
    ).bind(randomHex(8), user.teamId, user.id, opponent.id, day, Date.now()).run();
  }
  await resolveOpenDuel(db, user.teamId, day);
  return stateFor(db, user.id, day, vouchers);
}

export async function weeklyCoach(db: Db, user: StoredUser, day: string, apiKey: string, host: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  const last = await db.prepare(
    "SELECT day FROM completions WHERE user_id = ? AND quest_id = 'weekly_checkin' AND done = 1 ORDER BY day DESC LIMIT 1",
  ).bind(user.id).first<{ day: string }>();
  if (last && !checkinAllowed(last.day, day)) throw new GameError(429, "The coach is once a week.");
  const done = (await loadCompletions(db, user.id, day)).filter((row) => row.done).map((row) => row.questId);
  const position = programPosition(user.programStart, day);
  const reply = await askCoach({
    level: user.level,
    streak: visibleStreak(user.streak, user.lastActiveDay, day),
    programDay: position.day,
    programTitle: user.programChoice || "none",
    questIds: done,
    apiKey,
    host,
  });
  const state = await recordEvents(db, user, [{ questId: "weekly_checkin", completed: true, source: "manual" }], day, undefined, vouchers);
  return { ...state, reply };
}

async function weekChallenge(db: Db, teamId: string, day: string) {
  const start = shiftDay(day, -6);
  const memberRows = await db.prepare("SELECT id FROM users WHERE team_id = ?").bind(teamId).all<{ id: string }>();
  const ids = (memberRows.results || []).map((row) => row.id);
  if (ids.length < 2) return { done: false, have: 0, need: 3, detail: "Invite one more person for the weekly challenge." };
  const rows = await db.prepare(
    "SELECT user_id, day FROM completions WHERE quest_id = 'program_session' AND done = 1 AND day >= ? AND day <= ?",
  ).bind(start, day).all<{ user_id: string; day: string }>();
  const days = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const row of rows.results || []) days.get(row.user_id)?.add(row.day);
  const have = Math.min(...ids.map((id) => days.get(id)?.size || 0));
  const done = have >= 3;
  if (done) {
    const awarded = await db.prepare(
      "SELECT user_id FROM completions WHERE quest_id = 'team_week' AND done = 1 AND day >= ? AND day <= ?",
    ).bind(start, day).all<{ user_id: string }>();
    const haveAward = new Set((awarded.results || []).map((row) => row.user_id));
    const stmts: DbStatement[] = [];
    for (const id of ids) {
      if (haveAward.has(id)) continue;
      const member = await reload(db, id);
      const xp = member.xp + 20;
      const level = levelProgress(xp).level;
      stmts.push(db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").bind(xp, level, id));
      stmts.push(completionUpsert(db, id, day, "team_week", 3, 20));
      stmts.push(snapshotStatement(db, { ...member, xp, level }, day));
    }
    if (stmts.length) await db.batch(stmts);
  }
  return { done, have, need: 3, detail: "Each person finishes the day's session on 3 days this week." };
}

async function duelView(db: Db, user: StoredUser, day: string) {
  if (!user.teamId) return null;
  const row = await db.prepare(
    "SELECT challenger_id, opponent_id, status, winner_id FROM duels WHERE team_id = ? AND day = ? ORDER BY created_ms DESC LIMIT 1",
  ).bind(user.teamId, day).first<{ challenger_id: string; opponent_id: string; status: string; winner_id: string | null }>();
  if (!row) return null;
  const youAre = row.challenger_id === user.id ? "challenger" : row.opponent_id === user.id ? "opponent" : "watcher";
  return { status: row.status, winnerId: row.winner_id, youAre, opponentId: row.challenger_id === user.id ? row.opponent_id : row.challenger_id };
}

async function resolveOpenDuel(db: Db, teamId: string, day: string) {
  const duel = await db.prepare(
    "SELECT id, challenger_id, opponent_id FROM duels WHERE team_id = ? AND day = ? AND status = 'open' LIMIT 1",
  ).bind(teamId, day).first<{ id: string; challenger_id: string; opponent_id: string }>();
  if (!duel) return;
  const side = async (id: string) => {
    const rows = await loadCompletions(db, id, day);
    return {
      id,
      session: rows.some((row) => row.questId === "program_session" && row.done),
      steps: rows.find((row) => row.questId === "steps")?.count || 0,
    };
  };
  const result = pickDuelWinner(await side(duel.challenger_id), await side(duel.opponent_id));
  if (result.status !== "done") return;
  const prior = await db.prepare(
    "SELECT user_id FROM completions WHERE quest_id = 'duel_bonus' AND day = ? AND (user_id = ? OR user_id = ?)",
  ).bind(day, duel.challenger_id, duel.opponent_id).all();
  if ((prior.results || []).length) {
    await db.prepare("UPDATE duels SET status = 'done', winner_id = ? WHERE id = ?").bind(result.winnerId, duel.id).run();
    return;
  }
  const pay = async (id: string, xpGain: number, win: boolean) => {
    const member = await reload(db, id);
    const xp = member.xp + xpGain;
    const level = levelProgress(xp).level;
    const wins = member.duelWins + (win ? 1 : 0);
    await db.batch([
      db.prepare("UPDATE users SET xp = ?, level = ?, duel_wins = ? WHERE id = ?").bind(xp, level, wins, id),
      completionUpsert(db, id, day, "duel_bonus", 1, xpGain),
      snapshotStatement(db, { ...member, xp, level }, day),
    ]);
  };
  if (result.winnerId) {
    const other = result.winnerId === duel.challenger_id ? duel.opponent_id : duel.challenger_id;
    await pay(result.winnerId, 20, true);
    await pay(other, 5, false);
  } else {
    await pay(duel.challenger_id, 10, false);
    await pay(duel.opponent_id, 10, false);
  }
  await db.prepare("UPDATE duels SET status = 'done', winner_id = ? WHERE id = ?").bind(result.winnerId, duel.id).run();
}

export async function confirmTeam(db: Db, user: StoredUser, day: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  if (!user.teamId) throw new GameError(400, "Join a team first.");
  if (await noteBurst(db, user)) {
    throw new GameError(429, "Too many updates in a few minutes. XP was not added.");
  }
  const memberRows = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE team_id = ?`).bind(user.teamId).all<UserRow>();
  const members = (memberRows.results || []).map(mapUser);
  if (members.length < 2) throw new GameError(400, "Team confirmation needs two people.");
  const mine = await loadCompletions(db, user.id, day);
  if (mine.some((row) => row.questId === "gave_confirm" && row.done)) return stateFor(db, user.id, day, vouchers);
  const compRows = await db.prepare(
    `SELECT c.user_id, c.quest_id, c.done, c.xp_awarded
     FROM completions c JOIN users u ON u.id = c.user_id
     WHERE c.day = ? AND u.team_id = ?`,
  ).bind(day, user.teamId).all<{ user_id: string; quest_id: string; done: number; xp_awarded: number }>();
  const comps = compRows.results || [];
  const stmts: DbStatement[] = [completionUpsert(db, user.id, day, "gave_confirm", 1, 0)];
  for (const member of members) {
    if (member.id === user.id) continue;
    const rows = comps.filter((row) => row.user_id === member.id);
    const showed = rows.some((row) => row.done === 1 && PERSONAL_QUEST_IDS.includes(row.quest_id));
    const already = rows.some((row) => row.quest_id === "partner_confirm" && row.xp_awarded > 0);
    if (!showed || already) continue;
    const xp = member.xp + PARTNER_BONUS_XP;
    const level = levelProgress(xp).level;
    const updated: StoredUser = { ...member, xp, level };
    stmts.push(db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").bind(xp, level, member.id));
    stmts.push(completionUpsert(db, member.id, day, "partner_confirm", 1, PARTNER_BONUS_XP));
    stmts.push(snapshotStatement(db, updated, day));
  }
  await db.batch(stmts);
  await refreshRanks(db, user.teamId);
  return stateFor(db, user.id, day, vouchers);
}

interface SnapRow extends SnapPoint {
  user_id: string;
}

async function snapsOnOrBefore(db: Db, day: string): Promise<Map<string, SnapPoint>> {
  const rows = await db.prepare(
    `SELECT s.user_id, s.day, s.xp, s.strength, s.discipline, s.health, s.mind
     FROM snapshots s
     INNER JOIN (
       SELECT user_id, MAX(day) AS day FROM snapshots WHERE day <= ? GROUP BY user_id
     ) latest ON latest.user_id = s.user_id AND latest.day = s.day`,
  ).bind(day).all<SnapRow>();
  const map = new Map<string, SnapPoint>();
  for (const row of rows.results || []) {
    map.set(row.user_id, {
      day: row.day,
      xp: row.xp,
      strength: row.strength,
      discipline: row.discipline,
      health: row.health,
      mind: row.mind,
    });
  }
  return map;
}

async function verifiedDays(db: Db, userId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(DISTINCT day) AS n FROM completions WHERE user_id = ? AND done = 1 AND source IN ('timer', 'photo', 'wearable')",
  ).bind(userId).first<{ n: number }>();
  return Number(row?.n || 0);
}

async function syncVouchers(db: Db, user: StoredUser, day: string, config: VoucherConfig) {
  const fresh: { id: string; code: string; milestone: string; value: number; expiresDay: string }[] = [];
  if (!config.enabled || config.configError || config.expiryDays < 1) {
    return { cards: await voucherCardsFor(db, user.id, day), fresh };
  }
  const verified = await verifiedDays(db, user.id);
  const stats = {
    streak: visibleStreak(user.streak, user.lastActiveDay, day),
    level: user.level,
    verifiedDays: verified,
  };
  for (const milestone of config.milestones) {
    if (!milestoneReached(milestone, stats, config)) continue;
    const existing = await db.prepare(
      "SELECT id FROM vouchers WHERE user_id = ? AND milestone = ?",
    ).bind(user.id, milestone.key).first();
    if (existing) continue;
    const secret = randomHex(8).toUpperCase();
    const code = `${config.prefix}-${secret}`;
    const id = randomHex(8);
    try {
      await db.prepare(
        `INSERT INTO vouchers (id, user_id, code_hash, milestone, value, status, issued_day, expires_day)
         VALUES (?, ?, ?, ?, ?, 'issued', ?, ?)`,
      ).bind(id, user.id, await hashVoucherCode(code), milestone.key, milestone.value, day, addDays(day, config.expiryDays)).run();
      fresh.push({ id, code, milestone: milestone.key, value: milestone.value, expiresDay: addDays(day, config.expiryDays) });
    } catch {
      // Another request issued this milestone first.
    }
  }
  return { cards: await voucherCardsFor(db, user.id, day), fresh };
}

async function voucherCardsFor(db: Db, userId: string, day: string) {
  const rows = await db.prepare(
    "SELECT id, milestone, value, status, expires_day FROM vouchers WHERE user_id = ? ORDER BY issued_day ASC",
  ).bind(userId).all<{ id: string; milestone: string; value: number; status: string; expires_day: string }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    milestone: row.milestone,
    value: row.value,
    status: row.status === "issued" && day > row.expires_day ? "expired" : row.status,
    expiresDay: row.expires_day,
  }));
}

export async function redeemVoucher(db: Db, code: string, day: string) {
  const hash = await hashVoucherCode(code);
  const row = await db.prepare(
    "SELECT id, status, expires_day FROM vouchers WHERE code_hash = ?",
  ).bind(hash).first<{ id: string; status: string; expires_day: string }>();
  if (!row) throw new GameError(404, "That code is not valid.");
  if (row.status === "redeemed") throw new GameError(409, "That voucher was already used.");
  if (day > row.expires_day) throw new GameError(410, "That voucher has expired.");
  await db.prepare(
    "UPDATE vouchers SET status = 'redeemed', redeemed_day = ? WHERE id = ? AND status = 'issued'",
  ).bind(day, row.id).run();
  const after = await db.prepare("SELECT status FROM vouchers WHERE id = ?").bind(row.id).first<{ status: string }>();
  if (after?.status !== "redeemed") throw new GameError(409, "That voucher was already used.");
  return { ok: true, status: "redeemed" };
}

export async function voucherStats(db: Db, day: string) {
  const rows = await db.prepare("SELECT status, expires_day FROM vouchers").all<{ status: string; expires_day: string }>();
  let issued = 0;
  let redeemed = 0;
  let expired = 0;
  for (const row of rows.results || []) {
    issued += 1;
    if (row.status === "redeemed") redeemed += 1;
    else if (day > row.expires_day) expired += 1;
  }
  return { issued, redeemed, expired };
}

export async function adminCustomers(db: Db, today: string, vouchers: VoucherConfig = VOUCHERS_OFF) {
  const users = await db.prepare(
    `SELECT ${USER_COLUMNS} FROM users ORDER BY last_active_day IS NULL, last_active_day DESC, id ASC`,
  ).all<UserRow>();
  const list = (users.results || []).map(mapUser);
  const [base7, base14, base30, recentRows] = await Promise.all([
    snapsOnOrBefore(db, shift(today, -7)),
    snapsOnOrBefore(db, shift(today, -14)),
    snapsOnOrBefore(db, shift(today, -30)),
    db.prepare(
      `SELECT user_id, day, xp, strength, discipline, health, mind FROM snapshots WHERE day >= ? AND day <= ? ORDER BY day ASC`,
    ).bind(shift(today, -30), today).all<SnapRow>(),
  ]);
  const history = new Map<string, SnapPoint[]>();
  for (const row of recentRows.results || []) {
    const points = history.get(row.user_id) || [];
    points.push({
      day: row.day,
      xp: row.xp,
      strength: row.strength,
      discipline: row.discipline,
      health: row.health,
      mind: row.mind,
    });
    history.set(row.user_id, points);
  }
  const customers = list.map((user) => {
    const snaps = (history.get(user.id) || []).filter((snap) => snap.day !== today);
    snaps.push({
      day: today,
      xp: user.xp,
      strength: user.strength,
      discipline: user.discipline,
      health: user.health,
      mind: user.mind,
    });
    const older = [base30.get(user.id), base14.get(user.id), base7.get(user.id)].filter((snap): snap is SnapPoint => Boolean(snap));
    const merged = [...older, ...snaps];
    const report = windowReport(user, merged, today);
    const status = progressStatus({
      today,
      lastActiveDay: user.lastActiveDay,
      programStart: user.programStart,
      xp7: report.xp7,
      xpPrev7: report.xpPrev7,
      hasPriorWindow: report.hasPriorWindow,
    });
    const program = programPosition(user.programStart, today);
    return {
      id: user.id,
      displayName: user.displayName,
      level: user.level,
      xp: user.xp,
      streak: visibleStreak(user.streak, user.lastActiveDay, today),
      lastActiveDay: user.lastActiveDay,
      programDay: program.day,
      programLength: PROGRAM_LENGTH,
      programComplete: program.complete,
      xpGained7: report.xp7,
      xpGained30: report.xp30,
      attributes: report.attributes,
      history: snaps,
      status: status.status,
      statusReason: status.reason,
      flagged: user.flagged,
      flagCodes: user.flagCodes ? user.flagCodes.split(",") : [],
      flagReason: explainFlags(user.flagCodes),
    };
  });
  const counts = { improving: 0, steady: 0, slipping: 0, inactive: 0 };
  for (const customer of customers) counts[customer.status] += 1;
  const stats = await voucherStats(db, today);
  return {
    today,
    counts,
    customers,
    vouchers: {
      enabled: vouchers.enabled,
      label: vouchers.enabled ? vouchers.valueLabel : "",
      configError: vouchers.enabled ? vouchers.configError : "",
      ...stats,
    },
  };
}

function shift(day: string, delta: number): string {
  const time = Date.parse(day + "T00:00:00Z") + delta * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}
