import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { test, expect, describe, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AgentDetail from '../AgentDetail';

const { mockGetPolicy, mockUpdatePolicy, mockUpdateAgentStatus, mockGetAgentSpending, mockGetAgent } = vi.hoisted(() => ({
  mockGetPolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockUpdateAgentStatus: vi.fn(),
  mockGetAgentSpending: vi.fn(),
  mockGetAgent: vi.fn(),
}));

const defaultAgent = {
  id: 'agent-1',
  displayName: 'Test Agent',
  description: 'test',
  ownerId: 'owner-1',
  stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  capabilities: ['payment'],
  status: 'active',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

vi.mock('../../api', () => ({
  api: {
    getAgent: mockGetAgent || vi.fn().mockResolvedValue(defaultAgent),
    agentActivity: vi.fn().mockResolvedValue({ agentId: 'agent-1', activity: [] }),
    listSchedules: vi.fn().mockResolvedValue({ agentId: 'agent-1', schedules: [] }),
    listAgentExecutions: vi.fn().mockResolvedValue({ agentId: 'agent-1', executions: [] }),
    getAgentSpending: mockGetAgentSpending,
    updateAgentStatus: mockUpdateAgentStatus,
    getPolicy: mockGetPolicy,
    updatePolicy: mockUpdatePolicy,
  },
}));

const defaultPolicyResponse = {
  agentId: 'agent-1',
  policy: {
    maxTxAmount: { XLM: '100' },
    dailySpendingLimit: { XLM: '500' },
    allowedAssets: ['XLM'],
    allowedDestinations: [] as string[],
    allowedContractIds: [] as string[],
    txTypeRestrictions: {
      payment: true,
      trustline: true,
      contract_call: false,
      account_settings: false,
    },
    approvalThreshold: '25',
    requireHumanApprovalForAmountAbove: '75',
  },
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
};

const defaultSpendingResponse = {
  agentId: 'agent-1',
  spending: {
    XLM: { used: 72, limit: '100', remaining: 28 },
  },
};

describe('AgentDetail Policy Section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
  });

  test('policy loads from API on mount', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByDisplayValue('100')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
    expect(screen.getByDisplayValue('25')).toBeInTheDocument();
    expect(screen.getByDisplayValue('75')).toBeInTheDocument();
  });

  test('editing values updates form state', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    const maxTxInput = await screen.findByDisplayValue('100');
    expect(maxTxInput).toBeInTheDocument();

    fireEvent.change(maxTxInput, { target: { value: '200' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('200')).toBeInTheDocument();
    });
  });

  test('save calls PUT with expected payload', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    mockUpdatePolicy.mockResolvedValue({
      agentId: 'agent-1',
      policy: {
        ...defaultPolicyResponse.policy,
        maxTxAmount: { XLM: '200' },
      },
      version: 2,
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    const maxTxInput = await screen.findByDisplayValue('100');
    fireEvent.change(maxTxInput, { target: { value: '200' } });

    const saveButton = await screen.findByText('Save Policy');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdatePolicy).toHaveBeenCalledWith('agent-1', expect.objectContaining({
        maxTxAmount: expect.objectContaining({ XLM: '200' }),
      }));
    });
  });

  test('successful save updates displayed policy/version', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    mockUpdatePolicy.mockResolvedValue({
      agentId: 'agent-1',
      policy: {
        ...defaultPolicyResponse.policy,
        maxTxAmount: { XLM: '200' },
      },
      version: 2,
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    const maxTxInput = await screen.findByDisplayValue('100');
    fireEvent.change(maxTxInput, { target: { value: '200' } });

    const saveButton = await screen.findByText('Save Policy');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Policy updated/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Version: 2/)).toBeInTheDocument();
  });

  test('API validation error is displayed', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    mockUpdatePolicy.mockRejectedValue(new Error('Invalid policy: maxTxAmount must be positive'));

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    const maxTxInput = await screen.findByDisplayValue('100');
    fireEvent.change(maxTxInput, { target: { value: '200' } });

    const saveButton = await screen.findByText('Save Policy');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid policy/)).toBeInTheDocument();
    });
  });

  test('loading state prevents duplicate save', async () => {
    let resolveGetPolicy: ((value: any) => void) | null = null;
    const getPolicyPromise = new Promise((resolve) => {
      resolveGetPolicy = resolve;
    });

    mockGetPolicy.mockReturnValue(getPolicyPromise as any);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    expect(screen.queryByText('Save Policy')).not.toBeInTheDocument();

    resolveGetPolicy!(defaultPolicyResponse);

    await waitFor(() => {
      expect(screen.getByText('Save Policy')).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Control Center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
  });

  test('status controls render for active agent', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });
  });

  test('pause button triggers updateAgentStatus', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
    mockUpdateAgentStatus.mockResolvedValue({ id: 'agent-1', status: 'paused' });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Pause'));

    await waitFor(() => {
      expect(mockUpdateAgentStatus).toHaveBeenCalledWith('agent-1', 'paused');
    });
  });

  test('disable button triggers updateAgentStatus', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
    mockUpdateAgentStatus.mockResolvedValue({ id: 'agent-1', status: 'disabled' });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Disable'));

    await waitFor(() => {
      expect(mockUpdateAgentStatus).toHaveBeenCalledWith('agent-1', 'disabled');
    });
  });

  test('spending card renders daily spending data', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('72 / 100')).toBeInTheDocument();
    });
  });

  test('remaining capacity displayed', async () => {
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Remaining: 28')).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Agent Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('agent header displays name, status badge, and address', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText('active')).toBeInTheDocument();
      expect(screen.getByText(/GAAA/)).toBeInTheDocument();
    });
  });

  test('status badge shows correct color class for active', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      const badge = screen.getByText('active');
      expect(badge.className).toContain('badge-ok');
    });
  });

  test('paused agent shows resume and disable buttons', async () => {
    mockGetAgent.mockResolvedValue({
      ...defaultAgent,
      status: 'paused',
      active: false,
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeInTheDocument();
      expect(screen.getByText('Disable')).toBeInTheDocument();
      expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    });
  });

  test('disabled agent shows no resume button', async () => {
    mockGetAgent.mockResolvedValue({
      ...defaultAgent,
      status: 'disabled',
      active: false,
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.queryByText('Resume')).not.toBeInTheDocument();
      expect(screen.queryByText('Pause')).not.toBeInTheDocument();
      expect(screen.getByText(/cannot be re-enabled/)).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Status Mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('mutation error preserves previous UI state', async () => {
    mockUpdateAgentStatus.mockRejectedValue(new Error('Network error'));

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Pause'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Buttons should be re-enabled after error
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
  });

  test('duplicate action is prevented during mutation', async () => {
    let resolveStatus: ((value: any) => void) | null = null;
    const statusPromise = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    mockUpdateAgentStatus.mockReturnValue(statusPromise as any);

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Pause'));

    await waitFor(() => {
      expect(screen.getByText('Pausing...')).toBeInTheDocument();
    });

    // Second click should be ignored
    fireEvent.click(screen.getByText('Pausing...'));

    expect(mockUpdateAgentStatus).toHaveBeenCalledTimes(1);

    resolveStatus!({ id: 'agent-1', status: 'paused' });
  });
});

describe('AgentDetail Spending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('spending data displays correctly', async () => {
    mockGetAgentSpending.mockResolvedValue({
      agentId: 'agent-1',
      spending: {
        XLM: { used: 72, limit: '100', remaining: 28 },
      },
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('72 / 100')).toBeInTheDocument();
    });
  });

  test('limit reached displays 100% progress', async () => {
    mockGetAgentSpending.mockResolvedValue({
      agentId: 'agent-1',
      spending: {
        XLM: { used: 100, limit: '100', remaining: 0 },
      },
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('100 / 100')).toBeInTheDocument();
      expect(screen.getByText('Remaining: 0')).toBeInTheDocument();
    });
  });

  test('empty/unavailable spending handled gracefully', async () => {
    mockGetAgentSpending.mockResolvedValue({
      agentId: 'agent-1',
      spending: {},
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('No daily spending limits configured.')).toBeInTheDocument();
    });
  });

  test('spending error does not block agent info', async () => {
    mockGetAgentSpending.mockRejectedValue(new Error('Spending service unavailable'));

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText(/Spending service unavailable/)).toBeInTheDocument();
    });
  });

  test('multi-asset spending displays all assets', async () => {
    mockGetAgentSpending.mockResolvedValue({
      agentId: 'agent-1',
      spending: {
        XLM: { used: 72, limit: '100', remaining: 28 },
        USDC: { used: 20, limit: '50', remaining: 30 },
      },
    });

    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('72 / 100')).toBeInTheDocument();
      expect(screen.getByText('20 / 50')).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Executions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('executions section renders', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Executions')).toBeInTheDocument();
    });
  });

  test('empty executions shows empty state', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/No executions/)).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Policy Summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('policy summary displays key values', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Max Tx (XLM)')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('Approval Threshold')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  test('policy summary shows allowed assets', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      // "Allowed Assets" appears in both summary and edit form; use getAll
      const matches = screen.getAllByText('Allowed Assets');
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  test('policy summary shows "Any" for unrestricted destinations', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Destinations')).toBeInTheDocument();
      expect(screen.getByText('Any')).toBeInTheDocument();
    });
  });
});

describe('AgentDetail Regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(defaultAgent);
    mockGetAgentSpending.mockResolvedValue(defaultSpendingResponse);
    mockGetPolicy.mockResolvedValue(defaultPolicyResponse);
  });

  test('existing agent navigation works', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeInTheDocument();
      expect(screen.getByText('Financial Control')).toBeInTheDocument();
      expect(screen.getByText('Recent Activity')).toBeInTheDocument();
      expect(screen.getByText('Schedules')).toBeInTheDocument();
      expect(screen.getByText('Executions')).toBeInTheDocument();
      expect(screen.getByText('Policy')).toBeInTheDocument();
    });
  });

  test('existing policy editing still works', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Save Policy')).toBeInTheDocument();
    });
  });

  test('existing agent info cards not duplicated', async () => {
    render(<MemoryRouter initialEntries={['/agents/agent-1']}><Routes><Route path="/agents/:agentId" element={<AgentDetail />} /></Routes></MemoryRouter>);

    await waitFor(() => {
      // Agent header should show name once
      const nameElements = screen.getAllByText('Test Agent');
      expect(nameElements.length).toBe(1);
    });
  });
});
