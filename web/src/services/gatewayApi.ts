import { apiRequest } from '../lib/apiClient';

export type GatewayObjective = 'balanced' | 'lowest_cost' | 'lowest_latency' | 'highest_reliability';
export interface GatewayRequirements {
  stream: boolean; tool_calling: boolean; context_tokens: number; sensitive: boolean;
  allowed_regions: string[]; require_no_training: boolean;
}
export interface GatewayProfile {
  project_id: string; model_id: string; input_tokens: number; output_tokens: number;
  cached_input_tokens: number; objective: GatewayObjective; manual_channel_id: string | null;
  requirements: GatewayRequirements;
}
export interface GatewayAccessPolicy {
  stream: 'unknown' | 'supported' | 'unsupported';
  tool_calling: 'unknown' | 'supported' | 'unsupported'; max_context_tokens: number | null;
  storage_regions: string[]; retention_days: number | null;
  training_use: 'unknown' | 'not_used' | 'used'; sensitive_tasks_allowed: boolean;
  compliance_labels: string[]; verification_status: string; source_urls: string[];
  verified_at: string | null; evidence_reference?: string;
}
export interface GatewayIdentity {
  requested_model?: string | null; provider_model_alias?: string | null;
  actual_returned_model?: string | null; actual_model?: string | null;
  billed_model?: string | null; verification_status: string; last_verified_at?: string | null;
  mismatch_reasons?: string[]; evidence_note?: string;
}
export interface GatewayHealth {
  status: string; sample_count: number; minimum_samples: number; success_rate: number | null;
  p50_latency_ms?: number | null; p95_latency_ms: number | null; ttft_ms: number | null;
  observed_at?: string | null; window_hours?: number;
  success_rate_ci95?: { lower: number; upper: number } | null;
}
export interface GatewayOffer {
  channel_id: string; model_id: string; provider: string; provider_model_id: string;
  currency: string | null; estimated_cost: string | null; quote_status: string;
  verified_at?: string; pricing_verified_at?: string; source_urls: string[];
  execution_enabled: boolean; eligible?: boolean; exclusion_reasons?: string[];
  score?: number | null; identity?: GatewayIdentity; health: GatewayHealth;
  access_policy: GatewayAccessPolicy;
  price_breakdown?: {
    uncached_input_cost: string; cached_input_cost: string; output_cost: string;
    input_price: string; output_price: string; cached_input_price: string | null;
    input_tokens: number; cached_input_tokens: number; output_tokens: number;
  } | null;
  difference_vs_selected?: { estimated_cost: string | null; success_rate: number | null; p95_latency_ms: number | null };
}
export interface GatewayReadiness { enabled: boolean; credential_configured: boolean; ready: boolean; supported_execution?: string; reasons?: string[] }
export interface GatewayCatalog {
  models: { model_id: string; offer_count: number; providers: string[]; aliases: string[] }[];
  offers: GatewayOffer[]; offer_count: number; as_of: string;
  execution_readiness?: Record<string, GatewayReadiness>;
}
export interface GatewayBudget {
  currency: string; daily_limit: string | null; monthly_limit: string | null;
  daily_spent: string; monthly_spent: string; daily_remaining: string | null;
  monthly_remaining: string | null; reserved_amount?: string; reserved?: string;
}
export interface GatewayComparison {
  model_id: string; requested_model: string; as_of: string; offers: GatewayOffer[];
  selected_channel: string | null; request_fingerprint: string;
  recommendation: { status: string; objective: string; reason: string; manual_override: boolean; score: number | null; comparable_dimensions: string[] };
  budget?: GatewayBudget;
  budget_check?: { allowed: boolean; reasons: string[]; reserve_amount: string | null; currency: string; estimated_min?: string | null; estimated_max?: string | null };
  limitations: string[];
}
export interface GatewayAttempt {
  channel_id?: string; channel?: string; status?: string; success?: boolean;
  error?: string | null; error_category?: string | null; latency_ms?: number | null;
  billing_status?: string; billing_state?: string; actual_cost?: string | null; stop_reason?: string;
}
export interface GatewayRecord {
  request_id: string; project_id: string; model_id: string; currency: string;
  occurred_at: string; status: string; success: boolean | null;
  selected_channel?: string | null; final_channel: string | null;
  estimated_cost: string | null; actual_cost: string | null; latency_ms?: number | null;
  identity?: GatewayIdentity; attempts: GatewayAttempt[];
  fallback_trace: { from_channel?: string; to_channel?: string; channel_id?: string; action?: string; attempt_id?: string; reason?: string; type?: string; status?: string }[];
  stop_reason?: string; billing_status?: string; cost_status?: string; is_mock: boolean;
  response_content?: string | null;
}
export interface GatewayUsageSummary {
  request_count: number; success_rate: number | null; actual_cost: string | null;
  estimated_cost: string | null; actual_minus_estimated: string | null;
  actual_cost_known_count: number; actual_cost_unknown_count: number; actual_cost_coverage: number | null;
  average_latency_ms: number | null; p95_latency_ms: number | null; fallback_count: number;
}
export type GatewayUsageGroup = GatewayUsageSummary & { key: string };
export interface GatewayAnalytics {
  period: string; period_start: string; period_end: string; record_count: number;
  channel_cost_attribution: string; currencies: Record<string, GatewayUsageSummary & {
    by_model: GatewayUsageGroup[]; by_channel: GatewayUsageGroup[]; by_project: GatewayUsageGroup[];
    by_user: GatewayUsageGroup[]; daily: GatewayUsageGroup[]; weekly: GatewayUsageGroup[]; monthly: GatewayUsageGroup[];
  }>;
}
export interface GatewayAlert {
  alert_id: string; type: string; severity: string; message: string; channel_id?: string | null;
  model_id?: string | null; sample_count?: number; observed_at: string;
}
export interface GatewayReplay {
  request_count: number; channel_change_count: number; priced_count: number;
  pricing_coverage: number | null; scenario_price_basis: string;
  estimated_savings_by_currency: Record<string, { estimated_savings: string; comparable_count: number }>;
  rows: { request_id: string; original_channel: string; selected_channel: string | null;
    scenario_estimated_cost: string | null; comparable_estimated_savings: string | null;
    currency: string | null; reason: string[]; execution_outcome_counterfactual: string }[];
  limitations: string[];
}

