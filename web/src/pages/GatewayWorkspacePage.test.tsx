import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GatewayWorkspacePage from './GatewayWorkspacePage';
import { gatewayApi, GatewayAccessPolicy, GatewayBudget, GatewayCatalog, GatewayComparison, GatewayOffer, GatewayRecord } from '../services/gatewayApi';
import { apiRequest } from '../lib/apiClient';

vi.mock('../services/gatewayApi', () => ({ gatewayApi: {
  catalog: vi.fn(), compare: vi.fn(), budget: vi.fn(), saveBudget: vi.fn(), execute: vi.fn(),
  records: vi.fn(), analytics: vi.fn(), alerts: vi.fn(), replay: vi.fn(), saveAccessPolicy: vi.fn(), settle: vi.fn(),
} }));
vi.mock('../lib/apiClient', () => ({ apiRequest: vi.fn() }));

// Test fixtures describe API contracts only. They never become product data.
const access: GatewayAccessPolicy = { stream: 'unknown', tool_calling: 'unknown', max_context_tokens: null,
  storage_regions: [], retention_days: null, training_use: 'unknown', sensitive_tasks_allowed: false,
  compliance_labels: [], verification_status: 'pending_confirmation', source_urls: [], verified_at: null };
const offer = (id: string, provider: string): GatewayOffer => ({ channel_id: id, model_id: 'deepseek-fixture-version',
  provider, provider_model_id: `fixture/${id}`, currency: 'USD', estimated_cost: '0.0054',
  quote_status: 'documented_estimate', execution_enabled: false, eligible: true, exclusion_reasons: [],
  verified_at: '2026-10-19T00:00:00Z', source_urls: ['https://example.test/pricing'], access_policy: access,
  health: { status: 'unmeasured', sample_count: 0, minimum_samples: 5, success_rate: null, p95_latency_ms: null, ttft_ms: null },
  price_breakdown: { uncached_input_cost: '0.003', cached_input_cost: '0', output_cost: '0.0024',
    input_price: '0.30', output_price: '1.20', cached_input_price: null, input_tokens: 10000, cached_input_tokens: 0, output_tokens: 2000 },
});
const catalog: GatewayCatalog = { models: [{ model_id: 'deepseek-fixture-version', offer_count: 2, providers: ['Fixture direct', 'Fixture alternative'], aliases: [] }],
  offers: [offer('DIRECT', 'Fixture direct'), offer('ALTERNATIVE', 'Fixture alternative')], offer_count: 2,
  as_of: '2026-10-19T12:00:00Z', execution_readiness: { DIRECT: { ready: false, enabled: false, credential_configured: false } } };
const budget: GatewayBudget = { currency: 'USD', daily_limit: '10', monthly_limit: '50', daily_spent: '1', monthly_spent: '3', daily_remaining: '9', monthly_remaining: '47', reserved_amount: '0' };
const comparison: GatewayComparison = { model_id: 'deepseek-fixture-version', requested_model: 'deepseek-fixture-version',
  as_of: catalog.as_of, offers: catalog.offers, selected_channel: 'DIRECT', request_fingerprint: 'fixture-sha',
  recommendation: { status: 'recommended', objective: 'balanced', reason: 'Fixture documented price comparison; reliability is unmeasured.', manual_override: false, score: 1, comparable_dimensions: ['cost'] },
  budget, budget_check: { allowed: true, reasons: [], reserve_amount: '0.0108', currency: 'USD' },
  limitations: ['Fixture published prices exclude taxes.'] };

function setup() { render(<GatewayWorkspacePage />); return userEvent.setup(); }

