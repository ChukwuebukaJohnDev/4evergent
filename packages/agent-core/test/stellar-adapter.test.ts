import { test } from "node:test";
import assert from "node:assert/strict";
import { StellarAdapter } from "../src/stellar-adapter.js";

// Helper to create a fake Horizon response
function createFakeFetcher(responseMap: Record<string, { status: number; body?: unknown; shouldThrow?: boolean }>) {
  return async (url: string) => {
    const key = Object.keys(responseMap).find((k) => url.includes(k));
    if (!key) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    const config = responseMap[key];
    if (config.shouldThrow) {
      throw new Error("Network error");
    }
    return {
      ok: config.status >= 200 && config.status < 300,
      status: config.status,
      json: async () => config.body,
    } as Response;
  };
}

// Test: getNetworkInfo() - successful response with realistic Horizon structure
test("getNetworkInfo() returns network info with correct shape", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const fakeResponse = {
    _links: {
      account: {
        href: "https://horizon-testnet.stellar.org/accounts/{account_id}",
        templated: true,
      },
      transactions: {
        href: "https://horizon-testnet.stellar.org/transactions{?cursor,limit,order}",
        templated: true,
      },
    },
    horizon_version: "21.5.0",
    stellar_core_version: "21.0.0",
    history_latest_ledger: 50000000,
    history_oldest_ledger: 1,
    core_latest_ledger: 50000000,
    network_passphrase: "Test SDF Network ; September 2015",
    protocol_version: "21",
    ingest_latest_ledger: 50000000,
  };

  const fetcher = createFakeFetcher({
    "/": { status: 200, body: fakeResponse },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const info = await adapter.getNetworkInfo();

  assert.ok(info);
  assert.equal(info.network, "Test SDF Network ; September 2015");
  assert.equal(info.horizonUrl, horizonUrl);
  assert.equal(info.passphrase, "Test SDF Network ; September 2015");
  assert.equal(info.protocolVersion, 21);
  assert.equal(info.coreVersion, "21.0.0");
  assert.equal(info.ingestLatestLedger, 50000000);
  assert.equal(info.historyLatestLedger, 50000000);
  assert.equal(info.oldestLedger, 1);
});

// Test: getNetworkInfo() - missing optional fields
test("getNetworkInfo() handles missing optional fields with defaults", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const fakeResponse = {
    network_passphrase: "Test SDF Network ; September 2015",
    // Missing optional fields
  };

  const fetcher = createFakeFetcher({
    "/": { status: 200, body: fakeResponse },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const info = await adapter.getNetworkInfo();

  assert.equal(info.protocolVersion, 0);
  assert.equal(info.coreVersion, "unknown");
  assert.equal(info.ingestLatestLedger, 0);
  assert.equal(info.historyLatestLedger, 0);
  assert.equal(info.oldestLedger, 0);
});

// Test: getNetworkInfo() throws on non-OK response
test("getNetworkInfo() throws error on non-OK response", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";

  const fetcher = createFakeFetcher({
    "/": { status: 500 },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);

  await assert.rejects(
    async () => adapter.getNetworkInfo(),
    (err: Error) => err.message.includes("Horizon error")
  );
});

// Test: getAccount() - successful response with realistic Horizon account structure
test("getAccount() returns account with correct shape and balances", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const address = "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U";
  const fakeResponse = {
    _links: {
      self: {
        href: `${horizonUrl}/accounts/${address}`,
      },
      transactions: {
        href: `${horizonUrl}/accounts/${address}/transactions{?cursor,limit,order}`,
        templated: true,
      },
      operations: {
        href: `${horizonUrl}/accounts/${address}/operations{?cursor,limit,order}`,
        templated: true,
      },
    },
    id: address,
    account_id: address,
    sequence: "24739097524306468",
    subentry_count: 3,
    inflation_destination: address,
    home_domain: "example.com",
    last_modified_ledger: 23569316,
    num_sponsoring: 0,
    num_sponsored: 0,
    thresholds: {
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 3,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    balances: [
      {
        balance: "1000.0000000",
        limit: "922337203685.4775807",
        buying_liabilities: "10.0000000",
        selling_liabilities: "20.0000000",
        last_modified_ledger: 22651481,
        is_authorized: true,
        is_clawback_enabled: false,
        asset_type: "native",
      },
      {
        balance: "500.5000000",
        limit: "1000.0000000",
        buying_liabilities: "5.0000000",
        selling_liabilities: "15.0000000",
        last_modified_ledger: 22651481,
        is_authorized: true,
        is_clawback_enabled: false,
        asset_type: "credit_alphanum12",
        asset_code: "USDC",
        asset_issuer: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIJOSBSGOYHL3QJH4J4UB5KEAAA",
      },
    ],
    signers: [
      {
        key: address,
        weight: 1,
        type: "ed25519_public_key",
      },
    ],
    data: {
      custom_key: "custom_value",
    },
    paging_token: "",
  };

  const fetcher = createFakeFetcher({
    "/accounts/": { status: 200, body: fakeResponse },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const account = await adapter.getAccount(address);

  assert.equal(account.address, address);
  assert.equal(account.sequence, "24739097524306468");
  assert.equal(account.balances.length, 2);
  assert.equal(account.balances[0].asset, "XLM");
  assert.equal(account.balances[0].balance, "1000.0000000");
  assert.equal(account.balances[0].buyingLiabilities, "10.0000000");
  assert.equal(account.balances[0].sellingLiabilities, "20.0000000");
  assert.equal(account.balances[1].asset, "USDC:GBUQWP3BOUZX34ULNQG23RQ6F4BWFIJOSBSGOYHL3QJH4J4UB5KEAAA");
  assert.equal(account.balances[1].balance, "500.5000000");
  assert.equal(account.balances[1].limit, "1000.0000000");
  assert.equal(account.balances[1].buyingLiabilities, "5.0000000");
  assert.equal(account.balances[1].sellingLiabilities, "15.0000000");
  assert.equal(account.subentryCount, 3);
  assert.ok(account.thresholds);
  assert.equal(account.thresholds.low, 1);
  assert.equal(account.thresholds.med, 2);
  assert.equal(account.thresholds.high, 3);
  assert.ok(account.signers);
  assert.equal(account.signers[0].key, address);
  assert.ok(account.data);
  assert.equal(account.data.custom_key, "custom_value");
});

// Test: getAccount() - non-OK response throws error
test("getAccount() throws error on non-OK response", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const address = "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U";

  const fetcher = createFakeFetcher({
    "/accounts/": { status: 404 },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);

  await assert.rejects(
    async () => adapter.getAccount(address),
    (err: Error) => err.message.includes("Account fetch error")
  );
});

// Test: getTransactions() - cursor pass-through
test("getTransactions() includes cursor in request parameters", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  let capturedUrl: string | null = null;

  const fetcher = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _links: {
          self: { href: `${horizonUrl}/transactions` },
          next: {
            href: `${horizonUrl}/transactions?cursor=120071205238677504&limit=200`,
          },
        },
        _embedded: { records: [] },
      }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  await adapter.getTransactions("cursor_value_123");

  assert.ok(capturedUrl);
  assert.ok(capturedUrl.includes("cursor=cursor_value_123"));
});

// Test: getTransactions() - default limit of 200
test("getTransactions() uses default limit of 200 when not specified", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  let capturedUrl: string | null = null;

  const fetcher = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _links: {
          self: { href: `${horizonUrl}/transactions` },
          next: { href: `${horizonUrl}/transactions?cursor=abc&limit=200` },
        },
        _embedded: { records: [] },
      }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  await adapter.getTransactions();

  assert.ok(capturedUrl);
  assert.ok(capturedUrl.includes("limit=200"));
});

