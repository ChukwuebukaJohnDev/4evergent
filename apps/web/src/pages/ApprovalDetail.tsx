import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { describeApiError } from '../apiErrors';
import type { ApprovalRecord } from '../types';
import { StatusBadge, Skeleton, EmptyState, DetailCard } from '../components';

export default function ApprovalDetail() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const [approval, setApproval] = useState<ApprovalRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!approvalId) return;
    setLoading(true);
    setError(null);
    api.approvalDetail(approvalId)
      .then((r) => setApproval(r.approval))
      .catch((e: any) => setError(describeApiError(e, 'Failed to load approval')))
      .finally(() => setLoading(false));
  }, [approvalId, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);

  const handleApprove = async () => {
    if (!approval || actionLoading) return;
    setActionLoading('approve');
    setActionError(null);
    try {
      await api.approve(approval.id);
      // Refresh approval state
      const r = await api.approvalDetail(approval.id);
      setApproval(r.approval);
    } catch (e: any) {
      if (e.status === 409) {
        setActionError(e.message ?? 'Approval state changed; please refresh');
      } else {
        setActionError(e.message ?? 'Approve failed');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!approval || actionLoading) return;
    if (!confirm('Reject this approval? This cannot be undone.')) return;
    setActionLoading('reject');
    setActionError(null);
    try {
      await api.reject(approval.id);
      const r = await api.approvalDetail(approval.id);
      setApproval(r.approval);
    } catch (e: any) {
      if (e.status === 409) {
        setActionError(e.message ?? 'Approval state changed; please refresh');
      } else {
        setActionError(e.message ?? 'Reject failed');
      }
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <Skeleton label="Loading approval..." />;
  if (error) return <EmptyState title="Failed to load approval" message={error} error={true} actionLabel="Retry" onAction={retry} />;
  if (!approval) return (
    <EmptyState title="Approval not found" message="This approval does not exist or you do not have access." />
  );

  const isPending = approval.status === 'pending_approval';
  const canApprove = isPending;
  const canReject = isPending;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Approval <code>{approval.id.slice(0, 8)}</code></h1>
          <p className="muted">
            Agent: {approval.agentId} · Activity: {approval.activityId.slice(0, 8)}
          </p>
        </div>
        <Link to="/approvals" className="btn btn-ghost btn-sm">Back to Approvals</Link>
      </div>

      <div className="detail-grid">
        <DetailCard title="Status"><StatusBadge status={approval.status} /></DetailCard>
        <DetailCard title="Agent"><code>{approval.agentId}</code></DetailCard>
        <DetailCard title="Activity"><code>{approval.activityId.slice(0, 8)}</code></DetailCard>
        <DetailCard title="Intent Type">{approval.intent.type}</DetailCard>
        <DetailCard title="Amount">{approval.intent.amount || '-'}</DetailCard>
        <DetailCard title="Asset">{approval.intent.asset || ''}</DetailCard>
        <DetailCard title="Destination">{approval.intent.destination ?? '-'}</DetailCard>
        <DetailCard title="Policy Decision"><span className="muted">{approval.policyDecision.reason}</span></DetailCard>
        <DetailCard title="Expires At">
          {approval.expiresAt ? new Date(approval.expiresAt).toLocaleString() : 'No expiry'}
        </DetailCard>
        <DetailCard title="Created">{new Date(approval.createdAt).toLocaleString()}</DetailCard>
      </div>

      {approval.error && (
        <div className="error-banner">{approval.error}</div>
      )}

      {actionError && (
        <div className="error-banner">{actionError}</div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
        {canApprove && (
          <button className="btn btn-primary" disabled={actionLoading !== null} onClick={handleApprove}>
            {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
          </button>
        )}
        {canReject && (
          <button className="btn btn-danger" disabled={actionLoading !== null} onClick={handleReject}>
            {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
          </button>
        )}
      </div>
    </section>
  );
}