describe('Gateway provider decision desk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gatewayApi.catalog).mockResolvedValue(structuredClone(catalog));
    vi.mocked(gatewayApi.budget).mockResolvedValue(budget);
    vi.mocked(gatewayApi.compare).mockResolvedValue(structuredClone(comparison));
    vi.mocked(gatewayApi.records).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(gatewayApi.alerts).mockResolvedValue({ items: [] });
    vi.mocked(gatewayApi.analytics).mockResolvedValue({ period: 'month', period_start: '2026-10-01T00:00:00Z', period_end: catalog.as_of, record_count: 0, currencies: {}, channel_cost_attribution: 'request final channel' });
    vi.mocked(gatewayApi.replay).mockResolvedValue({ request_count: 0, channel_change_count: 0, priced_count: 0, pricing_coverage: null, scenario_price_basis: 'current_documented_price', estimated_savings_by_currency: {}, rows: [], limitations: ['Unexecuted outcomes are unknown.'] });
  });

  it('loads actual API catalog and preserves unmeasured provider health', async () => {
    setup();
    expect(await screen.findByText('Fixture direct')).toBeInTheDocument();
    expect(screen.getAllByText('Unmeasured').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute selected route' })).toBeDisabled();
    expect(gatewayApi.execute).not.toHaveBeenCalled();
    expect(gatewayApi.compare).not.toHaveBeenCalled();
  });

  it('compares without executing and shows an itemised cost reserve', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    expect(await screen.findByText(/Fixture documented price comparison/)).toBeInTheDocument();
    const receipt = within(screen.getByLabelText('Request cost receipt'));
    expect(receipt.getByText('0.003')).toBeInTheDocument();
    expect(receipt.getByText('0.0024')).toBeInTheDocument();
    expect(receipt.getByText('USD 0.0108')).toBeInTheDocument();
    expect(gatewayApi.compare).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 10000, output_tokens: 2000, model_id: 'deepseek-fixture-version' }));
    expect(gatewayApi.execute).not.toHaveBeenCalled();
  });

  it('manual choice and strict requirements are sent to server eligibility checks', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByLabelText('Select Fixture alternative'));
    await user.click(screen.getByText('Capability & privacy requirements'));
    await user.click(screen.getByLabelText('Streaming required'));
    await user.click(screen.getByLabelText('No training use'));
    await user.type(screen.getByLabelText('Allowed storage regions'), 'UK, EU');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await waitFor(() => expect(gatewayApi.compare).toHaveBeenCalledWith(expect.objectContaining({
      manual_channel_id: 'ALTERNATIVE', requirements: expect.objectContaining({ stream: true, require_no_training: true, allowed_regions: ['UK', 'EU'] }),
    })));
  });

  it('invalidates a quote when request content changes and never enables unconfigured execution', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await screen.findByText(/Fixture documented price comparison/);
    await user.type(screen.getByLabelText('Request message'), 'Explain a graph.');
    expect(screen.queryByText(/Fixture documented price comparison/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute selected route' })).toBeDisabled();
    expect(gatewayApi.execute).not.toHaveBeenCalled();
  });

  it('never displays catalog default costs as estimates for an unquoted request', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    let table = within(screen.getByRole('table'));
    expect(table.getAllByText('Awaiting quote')).toHaveLength(2);
    expect(table.queryByText('USD 0.0054')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await screen.findByText(/Fixture documented price comparison/);
    table = within(screen.getByRole('table'));
    expect(table.getAllByText('USD 0.0054')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Maximum output tokens'), { target: { value: '3000' } });
    expect(table.getAllByText('Awaiting quote')).toHaveLength(2);
    expect(table.queryByText('USD 0.0054')).not.toBeInTheDocument();
  });

  it('global refresh reloads usage for the current project and period', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('tab', { name: 'Usage' }));
    await screen.findByText(/No execution records for this project/);
    expect(gatewayApi.analytics).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Refresh data' }));
    await waitFor(() => expect(gatewayApi.analytics).toHaveBeenCalledTimes(2));
    expect(gatewayApi.analytics).toHaveBeenLastCalledWith('month', 'default');
  });

  it('requires approval and server readiness; retries reuse the local execution ID', async () => {
    vi.mocked(gatewayApi.catalog).mockResolvedValue({ ...catalog, execution_readiness: { DIRECT: { ready: true, enabled: true, credential_configured: true } } });
    vi.mocked(gatewayApi.execute).mockRejectedValue(new Error('Fixture connection interrupted. Retry uses the same execution identity.'));
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.type(screen.getByLabelText('Request message'), 'Explain a graph.');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await screen.findByText(/Fixture documented price comparison/);
    expect(screen.getByRole('button', { name: 'Execute selected route' })).toBeDisabled();
    await user.click(screen.getByLabelText('I authorise this request and the displayed cost reserve.'));
    await user.click(screen.getByRole('button', { name: 'Execute selected route' }));
    await screen.findByText(/Fixture connection interrupted/);
    await user.click(screen.getByRole('button', { name: 'Execute selected route' }));
    await waitFor(() => expect(gatewayApi.execute).toHaveBeenCalledTimes(2));
    const firstId = vi.mocked(gatewayApi.execute).mock.calls[0][0];
    expect(firstId).toMatch(/^GW-/);
    expect(vi.mocked(gatewayApi.execute).mock.calls[1][0]).toBe(firstId);
  });

  it('shows a returned answer without pretending it was stored in decision history', async () => {
    vi.mocked(gatewayApi.catalog).mockResolvedValue({ ...catalog, execution_readiness: { DIRECT: { ready: true, enabled: true, credential_configured: true } } });
    vi.mocked(gatewayApi.execute).mockResolvedValue({ request_id: 'FIXTURE-SUCCESS', project_id: 'default',
      model_id: 'deepseek-fixture-version', currency: 'USD', occurred_at: catalog.as_of,
      status: 'completed', success: true, final_channel: 'DIRECT', estimated_cost: '0.01', actual_cost: null,
      attempts: [], fallback_trace: [], is_mock: false, response_content: 'Fixture answer: a graph contains vertices and edges.' });
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.type(screen.getByLabelText('Request message'), 'Explain a graph.');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await screen.findByText(/Fixture documented price comparison/);
    await user.click(screen.getByLabelText('I authorise this request and the displayed cost reserve.'));
    await user.click(screen.getByRole('button', { name: 'Execute selected route' }));
    expect(await screen.findByText('Fixture answer: a graph contains vertices and edges.')).toBeInTheDocument();
    expect(screen.getByText(/not saved to decision history/)).toBeInTheDocument();
  });

  it('budget rejection disables execution even when an adapter is ready', async () => {
    vi.mocked(gatewayApi.catalog).mockResolvedValue({ ...catalog, execution_readiness: { DIRECT: { ready: true, enabled: true, credential_configured: true } } });
    vi.mocked(gatewayApi.compare).mockResolvedValue({ ...comparison, budget_check: { allowed: false, reasons: ['daily_budget_exceeded'], reserve_amount: '0.0108', currency: 'USD' } });
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.type(screen.getByLabelText('Request message'), 'Short request');
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    expect(await screen.findByText(/daily budget exceeded/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('I authorise this request and the displayed cost reserve.'));
    expect(screen.getByRole('button', { name: 'Execute selected route' })).toBeDisabled();
  });

  it('shows honest empty states on usage, history, alerts and replay', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(await screen.findByText(/No execution records for this project/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Identity & recovery' }));
    expect(await screen.findByText(/No executions recorded/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Alerts & replay' }));
    expect(await screen.findByText(/No active conditions in the available evidence/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run what-if analysis' }));
    expect(await screen.findByText(/No eligible history for this project/)).toBeInTheDocument();
    expect(gatewayApi.replay).toHaveBeenCalledWith({ objective: 'lowest_cost', excluded_channels: [], project_id: 'default' });
  });

  it('exposes each recorded recovery step and keeps missing identities unknown', async () => {
    const record: GatewayRecord = { request_id: 'FIXTURE-LOCAL-EXEC', project_id: 'default', model_id: 'deepseek-fixture-version',
      currency: 'USD', occurred_at: catalog.as_of, status: 'failed', success: false, final_channel: 'DIRECT', estimated_cost: '0.01', actual_cost: null,
      attempts: [{ channel_id: 'DIRECT', success: false, status: 'failed', error_category: 'timeout', billing_state: 'unknown' }],
      fallback_trace: [{ channel_id: 'DIRECT', action: 'dispatch' }, { channel_id: 'DIRECT', action: 'stopped', reason: 'billing_uncertain' }],
      identity: { requested_model: 'deepseek-fixture-version', verification_status: 'pending_confirmation', actual_returned_model: null, billed_model: null }, is_mock: false };
    vi.mocked(gatewayApi.records).mockResolvedValue({ items: [record], total: 1 });
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('tab', { name: 'Identity & recovery' }));
    await user.click(await screen.findByText('FIXTURE-LOCAL-EXEC', { selector: 'summary code' }));
    expect(screen.getByRole('heading', { name: 'Attempt sequence' })).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText(/billing uncertain/)).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });

  it('access policy editor requires source evidence and never invents capabilities', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('tab', { name: 'Access policies' }));
    expect(screen.getByLabelText('Streaming')).toHaveValue('unknown');
    expect(screen.getByLabelText('Training use')).toHaveValue('unknown');
    expect(screen.getByLabelText('Sensitive tasks approved for this account')).not.toBeChecked();
    expect(screen.getByLabelText('Evidence source URLs')).toBeRequired();
    expect(screen.getByLabelText('Account or contract evidence reference')).toBeRequired();
    expect(gatewayApi.saveAccessPolicy).not.toHaveBeenCalled();
  });

  it('preserves comma and newline input when reviewing a provider policy', async () => {
    vi.mocked(gatewayApi.saveAccessPolicy).mockResolvedValue({ channel_id: 'DIRECT', access_policy: access });
    const user = setup();
    await screen.findByText('Fixture direct');
    await user.click(screen.getByRole('tab', { name: 'Access policies' }));
    await user.type(screen.getByLabelText('Storage regions'), 'UK, EU');
    await user.type(screen.getByLabelText('Evidence source URLs'), 'https://example.test/terms\nhttps://example.test/account');
    await user.type(screen.getByLabelText('Account or contract evidence reference'), 'FIXTURE-ACCOUNT-REVIEW');
    await user.click(screen.getByRole('button', { name: 'Save reviewed policy' }));
    await waitFor(() => expect(gatewayApi.saveAccessPolicy).toHaveBeenCalledWith('DIRECT', expect.objectContaining({
      storage_regions: ['UK', 'EU'], source_urls: ['https://example.test/terms', 'https://example.test/account'],
      evidence_reference: 'FIXTURE-ACCOUNT-REVIEW',
    })));
  });

  it('conservative input bound grows with a real prompt before obtaining a quote', async () => {
    const user = setup();
    await screen.findByText('Fixture direct');
    fireEvent.change(screen.getByLabelText('Input tokens (including cache)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Request message'), { target: { value: '水循环'.repeat(20) } });
    await user.click(screen.getByRole('button', { name: 'Compare providers' }));
    await waitFor(() => expect(gatewayApi.compare).toHaveBeenCalled());
    const payload = vi.mocked(gatewayApi.compare).mock.calls[0][0];
    const bound = new TextEncoder().encode(JSON.stringify([{ role: 'user', content: '水循环'.repeat(20) }])).length + 1040;
    expect(payload.input_tokens).toBe(bound);
  });

  it('surfaces catalog failures with a retry instead of placeholder providers', async () => {
    vi.mocked(gatewayApi.catalog).mockRejectedValueOnce(new Error('Fixture catalog unavailable'));
    const user = setup();
    expect(await screen.findByText(/Fixture catalog unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Fixture direct')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry catalog' }));
    expect(await screen.findByText('Fixture direct')).toBeInTheDocument();
  });
});

describe('Gateway HTTP request contract', () => {
  it('submits only editable policy fields and preserves the server response wrapper', async () => {
    const actual = await vi.importActual<typeof import('../services/gatewayApi')>('../services/gatewayApi');
    const reviewed = { ...access, verified_at: '2026-10-19T12:00:00Z', reviewed_by: 'FIXTURE-ADMIN', evidence_reference: 'FIXTURE-REVIEW' };
    const response = { channel_id: 'DIRECT', access_policy: reviewed };
    vi.mocked(apiRequest).mockResolvedValue(response);
    expect(await actual.gatewayApi.saveAccessPolicy('DIRECT', reviewed)).toEqual(response);
    const [path, options] = vi.mocked(apiRequest).mock.calls.at(-1)!;
    expect(path).toBe('/api/v1/gateway/access-policy/DIRECT');
    const body = JSON.parse(String(options?.body));
    expect(body.evidence_reference).toBe('FIXTURE-REVIEW');
    expect(body).not.toHaveProperty('verified_at');
    expect(body).not.toHaveProperty('reviewed_by');
    expect(body).not.toHaveProperty('channel_id');
  });
});