// Test: getTransactions() - explicit limit
test("getTransactions() passes explicit limit to request", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  let capturedUrl: string | null = null;

  const fetcher = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _links: { self: { href: `${horizonUrl}/transactions?limit=50` } },
        _embedded: { records: [] },
      }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  await adapter.getTransactions(undefined, 50);

  assert.ok(capturedUrl);
  assert.ok(capturedUrl.includes("limit=50"));
});

// Test: getTransactions() - response parsing with realistic HAL structure and pagination
test("getTransactions() parses records and next cursor correctly with HAL pagination", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "132c440e984ab97d895f3477015080aafd6c4375f6a70a87327f7f95e13c4e31";
  const nextCursor = "120071205238677504";
  const txRecords = [
    {
      memo: "298424",
      _links: {
        self: { href: `${horizonUrl}/transactions/${txHash}` },
        account: { href: `${horizonUrl}/accounts/GCO2IP3MJNUOKS4PUDI4C7LGGMQDJGXG3COYX3WSB4HHNAHKYV5YL3VC` },
        ledger: { href: `${horizonUrl}/ledgers/27956256` },
      },
      id: txHash,
      paging_token: nextCursor,
      successful: true,
      hash: txHash,
      ledger: 27956256,
      created_at: "2020-01-27T22:13:17Z",
      source_account: "GCO2IP3MJNUOKS4PUDI4C7LGGMQDJGXG3COYX3WSB4HHNAHKYV5YL3VC",
      source_account_sequence: "64034663849209932",
      fee_charged: 100,
      max_fee: 100,
      operation_count: 1,
    },
    {
      memo: "test",
      _links: {
        self: { href: `${horizonUrl}/transactions/abc123` },
        account: { href: `${horizonUrl}/accounts/GCO2IP3MJNUOKS4PUDI4C7LGGMQDJGXG3COYX3WSB4HHNAHKYV5YL3VC` },
      },
      id: "abc123",
      paging_token: "120071205238677505",
      successful: true,
      hash: "abc123",
      ledger: 27956257,
      created_at: "2020-01-28T22:13:17Z",
      source_account: "GCO2IP3MJNUOKS4PUDI4C7LGGMQDJGXG3COYX3WSB4HHNAHKYV5YL3VC",
    },
  ];

  const fetcher = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _links: {
          self: { href: `${horizonUrl}/transactions?cursor=&limit=200&order=asc` },
          next: {
            href: `${horizonUrl}/transactions?cursor=${nextCursor}&limit=200&order=asc`,
          },
          prev: {
            href: `${horizonUrl}/transactions?cursor=120071205238677502&limit=200&order=desc`,
          },
        },
        _embedded: { records: txRecords },
      }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const result = await adapter.getTransactions();

  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0], txRecords[0]);
  assert.deepEqual(result.records[1], txRecords[1]);
  assert.ok(result.nextCursor);
  assert.equal(
    result.nextCursor,
    `${horizonUrl}/transactions?cursor=${nextCursor}&limit=200&order=asc`
  );
});

