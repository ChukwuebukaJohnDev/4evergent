/**
 * AccountSequenceCoordinator — Phase 25
 *
 * Serializes sequence-sensitive execution for the SAME Stellar source account
 * in a single-process architecture.
 *
 * Problem: Two different ExecutionRecords using the same Stellar account can
 * concurrently read the same Horizon sequence and build transactions with the
 * same sequence number. One will fail at Horizon.
 *
 * Solution: Per-account promise chain that serializes the critical section:
 *   - get sequence from Horizon
 *   - build transaction
 *   - simulate
 *   - sign
 *   - submit
 *
 * Different accounts remain concurrent. Same account is serialized.
 *
 * This is a single-process coordination mechanism. It does NOT provide
 * distributed locking or cross-process guarantees.
 */

type _ReleaseFn = () => void;

interface AccountQueue {
  tail: Promise<unknown>;
}

export class AccountSequenceCoordinator {
  private accounts = new Map<string, AccountQueue>();

  /**
   * Run a task with exclusive access to the given Stellar account's sequence.
   * Concurrent calls for the same account are serialized. Different accounts
   * run concurrently.
   *
   * @param accountId - The Stellar public key (G...) of the source account
   * @param task - The sequence-sensitive execution to perform
   * @returns The result of the task
   */
  async runExclusive<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    // Get or create the account's queue
    let queue = this.accounts.get(accountId);
    if (!queue) {
      queue = { tail: Promise.resolve() };
      this.accounts.set(accountId, queue);
    }

    // Chain this task after the current tail
    // The task waits for the previous same-account task to complete
    const result = queue.tail.then(async () => {
      return task();
    });

    // Update the tail — this task becomes the new tail for same-account tasks
    // We catch errors to avoid breaking the chain
    queue.tail = result.catch(() => undefined);

    // Clean up if no more queued tasks (best-effort, next runExclusive will recreate)
    queue.tail.then(() => {
      const current = this.accounts.get(accountId);
      if (current === queue && current.tail === queue.tail) {
        this.accounts.delete(accountId);
      }
    }).catch(() => {
      // Already handled
    });

    return result;
  }

  /**
   * Returns the number of accounts currently being tracked (for testing).
   */
  getTrackedAccountCount(): number {
    return this.accounts.size;
  }

  /**
   * Returns true if the given account has pending executions (for testing).
   */
  isAccountPending(accountId: string): boolean {
    return this.accounts.has(accountId);
  }
}
