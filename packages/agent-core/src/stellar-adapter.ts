import type { NetworkInfo, StellarAccount } from "@4evergent/shared";

export class StellarAdapter {
  private horizonUrl: string;
  private fetcher: typeof globalThis.fetch;

  constructor(horizonUrl: string, fetcher?: typeof globalThis.fetch) {
    this.horizonUrl = horizonUrl;
    this.fetcher = fetcher ?? globalThis.fetch;
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const res = await this.fetcher(`${this.horizonUrl}/`);
    if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
    const data = await res.json();
    return {
      network: data.network_passphrase,
      horizonUrl: this.horizonUrl,
      passphrase: data.network_passphrase,
      protocolVersion: Number(data.protocol_version ?? 0),
      coreVersion: data.stellar_core_version ?? "unknown",
      ingestLatestLedger: Number(data.history_latest_ledger ?? 0),
      historyLatestLedger: Number(data.history_latest_ledger ?? 0),
      oldestLedger: Number(data.history_oldest_ledger ?? 0),
    };
  }

  async getAccount(address: string): Promise<StellarAccount> {
    const res = await this.fetcher(`${this.horizonUrl}/accounts/${address}`);
    if (!res.ok) throw new Error(`Account fetch error: ${res.status}`);
    const data = await res.json();
    const thresholds = data.thresholds
      ? {
          low: Number(data.thresholds.low_threshold ?? 0),
          med: Number(data.thresholds.med_threshold ?? 0),
          high: Number(data.thresholds.high_threshold ?? 0),
        }
      : undefined;
    return {
      address: data.id,
      sequence: data.sequence,
      balances: data.balances.map((b: Record<string, unknown>) => ({
        asset: formatAsset(b),
        balance: String(b.balance ?? "0"),
        limit: b.limit ? String(b.limit) : undefined,
        buyingLiabilities: b.buying_liabilities ? String(b.buying_liabilities) : undefined,
        sellingLiabilities: b.selling_liabilities ? String(b.selling_liabilities) : undefined,
      })),
      subentryCount: Number(data.subentry_count ?? 0),
      thresholds,
      signers: data.signers,
      data: data.data,
    } as StellarAccount;
  }

  async getTransactions(cursor?: string, limit = 200): Promise<{ records: unknown[]; nextCursor?: string }> {
    const url = new URL(`${this.horizonUrl}/transactions`);
    if (limit) url.searchParams.append("limit", String(limit));
    if (cursor) url.searchParams.append("cursor", cursor);
    const res = await this.fetcher(url.toString());
    if (!res.ok) throw new Error(`Transactions fetch error: ${res.status}`);
    const data = await res.json();
    return { records: data._embedded?.records ?? [], nextCursor: data._links?.next?.href };
  }

  /**
   * Query transaction status from Horizon by hash.
   *
   * Returns typed result:
   *   confirmed    — transaction included in a ledger and successful
   *   failed       — transaction included in a ledger but failed
   *   not_found    — transaction not found (may be pending, or may have never been submitted)
   *   network_error — could not reach Horizon (timeout, 5xx, rate limit, etc.)
   *
   * SECURITY: This method only performs read-only queries. It does NOT sign,
   * submit, or create any transactions. It is safe for the reconciler to call.
   */
  async getTransactionStatus(txHash: string): Promise<"confirmed" | "failed" | "not_found" | "network_error"> {
    try {
      const res = await this.fetcher(`${this.horizonUrl}/transactions/${txHash}`);
      if (res.status === 404) return "not_found";
      if (!res.ok) return "network_error";
      const data = await res.json();
      if (data.successful === true) return "confirmed";
      if (data.successful === false) return "failed";
      return "network_error";
    } catch {
      return "network_error";
    }
  }
}

function formatAsset(b: Record<string, unknown>): string {
  if (b.asset_type === "native") return "XLM";
  return `${String(b.asset_code ?? "?")}:${String(b.asset_issuer ?? "?")}`;
}