// Test: getTransactions() - empty records
test("getTransactions() returns empty records when not embedded", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";

  const fetcher = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _links: {
          self: { href: `${horizonUrl}/transactions` },
          next: { href: `${horizonUrl}/transactions?cursor=abc&limit=200` },
        },
      }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const result = await adapter.getTransactions();

  assert.equal(result.records.length, 0);
});

// Test: getTransactions() throws on non-OK response
test("getTransactions() throws error on non-OK response", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";

  const fetcher = createFakeFetcher({
    "/transactions": { status: 503 },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);

  await assert.rejects(
    async () => adapter.getTransactions(),
    (err: Error) => err.message.includes("Transactions fetch error")
  );
});

// Test: getTransactionStatus() - successful transaction
test("getTransactionStatus() returns 'confirmed' for successful transaction", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "132c440e984ab97d895f3477015080aafd6c4375f6a70a87327f7f95e13c4e31";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 200, body: { successful: true, id: txHash } },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "confirmed");
});

// Test: getTransactionStatus() - failed transaction
test("getTransactionStatus() returns 'failed' for unsuccessful transaction", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "132c440e984ab97d895f3477015080aafd6c4375f6a70a87327f7f95e13c4e31";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 200, body: { successful: false, id: txHash } },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "failed");
});

