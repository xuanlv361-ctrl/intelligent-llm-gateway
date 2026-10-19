import type { GatewayComparison, GatewayRecord } from '../../services/gatewayApi';

export type RouteState = 'neutral' | 'proposed' | 'success' | 'failed' | 'skipped' | 'blocked' | 'unknown';
export type RouteKind = 'request' | 'model' | 'provider' | 'attempt' | 'result';
export interface RouteNode {
  id: string;
  kind: RouteKind;
  title: string;
  state: RouteState;
  label: string;
  details: Record<string, string>;
  position: { x: number; y: number };
}
export interface RouteEdge { id: string; source: string; target: string; state: RouteState; recorded: boolean }
export interface RouteEvent { nodeId: string; label: string; channel: string | null; state: RouteState }
export interface RouteGraph {
  mode: 'proposed' | 'recorded';
  nodes: RouteNode[];
  edges: RouteEdge[];
  events: RouteEvent[];
  hasAttempts: boolean;
  isMock: boolean;
}

const encoded = (value: string) => encodeURIComponent(value);
const display = (value: unknown) => value == null || value === '' ? 'unknown' : String(value);
function link(source: string, target: string, state: RouteState, recorded: boolean): RouteEdge {
  return { id: `edge:${source}:${target}`, source, target, state, recorded };
}

/** Presentation only: candidates are not an inferred backup order. */
export function buildProposedRoute(comparison: GatewayComparison | null): RouteGraph {
  const graph: RouteGraph = { mode: 'proposed', nodes: [], edges: [], events: [], hasAttempts: false, isMock: false };
  if (!comparison) return graph;
  const selected = comparison.offers.find(offer => offer.channel_id === comparison.selected_channel);
  graph.nodes.push(
    { id: 'request', kind: 'request', title: 'request', label: 'quote_only', state: 'neutral', position: { x: 0, y: 100 }, details: { purpose: 'quote_only', as_of: comparison.as_of } },
    { id: 'model', kind: 'model', title: comparison.model_id, label: 'exact_model', state: 'neutral', position: { x: 260, y: 100 }, details: { requested_model: comparison.requested_model, model_id: comparison.model_id } },
  );
  graph.edges.push(link('request', 'model', 'neutral', false));
  // Sort for stable geometry, independently of the server's ranking order.
  const offers = [...comparison.offers].sort((a, b) => a.channel_id.localeCompare(b.channel_id, 'en'));
  const offset = (offers.length - 1) * 64;
  offers.forEach((offer, index) => {
    const isSelected = selected?.channel_id === offer.channel_id;
    const state: RouteState = offer.eligible === false ? 'blocked' : isSelected ? 'proposed' : 'neutral';
    const id = `offer:${encoded(offer.channel_id)}`;
    graph.nodes.push({ id, kind: 'provider', title: offer.provider, label: state === 'blocked' ? 'excluded' : isSelected ? 'selected_proposal' : 'candidate', state,
      position: { x: 530, y: 100 - offset + index * 128 }, details: {
        channel_id: offer.channel_id, provider_model_id: offer.provider_model_id, estimated_cost: display(offer.estimated_cost),
        currency: display(offer.currency), sample_count: String(offer.health.sample_count),
        observed_success_rate: display(offer.health.success_rate), p95_latency_ms: display(offer.health.p95_latency_ms),
        exclusion_reasons: offer.exclusion_reasons?.join('; ') || 'none',
      } });
    graph.edges.push(link('model', id, state, false));
  });
  if (selected) {
    const blocked = comparison.budget_check?.allowed === false || comparison.recommendation.status === 'blocked';
    graph.nodes.push({ id: 'proposal', kind: 'result', title: 'proposal', label: blocked ? 'execution_blocked' : 'not_executed', state: blocked ? 'blocked' : 'proposed',
      position: { x: 820, y: 100 }, details: { selected_channel: selected.channel_id, execution: 'not_executed',
        budget_allowed: display(comparison.budget_check?.allowed), reserve_amount: display(comparison.budget_check?.reserve_amount),
        recommendation: comparison.recommendation.reason } });
    graph.edges.push(link(`offer:${encoded(selected.channel_id)}`, 'proposal', blocked ? 'blocked' : 'proposed', false));
  }
  return graph;
}

