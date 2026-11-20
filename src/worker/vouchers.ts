import { GameError } from "./errors.ts";
import { sha256Hex } from "./crypto.ts";

export type MilestoneKind = "streak" | "level" | "verified";

export interface Milestone {
  kind: MilestoneKind;
  threshold: number;
  value: number;
  key: string;
}

export interface VoucherConfig {
  enabled: boolean;
  milestones: Milestone[];
  expiryDays: number;
  valueLabel: string;
  verifiedDays: number;
  prefix: string;
  configError: string;
}

export const VOUCHERS_OFF: VoucherConfig = {
  enabled: false,
  milestones: [],
  expiryDays: 0,
  valueLabel: "value",
  verifiedDays: 1,
  prefix: "FIT",
  configError: "",
};

export function parseMilestones(raw: string | undefined): Milestone[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const bits = part.split(":");
    if (bits.length !== 3) throw new GameError(500, "Voucher milestones config is not valid.");
    const [kind, thresholdText, valueText] = bits;
    if (kind !== "streak" && kind !== "level" && kind !== "verified") {
      throw new GameError(500, "Voucher milestones config is not valid.");
    }
    const threshold = Number(thresholdText);
    const value = Number(valueText);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10000) {
      throw new GameError(500, "Voucher milestones config is not valid.");
    }
    if (!Number.isInteger(value) || value < 1 || value > 100000) {
      throw new GameError(500, "Voucher milestones config is not valid.");
    }
    return { kind, threshold, value, key: `${kind}:${threshold}` };
  });
}

export function readVoucherConfig(env: {
  VOUCHERS_ENABLED?: string;
  VOUCHER_MILESTONES?: string;
  VOUCHER_EXPIRY_DAYS?: string;
  VOUCHER_VALUE_LABEL?: string;
  VOUCHER_VERIFIED_DAYS?: string;
  VOUCHER_PREFIX?: string;
}): VoucherConfig {
  const enabled = String(env.VOUCHERS_ENABLED || "").trim() === "true";
  let milestones: Milestone[] = [];
  let configError = "";
  try {
    milestones = parseMilestones(env.VOUCHER_MILESTONES);
  } catch {
    configError = "Voucher milestones config is not valid.";
  }
  const expiryDays = Number(env.VOUCHER_EXPIRY_DAYS || "");
  const verifiedDays = Number(env.VOUCHER_VERIFIED_DAYS || "1");
  const label = String(env.VOUCHER_VALUE_LABEL || "value").replace(/[^A-Za-z]/g, "").slice(0, 12) || "value";
  const prefix = String(env.VOUCHER_PREFIX || "FIT").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "FIT";
  return {
    enabled,
    milestones,
    expiryDays: Number.isInteger(expiryDays) && expiryDays >= 1 && expiryDays <= 365 ? expiryDays : 0,
    valueLabel: label,
    verifiedDays: Number.isInteger(verifiedDays) && verifiedDays >= 0 && verifiedDays <= 365 ? verifiedDays : 1,
    prefix,
    configError,
  };
}

export function milestoneReached(
  milestone: Milestone,
  stats: { streak: number; level: number; verifiedDays: number },
  config: VoucherConfig,
): boolean {
  if (milestone.kind === "streak") return stats.streak >= milestone.threshold;
  if (milestone.kind === "level") return stats.level >= milestone.threshold && stats.verifiedDays >= config.verifiedDays;
  return stats.verifiedDays >= milestone.threshold;
}

export function shiftDay(day: string, delta: number): string {
  const time = Date.parse(day + "T00:00:00Z") + delta * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

export async function hashVoucherCode(code: string): Promise<string> {
  return sha256Hex(code.trim().toUpperCase());
}
