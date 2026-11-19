import type { Db } from "./data.ts";

export interface AlertEnv {
  OWNER_ALERT_EMAIL?: string;
  ALERT_FROM_EMAIL?: string;
  ALERT_WEBHOOK_URL?: string;
  EMAIL?: { send(message: unknown): Promise<void> };
}

function mime(from: string, to: string, subject: string, text: string): string {
  const safe = subject.replace(/[\r\n]/g, " ").slice(0, 120);
  return `From: ${from}\r\nTo: ${to}\r\nSubject: ${safe}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
}

async function deliver(env: AlertEnv, kind: string, detail: string): Promise<void> {
  const to = String(env.OWNER_ALERT_EMAIL || "").trim();
  const from = String(env.ALERT_FROM_EMAIL || "").trim();
  const body = `Fit owner alert\n${kind}\n${detail}`;
  if (env.EMAIL && to && from) {
    try {
      const message = mime(from, to, `Fit: ${kind}`, body);
      const EmailMessage = (globalThis as { EmailMessage?: new (from: string, to: string, raw: string) => unknown }).EmailMessage;
      if (EmailMessage) await env.EMAIL.send(new EmailMessage(from, to, message));
      else await env.EMAIL.send({ from, to, subject: `Fit: ${kind}`, text: body });
      return;
    } catch (err) {
      console.error(JSON.stringify({ service: "fitcouple-game", alert: "email-send-failed", error: err instanceof Error ? err.message : "unknown" }));
    }
  }
  const hook = String(env.ALERT_WEBHOOK_URL || "").trim();
  if (!hook) return;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, detail, text: body }),
    signal: AbortSignal.timeout(8000),
  }).catch((err: unknown) => {
    console.error(JSON.stringify({ service: "fitcouple-game", alert: "webhook-failed", error: err instanceof Error ? err.message : "unknown" }));
  });
}

export async function raiseAlert(db: Db, env: AlertEnv, day: string, kind: string, detail: string): Promise<void> {
  const row = await db.prepare(
    `INSERT INTO owner_alerts (day, kind, detail, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, kind) DO NOTHING
     RETURNING kind`,
  ).bind(day, kind, detail.slice(0, 300), new Date().toISOString()).first<{ kind: string }>();
  if (!row) return;
  await deliver(env, kind, detail);
}

export async function noteProviderFailure(db: Db, env: AlertEnv, day: string, allDown: boolean): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_failure_counts (day, count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1`,
  ).bind(day).run();
  if (allDown) await raiseAlert(db, env, day, "providers-down", "Every configured assistant provider failed.");
  const row = await db.prepare("SELECT count FROM ai_failure_counts WHERE day = ?").bind(day).first<{ count: number }>();
  if ((row?.count || 0) >= 5) await raiseAlert(db, env, day, "provider-spike", "Assistant provider failures reached 5 today.");
}

export async function noteBudget(db: Db, env: AlertEnv, day: string, spentUsd: number, budgetUsd: number, warnAtUsd: number): Promise<void> {
  if (budgetUsd > 0 && spentUsd >= budgetUsd) {
    await raiseAlert(db, env, day, "budget-reached", `Spend $${spentUsd} reached the $${budgetUsd} daily budget.`);
    return;
  }
  if (budgetUsd > 0 && spentUsd >= warnAtUsd) {
    await raiseAlert(db, env, day, "budget-warn", `Spend $${spentUsd} passed the $${warnAtUsd} warning.`);
  }
}
