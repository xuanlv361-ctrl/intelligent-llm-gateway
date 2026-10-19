import type { GatewayComparison, GatewayOffer, GatewayRecord } from '../../services/gatewayApi';

// Test-only contract fixtures. This file is not imported by the application.
export function fixtureOffer(channel = 'PRIMARY'): GatewayOffer {
  return { channel_id: channel, model_id: 'model-fixture', provider: `Provider ${channel}`, provider_model_id: `alias/${channel}`,
    currency: 'USD', estimated_cost: '0.000000123456789', quote_status: 'documented_estimate', source_urls: [], execution_enabled: false,
    eligible: true, health: { status: 'unmeasured', sample_count: 0, minimum_samples: 5, success_rate: null, p95_latency_ms: null, ttft_ms: null },
    access_policy: { stream: 'unknown', tool_calling: 'unknown', max_context_tokens: null, storage_regions: [], retention_days: null,
      training_use: 'unknown', sensitive_tasks_allowed: false, compliance_labels: [], verification_status: 'pending_confirmation', source_urls: [], verified_at: null } };
}
export function fixtureComparison(): GatewayComparison {
  return { model_id: 'model-fixture', requested_model: 'requested-fixture', as_of: '2026-10-19T12:00:00Z', offers: [fixtureOffer(), fixtureOffer('ALTERNATIVE')],
    selected_channel: 'PRIMARY', request_fingerprint: 'fixture', recommendation: { status: 'recommended', objective: 'balanced', reason: 'Recorded test contract only.', manual_override: false, score: 1, comparable_dimensions: ['cost'] }, limitations: [] };
}
export function fixtureRecord(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
  return { request_id: 'LOCAL-FIXTURE', project_id: 'fixture', model_id: 'model-fixture', currency: 'USD', occurred_at: '2026-10-19T12:00:00Z',
    status: 'success', success: true, selected_channel: 'PRIMARY', final_channel: 'PRIMARY', estimated_cost: '0.000000123456789', actual_cost: null,
    attempts: [{ channel_id: 'PRIMARY', success: true, status: 'success', billing_state: 'unknown' }],
    fallback_trace: [{ channel_id: 'PRIMARY', action: 'dispatch' }, { channel_id: 'PRIMARY', action: 'completed' }], is_mock: false, ...overrides };
}
