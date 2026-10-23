import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ApprovalDetail from '../ApprovalDetail';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    approvalDetail: vi.fn(),
  },
}));

vi.mock('../../api', () => ({ api: mockApi }));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/approvals/aprv-1']}>
      <Routes>
        <Route path="/approvals/:approvalId" element={<ApprovalDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeApproval(): any {
  return {
    id: 'aprv-1',
    activityId: 'act-1',
    agentId: 'agent-a',
    intent: { type: 'payment', asset: 'XLM', amount: '50', destination: 'GXXX', reason: 'test' },
    policyDecision: { result: 'requires_approval', reason: 'test', rule: 'test', intent: {} as any },
    status: 'pending_approval',
    requestedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('ApprovalDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockApi.approvalDetail.mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(screen.getByText(/Loading approval/i)).toBeInTheDocument();
  });

  it('renders approval detail on success', async () => {
    mockApi.approvalDetail.mockResolvedValue({ approval: makeApproval() });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/Approval/i)).toBeInTheDocument();
    });
    expect(screen.getByText('agent-a')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    mockApi.approvalDetail.mockRejectedValue(new Error('API error'));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('API error')).toBeInTheDocument();
    });
  });

  it('renders not-found when approval is null', async () => {
    mockApi.approvalDetail.mockResolvedValue({ approval: null });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Approval not found')).toBeInTheDocument();
    });
  });
});
