import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { AgentRecord, ActivityRecord, PolicyRules } from '../types';
import { ScheduleManagement } from './ScheduleManagement';
import { ExecutionList } from './ExecutionList';
import { StatusBadge, Skeleton, EmptyState } from '../components';

type SpendingData = Record<string, { used: number; limit: string; remaining: number }>;

function SpendingCard({ asset, data }: { asset: string; data: SpendingData[string] }) {
  const limitNum = parseFloat(data.limit) || 0;
  const pct = limitNum > 0 ? Math.min(100, Math.round((data.used / limitNum) * 100)) : 0;
  return (
    <div className="spending-asset">
      <div className="spending-header">
        <span className="spending-asset-name">{asset}</span>
        <span className="spending-values">{data.used} / {data.limit}</span>
      </div>
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="spending-remaining">Remaining: {data.remaining}</div>
    </div>
  );
}

function StatusControls({
  agentId,
  currentStatus,
  onStatusChange,
}: {
  agentId: string;
  currentStatus: string;
  onStatusChange: (newStatus: string) => void;
}) {
  const [mutating, setMutating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (newStatus: string) => {
    if (mutating) return;
    setMutating(newStatus);
    setError(null);
    try {
      const res = await api.updateAgentStatus(agentId, newStatus);
      onStatusChange(res.status);
    } catch (e: any) {
      setError(e.message ?? 'Failed to update status');
    } finally {
      setMutating(null);
    }
  };

  if (currentStatus === 'disabled') {
    return (
      <div className="status-controls">
        <span className="muted">Disabled agents cannot be re-enabled.</span>
        {error && <div className="error" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="status-controls">
      {currentStatus === 'active' && (
        <>
          <button disabled={mutating !== null} onClick={() => handleChange('paused')}>
            {mutating === 'paused' ? 'Pausing...' : 'Pause'}
          </button>
          <button disabled={mutating !== null} onClick={() => handleChange('disabled')}>
            {mutating === 'disabled' ? 'Disabling...' : 'Disable'}
          </button>
        </>
      )}
      {currentStatus === 'paused' && (
        <>
          <button disabled={mutating !== null} onClick={() => handleChange('active')}>
            {mutating === 'active' ? 'Resuming...' : 'Resume'}
          </button>
          <button disabled={mutating !== null} onClick={() => handleChange('disabled')}>
            {mutating === 'disabled' ? 'Disabling...' : 'Disable'}
          </button>
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

function AgentHeader({
  agent,
  onStatusChange,
}: {
  agent: AgentRecord;
  onStatusChange: (newStatus: string) => void;
}) {
  const statusClass = agent.status === 'active' ? 'badge-ok'
    : agent.status === 'paused' ? 'badge-warn'
    : 'badge-err';
  return (
    <div className="agent-header">
      <div className="agent-header-main">
        <h1>{agent.displayName}</h1>
        <div className="agent-header-meta">
          <span className={`badge ${statusClass}`}>{agent.status}</span>
          <code className="agent-address">{agent.stellarAddress.slice(0, 12)}...</code>
          <span className="muted">ID: {agent.id.slice(0, 8)}</span>
        </div>
      </div>
      <StatusControls agentId={agent.id} currentStatus={agent.status} onStatusChange={onStatusChange} />
    </div>
  );
}

const _DEFAULT_POLICY: PolicyRules = {
  maxTxAmount: { XLM: '100' },
  dailySpendingLimit: { XLM: '500' },
  allowedAssets: ['XLM'],
  allowedDestinations: [],
  allowedContractIds: [],
  txTypeRestrictions: {
    payment: true,
    trustline: true,
    contract_call: false,
    account_settings: false,
  },
  approvalThreshold: '50',
  requireHumanApprovalForAmountAbove: '50',
};

function deepClonePolicy(policy: PolicyRules): PolicyRules {
  return {
    maxTxAmount: { ...policy.maxTxAmount },
    dailySpendingLimit: { ...policy.dailySpendingLimit },
    allowedAssets: [...policy.allowedAssets],
    allowedDestinations: [...policy.allowedDestinations],
    allowedContractIds: [...policy.allowedContractIds],
    txTypeRestrictions: { ...policy.txTypeRestrictions },
    approvalThreshold: policy.approvalThreshold,
    requireHumanApprovalForAmountAbove: policy.requireHumanApprovalForAmountAbove,
  };
}

function PolicySummary({ agentId }: { agentId: string }) {
  const [policy, setPolicy] = useState<PolicyRules | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getPolicy(agentId);
        if (!cancelled) setPolicy(res.policy);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to load policy summary');
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (error) return null;
  if (!policy) return null;

  const limits = Object.entries(policy.maxTxAmount);
  const assets = Object.entries(policy.dailySpendingLimit);

  return (
    <div className="policy-summary">
      <div className="policy-summary-grid">
        {limits.map(([asset, amount]) => (
          <div key={`tx-${asset}`} className="policy-summary-item">
            <span className="policy-summary-label">Max Tx ({asset})</span>
            <span className="policy-summary-value">{amount}</span>
          </div>
        ))}
        <div className="policy-summary-item">
          <span className="policy-summary-label">Approval Threshold</span>
          <span className="policy-summary-value">{policy.approvalThreshold}</span>
        </div>
        {assets.map(([asset, limit]) => (
          <div key={`daily-${asset}`} className="policy-summary-item">
            <span className="policy-summary-label">Daily Limit ({asset})</span>
            <span className="policy-summary-value">{limit}</span>
          </div>
        ))}
        <div className="policy-summary-item">
          <span className="policy-summary-label">Allowed Assets</span>
          <span className="policy-summary-value">{policy.allowedAssets.join(', ')}</span>
        </div>
        <div className="policy-summary-item">
          <span className="policy-summary-label">Destinations</span>
          <span className="policy-summary-value">
            {policy.allowedDestinations.length === 0 ? 'Any' : policy.allowedDestinations.length + ' whitelisted'}
          </span>
        </div>
      </div>
    </div>
  );
}

function PolicySettings({ agentId }: { agentId: string }) {
  const [policy, setPolicy] = useState<PolicyRules | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyRules | null>(null);
  const [assetInput, setAssetInput] = useState('');
  const [destInput, setDestInput] = useState('');
  const [contractInput, setContractInput] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getPolicy(agentId);
        if (cancelled) return;
        setPolicy(deepClonePolicy(res.policy));
        setForm(deepClonePolicy(res.policy));
        setVersion(res.version);
        setUpdatedAt(res.updatedAt);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to load policy');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  const updateForm = (patch: Partial<PolicyRules>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateAmountField = (
    field: 'maxTxAmount' | 'dailySpendingLimit',
    asset: string,
    value: string,
  ) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev[field] };
      if (value.trim() === '') {
        delete next[asset];
      } else {
        next[asset] = value;
      }
      return { ...prev, [field]: next };
    });
  };

  const addListItem = (field: 'allowedAssets' | 'allowedDestinations' | 'allowedContractIds', value: string) => {
    if (!value.trim()) return;
    setForm((prev) => {
      if (!prev) return prev;
      if (prev[field].includes(value.trim())) return prev;
      return { ...prev, [field]: [...prev[field], value.trim()] };
    });
  };

  const removeListItem = (field: 'allowedAssets' | 'allowedDestinations' | 'allowedContractIds', value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: prev[field].filter((v) => v !== value) };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.updatePolicy(agentId, form);
      setPolicy(deepClonePolicy(res.policy));
      setForm(deepClonePolicy(res.policy));
      setVersion(res.version);
      setUpdatedAt(new Date().toISOString());
      setSuccess(`Policy updated (version ${res.version})`);
    } catch (e: any) {
      setError(e.message ?? 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton label="Loading policy..." />;
  if (error && !form) return <div className="error" role="alert">{error}</div>;
  if (!form) return <div className="error" role="alert">Unable to load policy</div>;

  const isDirty =
    policy && JSON.stringify(form) !== JSON.stringify(policy);

  return (
    <form onSubmit={handleSave} className="policy-form">
      {error && <div className="error" role="alert">{error}</div>}
      {success && <div className="success" role="status">{success}</div>}

      <div className="policy-section">
        <h3>Limits</h3>
        <div className="form-grid">
          <label>
            <span>Max Transaction Amount (XLM)</span>
            <input
              type="number"
              step="0.0000001"
              min="0"
              value={form.maxTxAmount.XLM ?? ''}
              onChange={(e) => updateAmountField('maxTxAmount', 'XLM', e.target.value)}
              placeholder="100"
            />
            <small>Maximum amount allowed for a single intent. Transactions above this are denied.</small>
          </label>
          <label>
            <span>Daily Spending Limit (XLM)</span>
            <input
              type="number"
              step="0.0000001"
              min="0"
              value={form.dailySpendingLimit.XLM ?? ''}
              onChange={(e) => updateAmountField('dailySpendingLimit', 'XLM', e.target.value)}
              placeholder="500"
            />
            <small>Aggregate daily spending limit enforced by backend. Once reached, further intents are denied until the next day.</small>
          </label>
          <label>
            <span>Approval Threshold (XLM)</span>
            <input
              type="number"
              step="0.0000001"
              min="0"
              value={form.approvalThreshold}
              onChange={(e) => updateForm({ approvalThreshold: e.target.value })}
              placeholder="50"
            />
            <small>Intents above this amount require human approval before execution.</small>
          </label>
        </div>
      </div>

      <div className="policy-section">
        <h3>Allowed Assets</h3>
        <ul className="policy-list">
          {form.allowedAssets.map((asset) => (
            <li key={asset}>
              <span>{asset}</span>
              <button
                type="button"
                aria-label={`Remove allowed asset ${asset}`}
                onClick={() => removeListItem('allowedAssets', asset)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label>
          <span>Add allowed asset</span>
          <input
            type="text"
            value={assetInput}
            onChange={(e) => setAssetInput(e.target.value)}
            placeholder="e.g. USDC"
          />
        </label>
        <button
          type="button"
          aria-label="Add allowed asset"
          onClick={() => {
            addListItem('allowedAssets', assetInput);
            setAssetInput('');
          }}
        >
          Add asset
        </button>
      </div>

      <div className="policy-section">
        <h3>Allowed Destinations</h3>
        <ul className="policy-list">
          {form.allowedDestinations.map((dest) => (
            <li key={dest}>
              <span>{dest}</span>
              <button
                type="button"
                aria-label={`Remove allowed destination ${dest}`}
                onClick={() => removeListItem('allowedDestinations', dest)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label>
          <span>Add allowed destination</span>
          <input
            type="text"
            value={destInput}
            onChange={(e) => setDestInput(e.target.value)}
            placeholder="G..."
          />
        </label>
        <button
          type="button"
          aria-label="Add allowed destination"
          onClick={() => {
            addListItem('allowedDestinations', destInput);
            setDestInput('');
          }}
        >
          Add destination
        </button>
      </div>

      <div className="policy-section">
        <h3>Allowed Contract IDs</h3>
        <ul className="policy-list">
          {form.allowedContractIds.map((cid) => (
            <li key={cid}>
              <span>{cid}</span>
              <button
                type="button"
                aria-label={`Remove allowed contract ${cid}`}
                onClick={() => removeListItem('allowedContractIds', cid)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label>
          <span>Add allowed contract ID</span>
          <input
            type="text"
            value={contractInput}
            onChange={(e) => setContractInput(e.target.value)}
            placeholder="C..."
          />
        </label>
        <button
          type="button"
          aria-label="Add allowed contract ID"
          onClick={() => {
            addListItem('allowedContractIds', contractInput);
            setContractInput('');
          }}
        >
          Add contract
        </button>
      </div>

      <div className="policy-actions">
        <button type="submit" disabled={saving || !isDirty}>
          {saving ? 'Saving...' : 'Save policy'}
        </button>
      </div>
    </form>
  );
}
