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
  durationProblem,
  explainFlags,
  isDifficulty,
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
import { SCHEMA_SQL } from "./schema.ts";

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
  };
}

const USER_COLUMNS = `id, display_name, xp, level, streak, last_active_day, strength, discipline, health, mind, difficulty, program_start, team_id, rank, flagged, flag_codes, burst_start, burst_count`;

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

export async function stateFor(db: Db, userId: string, day: string) {
  let user = await reload(db, userId);
  if (user.teamId) {
    await settleTeam(db, user.teamId, day);
    user = await reload(db, userId);
  }
  await touchSnapshot(db, user, day);
  const completions = await loadCompletions(db, user.id, day);
  const quests = viewQuests(user, completions, day);
  const levels = levelProgress(user.xp);
  const clear = completions.find((row) => row.questId === "daily_clear");
  const team = user.teamId ? await teamView(db, user, day) : null;
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
    program: programPosition(user.programStart, day),
    quests,
    team,
  };
}

export async function createSession(db: Db, anonId: string, day: string) {
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
  const state = await stateFor(db, anonId, day);
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

export async function recordEvents(db: Db, user: StoredUser, events: QuestEvent[], day: string, difficulty?: Difficulty) {
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
  const completions = await loadCompletions(db, user.id, day);
  const result = applyEvents(user, completions, accepted, day, difficulty);
  for (const flag of result.flags) flags.add(flag);
  if (flags.size) await addFlags(db, user.id, [...flags]);
  if (result.dirty) await saveProgress(db, user, result.player, result.completions, day);
  const state = await stateFor(db, user.id, day);
  if (flags.has("duration")) {
    return { ...state, warning: "A duration was ignored, so it did not earn XP." };
  }
  return state;
}

export async function setDisplayName(db: Db, user: StoredUser, value: unknown, day: string) {
  const name = cleanDisplayName(value);
  await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, user.id).run();
  return stateFor(db, user.id, day);
}

export async function createTeam(db: Db, user: StoredUser, day: string) {
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
  return stateFor(db, user.id, day);
}

export async function joinTeam(db: Db, user: StoredUser, codeValue: unknown, day: string) {
  const code = normalizeTeamCode(codeValue);
  if (user.teamId && user.teamId !== code) throw new GameError(409, "You are already on a team.");
  const team = await db.prepare("SELECT id FROM teams WHERE id = ?").bind(code).first();
  if (!team) throw new GameError(404, "No team with that code.");
  if (user.teamId === code) return stateFor(db, user.id, day);
  const countRow = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE team_id = ?").bind(code).first<{ n: number }>();
  if (Number(countRow?.n || 0) >= MAX_TEAM) throw new GameError(400, "This team is full.");
  await db.prepare("UPDATE users SET team_id = ? WHERE id = ?").bind(code, user.id).run();
  await refreshRanks(db, code);
  return stateFor(db, user.id, day);
}

export async function confirmTeam(db: Db, user: StoredUser, day: string) {
  if (!user.teamId) throw new GameError(400, "Join a team first.");
  if (await noteBurst(db, user)) {
    throw new GameError(429, "Too many updates in a few minutes. XP was not added.");
  }
  const memberRows = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE team_id = ?`).bind(user.teamId).all<UserRow>();
  const members = (memberRows.results || []).map(mapUser);
  if (members.length < 2) throw new GameError(400, "Team confirmation needs two people.");
  const mine = await loadCompletions(db, user.id, day);
  if (mine.some((row) => row.questId === "gave_confirm" && row.done)) return stateFor(db, user.id, day);
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
  return stateFor(db, user.id, day);
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

export async function adminCustomers(db: Db, today: string) {
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
  return { today, counts, customers };
}

function shift(day: string, delta: number): string {
  const time = Date.parse(day + "T00:00:00Z") + delta * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}