// Test: getTransactionStatus() - 404 not found
test("getTransactionStatus() returns 'not_found' for 404 response", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "nonexistent_hash";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 404 },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "not_found");
});

// Test: getTransactionStatus() - non-OK, non-404 response
test("getTransactionStatus() returns 'network_error' for non-OK response (not 404)", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "abc123";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 500 },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "network_error");
});

// Test: getTransactionStatus() - fetcher throws error
test("getTransactionStatus() returns 'network_error' when fetcher throws", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "abc123";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 200, body: {}, shouldThrow: true },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "network_error");
});

// Test: getTransactionStatus() - missing successful field
test("getTransactionStatus() returns 'network_error' when successful field is missing", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "abc123";

  const fetcher = createFakeFetcher({
    "/transactions/": { status: 200, body: { id: txHash } },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const status = await adapter.getTransactionStatus(txHash);

  assert.equal(status, "network_error");
});

// Test: getTransactionStatus() - tx hash passed correctly in URL
test("getTransactionStatus() includes transaction hash in request URL", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const txHash = "test_hash_12345";
  let capturedUrl: string | null = null;

  const fetcher = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ successful: true }),
    } as Response;
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  await adapter.getTransactionStatus(txHash);

  assert.ok(capturedUrl);
  assert.ok(capturedUrl.includes(txHash));
});

// Test: formatAsset() - native asset (XLM)
test("formatAsset() returns 'XLM' for native assets", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const address = "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U";

  const fetcher = createFakeFetcher({
    "/accounts/": {
      status: 200,
      body: {
        id: address,
        sequence: "1",
        balances: [
          {
            balance: "100.0000000",
            asset_type: "native",
          },
        ],
        subentry_count: 0,
      },
    },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const account = await adapter.getAccount(address);

  assert.equal(account.balances[0].asset, "XLM");
});

// Test: formatAsset() - non-native asset (CODE:ISSUER)
test("formatAsset() returns 'CODE:ISSUER' for non-native assets", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const address = "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U";
  const issuer = "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIJOSBSGOYHL3QJH4J4UB5KEAAA";

  const fetcher = createFakeFetcher({
    "/accounts/": {
      status: 200,
      body: {
        id: address,
        sequence: "1",
        balances: [
          {
            balance: "50.0000000",
            asset_type: "credit_alphanum12",
            asset_code: "USDC",
            asset_issuer: issuer,
          },
        ],
        subentry_count: 0,
      },
    },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const account = await adapter.getAccount(address);

  assert.equal(account.balances[0].asset, `USDC:${issuer}`);
});

// Test: formatAsset() - missing asset details fallback
test("formatAsset() handles missing asset_code and asset_issuer with fallback", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  const address = "GDI73WJ4SX7LOG3XZDJC3KCK6ED6E5NBYK2JUBQSPBCNNWEG3ZN7T75U";

  const fetcher = createFakeFetcher({
    "/accounts/": {
      status: 200,
      body: {
        id: address,
        sequence: "1",
        balances: [
          {
            balance: "50.0000000",
            asset_type: "credit_alphanum12",
            // asset_code and asset_issuer missing
          },
        ],
        subentry_count: 0,
      },
    },
  });

  const adapter = new StellarAdapter(horizonUrl, fetcher);
  const account = await adapter.getAccount(address);

  assert.equal(account.balances[0].asset, "?:?");
});

// Test: Multiple method calls on same adapter instance
test("adapter can be reused for multiple method calls", async () => {
  const horizonUrl = "https://horizon-testnet.stellar.org";
  let callCount = 0;

  const fetcher = async (url: string) => {
    callCount++;
    if (url.includes("/transactions")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: { records: [] },
          _links: { next: { href: "next" } },
        }),
      } as Response;
    }
    if (url.includes("/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          network_passphrase: "Test",
          protocol_version: "20",
          history_latest_ledger: 1000,
        }),
      } as Response;
    }
    throw new Error("Unexpected URL");
  };

  const adapter = new StellarAdapter(horizonUrl, fetcher);

  await adapter.getNetworkInfo();
  await adapter.getTransactions();

  assert.equal(callCount, 2);
});
