import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { AgentRecord } from '../types';
import { StatusBadge, Skeleton, EmptyState } from '../components';

export default function Agents() {
  const [agents, setAgents] = useState<AgentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const load = () => {
    api.listAgents()
      .then((a) => setAgents(a.agents))
      .catch((e: any) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!showCreate) return;
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCreate(false);
        return;
      }
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [showCreate]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) { setCreateError('Name is required'); return; }
    setCreating(true);
    try {
      const caps = capabilities.trim() ? capabilities.split(',').map((c) => c.trim()).filter(Boolean) : [];
      const res = await api.createAgent({ displayName: name.trim(), description: description.trim() || undefined, capabilities: caps.length ? caps : undefined });
      setName('');
      setDescription('');
      setCapabilities('');
      setShowCreate(false);
      setAgents((prev) => [...(prev ?? []), res.agent]);
      navigate(`/agents/${res.agent.id}`);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (error) return <EmptyState title="Failed to load agents" message={error} />;
  if (agents === null) return <Skeleton label="Loading agents..." />;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Agents</h1>
          <p className="muted">Configure and manage your financial agents.</p>
        </div>
        <button ref={triggerRef} className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Create Agent
        </button>
      </div>

      {agents.length === 0 && !showCreate ? (
        <EmptyState
          title="No agents yet"
          message="Create your first agent to start submitting intents and schedules."
        />
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Address</th><th>Capabilities</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/agents/${a.id}`} className="table-row-link">
                      {a.displayName}
                    </Link>
                  </td>
                  <td><code>{a.stellarAddress}</code></td>
                  <td>{a.capabilities.join(', ')}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>
                    <Link to={`/agents/${a.id}`} className="btn btn-ghost btn-sm">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-agent-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-agent-title">Create Agent</h2>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="agent-name">Name</label>
                <input
                  id="agent-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Agent"
                  required
                  className="input"
                />
              </div>

              <div className="field">
                <label htmlFor="agent-description">Description (optional)</label>
                <input
                  id="agent-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this agent manages..."
                  className="input"
                />
              </div>

              <div className="field">
                <label htmlFor="agent-capabilities">Capabilities (comma-separated)</label>
                <input
                  id="agent-capabilities"
                  type="text"
                  value={capabilities}
                  onChange={(e) => setCapabilities(e.target.value)}
                  placeholder="payment, trustline"
                  className="input"
                />
                <div className="field-hint">Capabilities this agent can execute.</div>
              </div>

              {createError && <div className="error-banner" role="alert">{createError}</div>}

              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
