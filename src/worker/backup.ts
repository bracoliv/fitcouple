import type { Db } from "./data.ts";
import { malaysiaDay } from "./brain.ts";
import { raiseAlert, type AlertEnv } from "./alerts.ts";

export interface BackupEnv extends AlertEnv {
  BACKUPS?: {
    put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>;
    delete(key: string): Promise<unknown>;
  };
}

async function gzipBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sqlValue(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function exportDatabase(db: Db, env: BackupEnv, now = new Date()): Promise<{ day: string; tables: number }> {
  const day = malaysiaDay(now);
  if (!env.BACKUPS) throw new Error("R2 backup bucket is not bound.");
  const listed = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
  ).all<{ name: string }>();
  const names = (listed.results || []).map((row) => row.name).filter((name) => /^[A-Za-z0-9_]+$/.test(name));
  const dump: Record<string, unknown[]> = {};
  const inserts: string[] = [];
  for (const name of names) {
    const rows = await db.prepare(`SELECT * FROM ${name}`).all<Record<string, unknown>>();
    const records = rows.results || [];
    dump[name] = records;
    for (const record of records) {
      const columns = Object.keys(record);
      if (!columns.length) continue;
      inserts.push(`INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map((column) => sqlValue(record[column])).join(", ")});`);
    }
  }
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const json = await gzipBytes(JSON.stringify({ day, exportedAt: now.toISOString(), tables: dump }));
  const sql = await gzipBytes(inserts.join("\n"));
  await env.BACKUPS.put(`d1/${day}/${stamp}.json.gz`, json, { httpMetadata: { contentType: "application/gzip" } });
  await env.BACKUPS.put(`d1/${day}/${stamp}.sql.gz`, sql, { httpMetadata: { contentType: "application/gzip" } });
  const old = await env.BACKUPS.list({ prefix: "d1/" });
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  for (const object of old.objects || []) {
    const match = /^d1\/(\d{4}-\d{2}-\d{2})\//.exec(object.key);
    if (match && match[1] < cutoff) await env.BACKUPS.delete(object.key);
  }
  return { day, tables: names.length };
}

export async function runBackup(db: Db, env: BackupEnv, now = new Date()): Promise<void> {
  try {
    await exportDatabase(db, env, now);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Backup failed.";
    console.error(JSON.stringify({ service: "fitcouple-game", alert: "backup-failed", error: detail }));
    try {
      await raiseAlert(db, env, malaysiaDay(now), "backup-failed", detail);
    } catch {
      // The database itself may be unavailable.
    }
    throw err;
  }
}
