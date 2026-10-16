import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ActivityDetail from '../ActivityDetail';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    activityDetail: vi.fn(),
    listAgentExecutions: vi.fn(),
  },
}));

vi.mock('../../api', () => ({
  api: { activityDetail: mockApi.activityDetail, listAgentExecutions: mockApi.listAgentExecutions },
}));

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/agents/agent-a/activity/act-1']}>
      <Routes>
        <Route path="/agents/:agentId/activity/:activityId" element={<ActivityDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeActivity(): any {
  return {
    id: 'act-1',
    agentId: 'agent-a',
    ownerId: 'owner-a',
    intent: { type: 'payment', asset: 'XLM', amount: '50', destination: 'G...', reason: 'test' },
    policyDecision: { result: 'allow', reason: 'within limit', rule: 'maxTxAmount', intent: {} as any },
    authorizationStatus: 'not_required',
    simulationResult: { success: true, fee: '100', operations: 1, warnings: [] },
    txHash: 'ca1234567890abcdef',
    status: 'confirmed',
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
  };
}

describe('ActivityDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listAgentExecutions.mockResolvedValue({ executions: [] });
  });

  it('renders loading state', () => {
    mockApi.activityDetail.mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(screen.getByText('Loading activity...')).toBeInTheDocument();
  });

  it('renders activity detail on success', async () => {
    mockApi.activityDetail.mockResolvedValue({ activity: makeActivity() });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('act-1')).toBeInTheDocument();
    });
    expect(screen.getByText('payment')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    mockApi.activityDetail.mockRejectedValue(new Error('API error'));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('API error')).toBeInTheDocument();
    });
  });

  it('renders not-found when activity is null', async () => {
    mockApi.activityDetail.mockResolvedValue({ activity: null });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Activity not found')).toBeInTheDocument();
    });
  });

  it('calls activityDetail with correct agentId and activityId', async () => {
    mockApi.activityDetail.mockResolvedValue({ activity: makeActivity() });
    renderDetail();
    await waitFor(() => {
      expect(mockApi.activityDetail).toHaveBeenCalledWith('agent-a', 'act-1');
    });
  });

  it('renders policy decision section when present', async () => {
    mockApi.activityDetail.mockResolvedValue({ activity: makeActivity() });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Policy Decision')).toBeInTheDocument();
    });
    expect(screen.getByText('within limit')).toBeInTheDocument();
  });

  it('renders authorization status when present', async () => {
    mockApi.activityDetail.mockResolvedValue({ activity: makeActivity() });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Authorization')).toBeInTheDocument();
    });
    expect(screen.getByText('not_required')).toBeInTheDocument();
  });

  it('renders error details when activity has error', async () => {
    const activity = makeActivity();
    activity.error = 'Transaction failed: insufficient funds';
    mockApi.activityDetail.mockResolvedValue({ activity });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
    expect(screen.getByText('Transaction failed: insufficient funds')).toBeInTheDocument();
  });
});
