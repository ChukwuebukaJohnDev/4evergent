import type { ExecutionStore } from "@4evergent/database";

/**
 * TransactionStatus — typed result of a Stellar transaction lookup.
 *
 *   confirmed    — transaction included in a ledger and successful
 *   failed       — transaction included in a ledger but failed
 *   not_found    — transaction not found (may be pending, or may have never been submitted)
 *   network_error — could not reach Horizon (timeout, 5xx, rate limit, etc.)
 */
export type TransactionStatus = "confirmed" | "failed" | "not_found" | "network_error";

export interface TransactionStatusProvider {
  getStatus(txHash: string): Promise<TransactionStatus>;
}

export interface ReconcilerOptions {
  intervalMs?: number;
  clock?: () => Date;
}

/**
 * TransactionStatusReconciler — polls Horizon for on-chain status of submitted
 * transactions and updates execution records accordingly.
 *
 * SAFETY:
 *   - Only processes executions with status === "submitted" AND txHash != null
 *   - Uses atomic conditional update (updateIfStatus) to prevent races
 *   - Does NOT sign, submit, or create queue records
 *   - Does NOT change confirmed/failed/dead_letter executions
 *   - Does NOT retry submission on network error or not_found
 *   - Stops cleanly on server shutdown
 */
export class TransactionStatusReconciler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private intervalMs: number;
  private clock: () => Date;

  constructor(
    private executionStore: ExecutionStore,
    private statusProvider: TransactionStatusProvider,
    options: ReconcilerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.clock = options.clock ?? (() => new Date());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Single reconciliation pass — queries Horizon for all submitted executions
   * and updates their status based on on-chain state.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      checked: 0,
      confirmed: 0,
      failed: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      const executions = await this.executionStore.listSubmitted();
      result.checked = executions.length;

      for (const execution of executions) {
        if (!execution.txHash) {
          result.skipped++;
          continue;
        }

        let status: TransactionStatus;
        try {
          status = await this.statusProvider.getStatus(execution.txHash);
        } catch (_err) {
          result.errors++;
          continue;
        }

        if (status === "confirmed") {
          const updated = await this.executionStore.updateIfStatus(
            execution.id,
            "submitted",
            { status: "confirmed", completedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() }
          );
          if (updated) result.confirmed++;
        } else if (status === "failed") {
          const updated = await this.executionStore.updateIfStatus(
            execution.id,
            "submitted",
            { status: "failed", error: "Transaction failed on-chain", updatedAt: this.clock().toISOString() }
          );
          if (updated) result.failed++;
        }
        // not_found or network_error: leave as submitted, will retry next tick
      }
    } catch (_err) {
      result.errors++;
    }

    return result;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      await this.reconcile();
    } catch (err) {
      console.error("[reconciler] tick error:", err);
    }
    if (!this.running) return;
    this.timer = setTimeout(() => { void this.tick(); }, this.intervalMs);
  }
}

export interface ReconciliationResult {
  checked: number;
  confirmed: number;
  failed: number;
  skipped: number;
  errors: number;
}
