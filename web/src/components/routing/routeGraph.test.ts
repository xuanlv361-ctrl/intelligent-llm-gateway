import { describe, expect, it } from 'vitest';
import { buildProposedRoute, buildRecordedRoute } from './routeGraph';
import { fixtureComparison, fixtureRecord } from './routeGraphFixtures';

describe('routing graph pure projection', () => {
  it('has an honest empty state before comparison', () => {
    expect(buildProposedRoute(null)).toMatchObject({ nodes: [], edges: [], hasAttempts: false, mode: 'proposed' });
  });
  it('connects only the selected proposal to a not-executed result', () => {
    const graph = buildProposedRoute(fixtureComparison());
    expect(graph.nodes.find(node => node.id === 'proposal')).toMatchObject({ state: 'proposed', label: 'not_executed' });
    expect(graph.edges.filter(edge => edge.target === 'proposal')).toHaveLength(1);
    expect(graph.edges.find(edge => edge.target === 'proposal')?.source).toBe('offer:PRIMARY');
    expect(graph.nodes.find(node => node.id === 'offer:ALTERNATIVE')?.label).toBe('candidate');
    expect(graph.edges.every(edge => !edge.recorded)).toBe(true);
    expect(graph.events).toEqual([]);
  });
  it('does not invent a selected route when comparison has no eligible provider', () => {
    const comparison = fixtureComparison(); comparison.selected_channel = null;
    comparison.offers.forEach(offer => { offer.eligible = false; });
    const graph = buildProposedRoute(comparison);
    expect(graph.nodes.some(node => node.id === 'proposal')).toBe(false);
    expect(graph.nodes.filter(node => node.kind === 'provider').every(node => node.state === 'blocked')).toBe(true);
  });
  it('marks budget-denied proposals as blocked, never successful', () => {
    const comparison = fixtureComparison(); comparison.budget_check = { allowed: false, reasons: ['daily_budget_exceeded'], reserve_amount: '0.02', currency: 'USD' };
    expect(buildProposedRoute(comparison).nodes.find(node => node.id === 'proposal')).toMatchObject({ state: 'blocked', label: 'execution_blocked' });
  });
  it('preserves exact decimal strings and unmeasured values', () => {
    const details = buildProposedRoute(fixtureComparison()).nodes.find(node => node.id === 'offer:PRIMARY')!.details;
    expect(details.estimated_cost).toBe('0.000000123456789');
    expect(details.observed_success_rate).toBe('unknown');
    expect(details.sample_count).toBe('0');
  });
  it('projects a primary success from recorded evidence', () => {
    const graph = buildRecordedRoute(fixtureRecord());
    expect(graph.events.map(event => event.state)).toEqual(['success', 'success']);
    expect(graph.nodes.filter(node => node.kind === 'attempt')).toHaveLength(1);
    expect(graph.edges.every(edge => edge.recorded)).toBe(true);
  });
  it('keeps a failed final channel failed when billing is unknown', () => {
    const graph = buildRecordedRoute(fixtureRecord({ status: 'failed', success: false, cost_status: 'unknown', stop_reason: 'billing_uncertain',
      attempts: [{ channel_id: 'PRIMARY', success: false, status: 'failed', error_category: 'timeout', billing_state: 'unknown' }],
      fallback_trace: [{ channel_id: 'PRIMARY', action: 'dispatch' }, { channel_id: 'PRIMARY', action: 'stopped', reason: 'billing_uncertain' }] }));
    expect(graph.nodes.find(node => node.id === 'result')).toMatchObject({ state: 'failed', details: { final_channel: 'PRIMARY', stop_reason: 'billing_uncertain', billing_state: 'unknown' } });
    expect(graph.events.some(event => event.state === 'success')).toBe(false);
    expect(graph.nodes.filter(node => node.kind === 'attempt')).toHaveLength(1);
  });
  it('shows a backup only after its recorded dispatch and success', () => {
    const graph = buildRecordedRoute(fixtureRecord({ final_channel: 'BACKUP', attempts: [
      { channel_id: 'PRIMARY', success: false, status: 'failed', billing_state: 'not_charged', error_category: 'timeout' },
      { channel_id: 'BACKUP', success: true, status: 'success', billing_state: 'unknown' },
    ], fallback_trace: [{ channel_id: 'PRIMARY', action: 'dispatch' }, { channel_id: 'PRIMARY', action: 'retry_eligible', reason: 'retryable_not_charged' }, { channel_id: 'BACKUP', action: 'dispatch' }] }));
    expect(graph.events.map(event => [event.channel, event.state])).toEqual([['PRIMARY', 'failed'], ['BACKUP', 'success'], ['BACKUP', 'success']]);
  });
  it('shows circuit skips as not attempted, not failures', () => {
    const graph = buildRecordedRoute(fixtureRecord({ final_channel: 'BACKUP', attempts: [{ channel_id: 'BACKUP', success: true }],
      fallback_trace: [{ channel_id: 'PRIMARY', action: 'skipped', reason: 'circuit_open' }, { channel_id: 'BACKUP', action: 'dispatch' }] }));
    expect(graph.events[0]).toMatchObject({ channel: 'PRIMARY', state: 'skipped' });
    expect(graph.nodes.find(node => node.state === 'skipped')?.details.execution).toBe('not_attempted');
    expect(graph.nodes.filter(node => node.state === 'failed')).toHaveLength(0);
  });
  it('does not imply execution from a final channel alone', () => {
    const graph = buildRecordedRoute(fixtureRecord({ attempts: [], fallback_trace: [], success: null, status: 'in_progress' }));
    expect(graph.hasAttempts).toBe(false);
    expect(graph.nodes.find(node => node.id === 'result')?.label).toBe('no_attempts');
    expect(buildRecordedRoute(fixtureRecord({ attempts: [], fallback_trace: [] })).nodes.find(node => node.id === 'result')?.state).toBe('unknown');
  });
  it('does not mutate inputs and has stable IDs, geometry and output', () => {
    const comparison = fixtureComparison(); const record = fixtureRecord();
    const before = JSON.stringify({ comparison, record });
    expect(buildProposedRoute(comparison)).toEqual(buildProposedRoute(comparison));
    expect(buildRecordedRoute(record)).toEqual(buildRecordedRoute(record));
    expect(JSON.stringify({ comparison, record })).toBe(before);
    const reordered = { ...comparison, offers: [...comparison.offers].reverse() };
    expect(buildProposedRoute(reordered)).toEqual(buildProposedRoute(comparison));
  });
});
