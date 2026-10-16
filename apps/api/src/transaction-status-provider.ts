export type TransactionStatus = "confirmed" | "failed" | "not_found" | "network_error";

export interface TransactionStatusProvider {
  getStatus(txHash: string): Promise<TransactionStatus>;
}

export class HorizonTransactionStatusProvider {
  constructor(
    private horizonUrl: string,
    private fetcher: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  async getStatus(txHash: string): Promise<TransactionStatus> {
    try {
      const res = await this.fetcher(`${this.horizonUrl}/transactions/${txHash}`);
      if (res.status === 404) return "not_found";
      if (!res.ok) return "network_error";
      const data: { successful?: boolean } = await res.json();
      if (data.successful === true) return "confirmed";
      if (data.successful === false) return "failed";
      return "network_error";
    } catch {
      return "network_error";
    }
  }
}