const BASE = '/api/v1/gateway';
function write<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  return apiRequest<T>(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 120_000);
}
function query(fields: Record<string, string>): string { return new URLSearchParams(fields).toString(); }

export const gatewayApi = {
  catalog: () => apiRequest<GatewayCatalog>(`${BASE}/catalog`),
  compare: (profile: GatewayProfile) => write<GatewayComparison>('/compare', 'POST', profile),
  budget: (project_id: string, currency: string) => apiRequest<GatewayBudget>(`${BASE}/budget?${query({ project_id, currency })}`),
  saveBudget: (body: { project_id: string; currency: string; daily_limit: string | null; monthly_limit: string | null }) => write<GatewayBudget>('/budget', 'PUT', body),
  execute: (request_id: string, profile: GatewayProfile, prompt: string) => write<GatewayRecord>('/execute', 'POST', {
    request_id, profile, messages: [{ role: 'user', content: prompt }], explicit_confirmation: true,
  }),
  records: (project_id: string) => apiRequest<{ items: GatewayRecord[]; total: number }>(`${BASE}/records?${query({ project_id })}`),
  analytics: (period: string, project_id: string) => apiRequest<GatewayAnalytics>(`${BASE}/analytics?${query({ period, project_id })}`),
  alerts: () => apiRequest<{ items: GatewayAlert[] }>(`${BASE}/alerts`),
  replay: (body: { objective: string; excluded_channels: string[]; project_id: string }) => write<GatewayReplay>('/replay', 'POST', body),
  saveAccessPolicy: (channel: string, policy: GatewayAccessPolicy & { evidence_reference: string }) => write<{ channel_id: string; access_policy: GatewayAccessPolicy }>(`/access-policy/${encodeURIComponent(channel)}`, 'PUT', {
    // Only editable request fields cross the boundary. Catalog responses also
    // contain server-owned verified_at/reviewed_by metadata.
    stream: policy.stream, tool_calling: policy.tool_calling, max_context_tokens: policy.max_context_tokens,
    storage_regions: policy.storage_regions, retention_days: policy.retention_days,
    training_use: policy.training_use, sensitive_tasks_allowed: policy.sensitive_tasks_allowed,
    compliance_labels: policy.compliance_labels, verification_status: policy.verification_status,
    source_urls: policy.source_urls, evidence_reference: policy.evidence_reference,
  }),
  settle: (requestId: string, body: { actual_cost: string; evidence_reference: string }) => write<GatewayRecord>(`/settlements/${encodeURIComponent(requestId)}`, 'POST', body),
};