/** Build from persisted attempts and explicit skip events, never from candidate order. */
export function buildRecordedRoute(record: GatewayRecord): RouteGraph {
  const graph: RouteGraph = { mode: 'recorded', nodes: [], edges: [], events: [], hasAttempts: record.attempts.length > 0, isMock: record.is_mock };
  graph.nodes.push(
    { id: 'request', kind: 'request', title: record.request_id, label: 'recorded_request', state: 'neutral', position: { x: 0, y: 100 }, details: { request_id: record.request_id, occurred_at: record.occurred_at, project_id: record.project_id } },
    { id: 'model', kind: 'model', title: record.model_id, label: 'requested_model', state: 'neutral', position: { x: 260, y: 100 }, details: { requested_model: record.identity?.requested_model || record.model_id, actual_model: display(record.identity?.actual_returned_model || record.identity?.actual_model), billed_model: display(record.identity?.billed_model) } },
  );
  graph.edges.push(link('request', 'model', 'neutral', true));
  const consumed = new Set<number>();
  let previous = 'model';
  const addAttempt = (index: number) => {
    if (consumed.has(index)) return;
    consumed.add(index);
    const attempt = record.attempts[index];
    const channel = attempt.channel_id || attempt.channel || 'unknown';
    const state: RouteState = attempt.success === true ? 'success' : attempt.success === false ? 'failed'
      : attempt.status === 'success' ? 'success' : attempt.status === 'failed' ? 'failed' : 'unknown';
    const id = `attempt:${index}:${encoded(channel)}`;
    graph.nodes.push({ id, kind: 'attempt', title: channel, label: state === 'unknown' ? 'incomplete_attempt' : state, state,
      position: { x: 530 + graph.events.length * 270, y: 100 }, details: { channel_id: channel, attempt_number: String(index + 1),
        status: display(attempt.status), error_category: display(attempt.error_category || attempt.error),
        billing_state: display(attempt.billing_state || attempt.billing_status), latency_ms: display(attempt.latency_ms), actual_cost: display(attempt.actual_cost) } });
    graph.edges.push(link(previous, id, state, true));
    graph.events.push({ nodeId: id, label: state === 'unknown' ? 'incomplete_attempt' : state, channel, state });
    previous = id;
  };
  record.fallback_trace.forEach((step, traceIndex) => {
    if (step.action === 'skipped' && step.channel_id) {
      const id = `skip:${traceIndex}:${encoded(step.channel_id)}`;
      graph.nodes.push({ id, kind: 'attempt', title: step.channel_id, label: 'skipped', state: 'skipped',
        position: { x: 530 + graph.events.length * 270, y: 100 }, details: { channel_id: step.channel_id, status: 'skipped', reason: display(step.reason), execution: 'not_attempted' } });
      graph.edges.push(link(previous, id, 'skipped', true));
      graph.events.push({ nodeId: id, label: 'skipped', channel: step.channel_id, state: 'skipped' });
      previous = id;
    } else if (step.action === 'dispatch') {
      const index = record.attempts.findIndex((attempt, i) => !consumed.has(i) && (attempt.channel_id || attempt.channel) === step.channel_id);
      if (index >= 0) addAttempt(index);
    }
  });
  // Older evidence may have attempts but no dispatch trace. Preserve those attempts.
  record.attempts.forEach((_, index) => addAttempt(index));
  const state: RouteState = !graph.hasAttempts ? 'unknown' : record.success === true ? 'success' : record.success === false ? 'failed' : 'unknown';
  graph.nodes.push({ id: 'result', kind: 'result', title: 'recorded_result', label: !graph.hasAttempts ? 'no_attempts' : state === 'unknown' ? 'incomplete_result' : state, state,
    position: { x: 530 + graph.events.length * 270, y: 100 }, details: { status: record.status, final_channel: display(record.final_channel),
      stop_reason: display(record.stop_reason), billing_state: display(record.cost_status || record.billing_status), actual_cost: display(record.actual_cost), currency: record.currency } });
  graph.edges.push(link(previous, 'result', state, true));
  graph.events.push({ nodeId: 'result', label: !graph.hasAttempts ? 'no_attempts' : state === 'unknown' ? 'incomplete_result' : state, channel: record.final_channel, state });
  return graph;
}
