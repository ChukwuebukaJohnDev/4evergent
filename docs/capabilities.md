# Agent Capabilities

In 4evergent, "capability" refers to two distinct concepts depending on the architectural layer:

1. **Pipeline Capabilities (Built-in)**: Strictly typed, policy-governed operations an agent may perform on Stellar (`PaymentIntent`, `TrustlineIntent`, etc.). These gate validation and execution in `@4evergent/policy` and `@4evergent/stellar`.
2. **Agent Capabilities (Free-form Metadata)**: A free-form string array (`Agent.capabilities?: string[]`, stored in `capabilities_json`) attached to an agent record. These describe an agent's abilities for discovery, delegation, and automated negotiation (Phase 7).

---

## Built-in capabilities (Phase 1)

These govern transaction pipeline execution:

| Capability | Intent type | Status |
|------------|-------------|--------|
| `payment` | `PaymentIntent` | ✅ MVP — validation + policy |
| `trustline` | `TrustlineIntent` | ✅ MVP — validation + policy |
| `contract_call` | `ContractCallIntent` | ✅ validation; policy denies by default |
| `account_settings` | `AccountSettingsIntent` | ✅ supported — `buildAccountSettings` + `parseIntent` + tests |

---

## Free-form agent capabilities & discovery (Phase 7 Prerequisite)

Agents advertise their abilities via the `capabilities` string array on `POST /agents` (e.g. `["payment", "trustline", "market_making"]`).

### Discovery Query Surface

Callers can discover agents matching a capability over the HTTP API without fetching all agents:

```http
GET /agents?capability=payment&limit=50
```

- **Endpoint**: `GET /agents?capability=<name>`
- **Store API**: `AgentStore.listByCapability(ownerId: string, capability: string, limit?: number): Promise<Agent[]>`
- **Owner isolation**: Strictly enforced at the store layer — queries only return agents belonging to the authenticated caller.
- **Store-level filtering**: Executed directly in the database (`SQLiteAgentStore` via SQLite `json_each` and `InMemoryAgentStore` via array membership). Filtering does not rely on post-filtering a capped handler list.
- **Response**: `{ "agents": AgentRecord[] }`, where each agent includes its full `capabilities` list. If no agents match, returns `200` with `{ "agents": [] }`.

### Design Note: Capability Discovery Match Semantics

**Decision**: Capability discovery uses **exact, case-sensitive matching**.

**Rationale**:
1. **Ambiguity Prevention**: Prefix or substring matching introduces dangerous false positives in automated negotiation and multi-agent coordination. For instance, a substring query for `pay` would match both `payment` and `payroll`, or a prefix query for `trust` would match `trustline` and `trust_score`. Agents needing a specific protocol capability require unambiguous guarantees.
2. **Determinism in Negotiation**: In Phase 7's agent-to-agent economy, agents negotiating contracts must rely on discrete, deterministic capability identifiers rather than heuristic text matching.
3. **Storage & Index Compatibility**: Exact matching maps directly to SQLite's built-in `json_each.value = ?` comparison with default binary collation, as well as JavaScript's `Array.includes()`. It avoids locale-dependent casing inconsistencies and enables efficient indexing strategies.

## Stellar Asset Support (Phase 12)

| Operation | Status | Notes |
|-----------|--------|-------|
| XLM payment (native) | ✅ Supported | `PaymentIntent` with `asset: "XLM"` |
| Issued asset payment | ✅ Supported | `PaymentIntent` with `assetDetails: { code, issuer }` |
| Create trustline | ✅ Supported | `TrustlineIntent` with `assetCode`, `issuer`, optional `limit` |
| Path payments | ❌ Not supported | — |
| Contract invocation | ❌ Not supported | Policy denies by default |
| Account settings | ✅ Supported | `AccountSettingsIntent` with `setting` + `value` — `home_domain`, `inflation_destination`, `signer`, `thresholds`, `set_flags`, `clear_flags` |
| Token issuance | ❌ Not supported | — |
| Soroban contracts | ⚠️ AgentRegistry deployed on Testnet | Contract exists and is callable directly; the transaction pipeline still does not invoke contracts (`contract_call` policy-denied by default). See `docs/testnet.md` and the [integration guide](soroban-integration.md). |

### Asset representation

All asset references use a consistent `PaymentAsset` shape:

```typescript
interface PaymentAsset {
  code: string;        // "XLM" or issued asset code (e.g. "USDC")
  issuer: string | null;  // Stellar address for issued assets; null for native XLM
}
```

This representation is used across:
- `PaymentIntent.assetDetails` (shared types)
- `TrustlineIntent.assetCode` + `TrustlineIntent.issuer`
- `extractAsset()` in PolicyEngine (normalizes to `CODE:ISSUER` or `XLM`)
- `StellarTransactionBuilder.parseAssetInput()` (resolves to Stellar SDK `Asset`)
- Activity/execution records

### Trustline flow

```
TrustlineIntent
  → IntentValidator.validateTrustline()
  → PolicyEngine.evaluate()
  → Approval gate (if configured)
  → ExecutionQueue (if async)
  → TransactionPipeline.execute()
  → StellarTransactionBuilder.buildTrustline()
  → StellarSimulator.simulate()
  → Signer.sign()
  → StellarSubmitter.submit()
  → Activity record
```

## Adding a new capability

See the "Adding a new agent capability" section of [README.md](../README.md).
