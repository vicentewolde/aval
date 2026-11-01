import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The Meta Model API has no hard spending cap (only email alerts), so Aval enforces one itself:
 * every paid call asks `check()` first and records what it really cost afterwards.
 * The ledger is an append-only JSONL file, so the total survives restarts.
 */
export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";
  readonly spentUsd: number;
  readonly estimateUsd: number;
  readonly budgetUsd: number;
  readonly label: string;
  constructor(spentUsd: number, estimateUsd: number, budgetUsd: number, label: string) {
    super(
      `Budget guard: "${label}" needs about $${estimateUsd.toFixed(4)} but $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(2)} is already spent. Call refused before sending.`,
    );
    this.spentUsd = spentUsd;
    this.estimateUsd = estimateUsd;
    this.budgetUsd = budgetUsd;
    this.label = label;
  }
}

export interface SpendEntry {
  at: string;
  label: string;
  usd: number;
  estimated: boolean;
}

export class SpendGuard {
  private spent = 0;
  readonly budgetUsd: number;
  private readonly ledgerPath: string | null;

  constructor(budgetUsd: number, ledgerPath: string | null) {
    this.budgetUsd = budgetUsd;
    this.ledgerPath = ledgerPath;
    if (!(budgetUsd > 0)) throw new Error("AVAL_BUDGET_USD must be a positive number");
    if (ledgerPath && existsSync(ledgerPath)) {
      for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        this.spent += (JSON.parse(line) as SpendEntry).usd;
      }
    }
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    ledgerPath = ".aval/spend.jsonl",
  ): SpendGuard {
    const raw = env.AVAL_BUDGET_USD ?? "30";
    const budget = Number(raw);
    if (!Number.isFinite(budget)) throw new Error(`AVAL_BUDGET_USD is not a number: ${raw}`);
    return new SpendGuard(budget, ledgerPath);
  }

  get spentUsd(): number {
    return this.spent;
  }

  get remainingUsd(): number {
    return Math.max(0, this.budgetUsd - this.spent);
  }

  /** Throws before the request is sent when the worst-case cost would pass the ceiling. */
  check(estimateUsd: number, label: string): void {
    if (this.spent + estimateUsd > this.budgetUsd) {
      throw new BudgetExceededError(this.spent, estimateUsd, this.budgetUsd, label);
    }
  }

  record(usd: number, label: string, estimated = false): void {
    this.spent += usd;
    if (!this.ledgerPath) return;
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    const entry: SpendEntry = { at: new Date().toISOString(), label, usd, estimated };
    appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`);
  }
}
