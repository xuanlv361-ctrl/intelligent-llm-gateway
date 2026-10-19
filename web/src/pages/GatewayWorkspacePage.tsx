import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gatewayApi, GatewayAccessPolicy, GatewayAlert, GatewayAnalytics, GatewayBudget,
  GatewayCatalog, GatewayComparison, GatewayObjective, GatewayOffer, GatewayProfile,
  GatewayRecord, GatewayReplay, GatewayUsageGroup } from '../services/gatewayApi';
import './GatewayWorkspacePage.css';

const tabs = ['Compare & route', 'Usage', 'Identity & recovery', 'Alerts & replay', 'Access policies'] as const;
type Tab = typeof tabs[number];
const objectives: Record<GatewayObjective, string> = {
  balanced: 'Balanced', lowest_cost: 'Lowest cost', lowest_latency: 'Lowest observed latency',
  highest_reliability: 'Highest observed reliability',
};
const money = (value: string | null | undefined, currency = 'USD') => value == null ? 'Unknown' : `${currency} ${value}`;
const pct = (value: number | null | undefined) => value == null ? 'Unmeasured' : `${(value * 100).toFixed(1)}%`;
const ms = (value: number | null | undefined) => value == null ? 'Unmeasured' : `${Math.round(value).toLocaleString('en-GB')} ms`;
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : 'Not recorded';
const words = (value: string) => value.replace(/_/g, ' ');
function errorMessage(error: unknown): string {
  const detail = (error as { detail?: { code?: string; message?: string } })?.detail;
  if (detail?.code) return `The local service could not complete this action (${detail.code}). Check access, configuration and service status, then try again.`;
  return error instanceof Error && !/[\u3400-\u9fff]/.test(error.message) ? error.message : 'The local service did not return usable data. Refresh to try again.';
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="gw-empty">{children}</div>; }
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) { return <div className={`gw-notice ${error ? 'gw-notice-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>; }
function Unknown({ children }: { children?: React.ReactNode }) { return <span className="gw-unknown">{children || 'Unknown'}</span>; }

function ProviderEvidence({ offer }: { offer: GatewayOffer }) {
  const access = offer.access_policy;
  return <details className="gw-evidence"><summary>Evidence & eligibility</summary><dl>
    <div><dt>Provider model ID</dt><dd><code>{offer.provider_model_id}</code></dd></div>
    <div><dt>Price checked</dt><dd>{date(offer.pricing_verified_at || offer.verified_at)}</dd></div>
    <div><dt>Observations</dt><dd>{offer.health.sample_count} observations · {offer.health.window_hours || 24}h window · minimum {offer.health.minimum_samples || 5}</dd></div>
    <div><dt>Latest observation</dt><dd>{date(offer.health.observed_at)}</dd></div>
    <div><dt>Streaming / tools</dt><dd>{words(access.stream)} / {words(access.tool_calling)}</dd></div>
    <div><dt>Context limit</dt><dd>{access.max_context_tokens?.toLocaleString('en-GB') ?? <Unknown />}</dd></div>
    <div><dt>Data regions</dt><dd>{access.storage_regions.join(', ') || <Unknown />}</dd></div>
    <div><dt>Training use</dt><dd>{words(access.training_use)}</dd></div>
    <div><dt>Policy evidence</dt><dd>{words(access.verification_status)}</dd></div>
  </dl>{offer.health.success_rate_ci95 && <p>Success rate 95% interval: {pct(offer.health.success_rate_ci95.lower)}–{pct(offer.health.success_rate_ci95.upper)}.</p>}
    {!!offer.exclusion_reasons?.length && <ul className="gw-block-reasons">{offer.exclusion_reasons.map(reason => <li key={reason}>{words(reason)}</li>)}</ul>}
    <div className="gw-source-links">{offer.source_urls.map((url, i) => <a href={url} key={url} target="_blank" rel="noreferrer">Source {i + 1} ↗</a>)}</div>
  </details>;
}

function CostReceipt({ offer, comparison, budget }: { offer?: GatewayOffer; comparison: GatewayComparison | null; budget: GatewayBudget | null }) {
  const parts = offer?.price_breakdown;
  const currency = offer?.currency || budget?.currency || 'USD';
  const check = comparison?.budget_check;
  const activeBudget = comparison?.budget || budget;
  return <aside className="gw-receipt" aria-label="Request cost receipt"><div className="gw-receipt-top"><span>REQUEST ESTIMATE</span><span>{currency}</span></div>
    <h2>Cost receipt</h2><p>Itemised for the selected provider.</p>
    <dl className="gw-receipt-lines"><div><dt>Uncached input<small>{parts ? (parts.input_tokens - parts.cached_input_tokens).toLocaleString('en-GB') + ' tokens' : 'Awaiting quote'}</small></dt><dd>{parts ? parts.uncached_input_cost : '—'}</dd></div>
      <div><dt>Cached input<small>{parts ? parts.cached_input_tokens.toLocaleString('en-GB') + ' tokens' : 'Awaiting quote'}</small></dt><dd>{parts ? parts.cached_input_cost : '—'}</dd></div>
      <div><dt>Maximum output<small>{parts ? parts.output_tokens.toLocaleString('en-GB') + ' tokens' : 'Awaiting quote'}</small></dt><dd>{parts ? parts.output_cost : '—'}</dd></div>
    </dl><div className="gw-receipt-total"><span>Token estimate</span><strong>{offer?.estimated_cost ?? '—'}</strong></div>
    {check && <div className="gw-reservation"><span>Execution reserve</span><b>{money(check.reserve_amount, check.currency)}</b><small>Includes the configured recovery allowance.</small></div>}
    {check?.estimated_min != null && check?.estimated_max != null && <p className="gw-small">Estimated range: {money(check.estimated_min, check.currency)}–{money(check.estimated_max, check.currency)}.</p>}
    <dl className="gw-budget-lines"><div><dt>Daily remaining</dt><dd>{activeBudget ? activeBudget.daily_remaining == null ? 'No limit set' : money(activeBudget.daily_remaining, activeBudget.currency) : 'Not loaded'}</dd></div>
      <div><dt>Monthly remaining</dt><dd>{activeBudget ? activeBudget.monthly_remaining == null ? 'No limit set' : money(activeBudget.monthly_remaining, activeBudget.currency) : 'Not loaded'}</dd></div>
      <div><dt>Reserved</dt><dd>{activeBudget ? money(activeBudget.reserved_amount ?? activeBudget.reserved, activeBudget.currency) : 'Not loaded'}</dd></div></dl>
    <p className="gw-receipt-foot">Published token prices. Taxes and non-token charges may differ. Unknown provider bills remain unsettled.</p>
  </aside>;
}

function BudgetEditor({ project, budget, onSave }: { project: string; budget: GatewayBudget | null; onSave: (budget: GatewayBudget) => void }) {
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDaily(budget?.daily_limit || ''); setMonthly(budget?.monthly_limit || ''); }, [budget]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try { onSave(await gatewayApi.saveBudget({ project_id: project, currency: budget?.currency || 'USD', daily_limit: daily || null, monthly_limit: monthly || null })); setNotice('Budget saved. New requests use these limits.'); }
    catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }
  return <details className="gw-budget-editor"><summary>Set project budget</summary><form onSubmit={save} className="gw-inline-form">
    <label>Daily limit ({budget?.currency || 'USD'})<input value={daily} onChange={e => setDaily(e.target.value)} inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="No limit" /></label>
    <label>Monthly limit ({budget?.currency || 'USD'})<input value={monthly} onChange={e => setMonthly(e.target.value)} inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" placeholder="No limit" /></label>
    <button className="gw-secondary" disabled={saving || !budget}>{saving ? 'Saving…' : 'Save budget'}</button>
  </form><p className="gw-small">Blank removes the corresponding limit. Limits apply to this project and currency.</p>{notice && <Notice>{notice}</Notice>}{error && <Notice error>{error}</Notice>}</details>;
}

function UsageView({ project, refresh }: { project: string; refresh: number }) {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState<GatewayAnalytics | null>(null);
  const [error, setError] = useState('');
  const [group, setGroup] = useState<'daily' | 'weekly' | 'monthly' | 'by_model' | 'by_channel' | 'by_project' | 'by_user'>('by_model');
  useEffect(() => { let alive = true; setData(null); setError(''); gatewayApi.analytics(period, project).then(value => { if (alive) setData(value); }).catch(err => { if (alive) setError(errorMessage(err)); }); return () => { alive = false; }; }, [period, project, refresh]);
  return <section className="gw-panel"><header className="gw-section-head"><div><h2>Usage & settled spend</h2><p>UTC periods. Missing bills remain unknown.</p></div><label>Period<select value={period} onChange={e => setPeriod(e.target.value)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></select></label></header>
    {error ? <Notice error>{error}</Notice> : !data ? <Empty>Loading local usage records…</Empty> : !data.record_count ? <Empty>No execution records for this project in the selected period. Quotes do not count as usage.</Empty> : <>
      <label className="gw-group-select">Group by<select value={group} onChange={e => setGroup(e.target.value as typeof group)}><option value="by_model">Model</option><option value="by_channel">Final channel</option><option value="by_project">Project</option><option value="by_user">User</option><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></label>
      {Object.entries(data.currencies).map(([currency, summary]) => <div className="gw-usage-currency" key={currency}><div className="gw-usage-totals"><div><span>Settled spend · {currency}</span><strong>{money(summary.actual_cost, currency)}</strong></div><div><span>Estimated token cost</span><strong>{money(summary.estimated_cost, currency)}</strong></div><div><span>Actual − estimated</span><strong>{money(summary.actual_minus_estimated, currency)}</strong></div><div><span>Bill coverage</span><strong>{summary.actual_cost_known_count}/{summary.request_count}</strong></div></div>
        <div className="gw-table-scroll"><table><thead><tr><th>{words(group.replace('by_', ''))}</th><th>Requests</th><th>Settled cost</th><th>Unknown bills</th><th>Success</th><th>P95 latency</th><th>Fallbacks</th></tr></thead><tbody>{(summary[group] as GatewayUsageGroup[]).map(row => <tr key={row.key}><td><code>{row.key}</code></td><td>{row.request_count}</td><td className="gw-money">{money(row.actual_cost, currency)}</td><td>{row.actual_cost_unknown_count}</td><td>{pct(row.success_rate)}</td><td>{ms(row.p95_latency_ms)}</td><td>{row.fallback_count}</td></tr>)}</tbody></table></div>
      </div>)}<p className="gw-small">Channel cost attribution: {data.channel_cost_attribution}. Currency totals are kept separate.</p>
    </>}
  </section>;
}

function RecordView({ project, refresh }: { project: string; refresh: number }) {
  const [records, setRecords] = useState<GatewayRecord[] | null>(null);
  const [error, setError] = useState('');
  const [settleId, setSettleId] = useState('');
  const [cost, setCost] = useState('');
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => { setError(''); return gatewayApi.records(project).then(result => setRecords(result.items)).catch(err => setError(errorMessage(err))); }, [project]);
  useEffect(() => { void load(); }, [load, refresh]);
  async function settle(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await gatewayApi.settle(settleId, { actual_cost: cost, evidence_reference: evidence }); setNotice('Provider bill reconciled. Budget and usage now use the settled amount.'); setCost(''); setEvidence(''); await load(); }
    catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }
  return <section className="gw-panel"><header className="gw-section-head"><div><h2>Identity & recovery</h2><p>Requested, returned and billed identities from local execution records.</p></div><button className="gw-secondary" onClick={() => void load()}>Refresh records</button></header>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {records == null ? <Empty>Loading execution history…</Empty> : !records.length ? <Empty>No executions recorded. Provider identities and recovery traces appear after an authorised execution.</Empty> : <>
      <div className="gw-records">{records.map(record => <details className="gw-record" key={record.request_id}><summary><span><code>{record.request_id}</code><small>{date(record.occurred_at)}</small></span><b className={record.success === false ? 'gw-negative' : ''}>{words(record.status)}</b><span>{record.final_channel || 'No channel executed'}</span></summary>
        <div className="gw-record-detail"><dl><div><dt>Requested model</dt><dd><code>{record.identity?.requested_model || record.model_id}</code></dd></div><div><dt>Provider alias</dt><dd><code>{record.identity?.provider_model_alias || 'Unknown'}</code></dd></div><div><dt>Actual returned model</dt><dd><code>{record.identity?.actual_returned_model || record.identity?.actual_model || 'Unknown'}</code></dd></div><div><dt>Billed model</dt><dd><code>{record.identity?.billed_model || 'Unknown'}</code></dd></div><div><dt>Verification</dt><dd>{words(record.identity?.verification_status || 'pending_confirmation')}</dd></div><div><dt>Last verified</dt><dd>{date(record.identity?.last_verified_at)}</dd></div><div><dt>Settled cost</dt><dd>{money(record.actual_cost, record.currency)}</dd></div><div><dt>Billing state</dt><dd>{words(record.cost_status || record.billing_status || 'unknown')}</dd></div></dl>
          <h3>Attempt sequence</h3>{record.attempts.length ? <ol className="gw-attempts">{record.attempts.map((attempt, index) => <li key={index}><b>{attempt.channel_id || attempt.channel || 'Unknown channel'}</b><span>{words(attempt.status || (attempt.success === true ? 'success' : 'failed'))}</span><span>{words(attempt.error_category || attempt.error || 'no error recorded')}</span><span>{ms(attempt.latency_ms)}</span><small>Billing: {words(attempt.billing_state || attempt.billing_status || 'unknown')}</small></li>)}</ol> : <p>No provider attempt was made.</p>}
          <h3>Recovery trace</h3>{record.fallback_trace.length ? <ul>{record.fallback_trace.map((step, i) => <li key={i}>{step.channel_id ? <><code>{step.channel_id}</code> · {words(step.action || 'recorded')}</> : <>{step.from_channel || 'Primary'} → {step.to_channel || 'Stopped'}</>}{step.reason ? ` · ${words(step.reason)}` : ''}</li>)}</ul> : <p>No fallback was used.</p>}
          {record.stop_reason && <p>Stopped: {words(record.stop_reason)}</p>}<p className="gw-small">A timeout may already have been billed. Recovery stops when the first attempt's billing or output state is ambiguous.</p>
        </div>
      </details>)}</div>
      <details className="gw-budget-editor"><summary>Reconcile an unknown provider bill</summary><form className="gw-inline-form" onSubmit={settle}><label>Local request ID<select required value={settleId} onChange={e => setSettleId(e.target.value)}><option value="">Choose a record</option>{records.filter(row => row.actual_cost == null).map(row => <option key={row.request_id} value={row.request_id}>{row.request_id} · {row.currency}</option>)}</select></label><label>Total actual cost<input required value={cost} onChange={e => setCost(e.target.value)} pattern="[0-9]+(\.[0-9]+)?" inputMode="decimal" /></label><label>Billing evidence reference<input required value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Invoice or provider log reference" /></label><button className="gw-secondary" disabled={saving || !settleId}>{saving ? 'Reconciling…' : 'Reconcile bill'}</button></form></details>
    </>}
  </section>;
}

function AlertsReplayView({ project, catalog }: { project: string; catalog: GatewayCatalog | null }) {
  const [alerts, setAlerts] = useState<GatewayAlert[] | null>(null);
  const [error, setError] = useState('');
  const [objective, setObjective] = useState('lowest_cost');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [replay, setReplay] = useState<GatewayReplay | null>(null);
  const [running, setRunning] = useState(false);
  const load = useCallback(() => { setError(''); return gatewayApi.alerts().then(result => setAlerts(result.items)).catch(err => setError(errorMessage(err))); }, []);
  useEffect(() => { void load(); }, [load]);
  async function run(event: FormEvent) { event.preventDefault(); setRunning(true); setError(''); try { setReplay(await gatewayApi.replay({ objective, excluded_channels: excluded, project_id: project })); } catch (err) { setError(errorMessage(err)); } finally { setRunning(false); } }
  return <div className="gw-section-stack"><section className="gw-panel"><header className="gw-section-head"><div><h2>SLA & change alerts</h2><p>Observed conditions, shown in this workspace. No outbound notifications.</p></div><button className="gw-secondary" onClick={() => void load()}>Refresh alerts</button></header>
    {error && <Notice error>{error}</Notice>}{alerts == null ? <Empty>Reading local alerts…</Empty> : !alerts.length ? <Empty>No active conditions in the available evidence. Missing observations do not establish an SLA.</Empty> : <div className="gw-alert-list">{alerts.map(alert => <article key={alert.alert_id} className={`gw-alert gw-alert-${alert.severity}`}><span>{words(alert.severity)}</span><div><h3>{words(alert.type)}</h3><p>{alert.message}</p><small>{alert.channel_id || 'Workspace'}{alert.sample_count == null ? '' : ` · ${alert.sample_count} samples`} · {date(alert.observed_at)}</small></div></article>)}</div>}
  </section><section className="gw-panel"><header><h2>What if a different route had been chosen?</h2><p>Reprice recorded requests with today's documented prices. Unexecuted outcomes remain unknown.</p></header><form className="gw-replay-form" onSubmit={run}><label>Routing preference<select value={objective} onChange={e => setObjective(e.target.value)}>{(['lowest_cost', 'highest_reliability', 'balanced'] as GatewayObjective[]).map(value => <option key={value} value={value}>{objectives[value]}</option>)}</select></label><fieldset><legend>Simulate unavailable channels</legend><div className="gw-checkbox-grid">{catalog?.offers.map(offer => <label className="gw-check" key={offer.channel_id}><input type="checkbox" checked={excluded.includes(offer.channel_id)} onChange={e => setExcluded(previous => e.target.checked ? [...previous, offer.channel_id] : previous.filter(id => id !== offer.channel_id))} /><span>{offer.provider}<small>{offer.provider_model_id}</small></span></label>)}</div></fieldset><button className="gw-primary" disabled={running}>{running ? 'Analysing…' : 'Run what-if analysis'}</button></form>
    {replay && <div className="gw-replay-result"><p><b>{replay.request_count}</b> recorded requests · <b>{replay.channel_change_count}</b> route changes · <b>{replay.priced_count}</b> with comparable pricing.</p>{!replay.request_count ? <Empty>No eligible history for this project. No hypothetical success or saving was invented.</Empty> : <><div className="gw-table-scroll"><table><thead><tr><th>Local request</th><th>Original channel</th><th>Alternative channel</th><th>Current-price estimate</th><th>Estimated difference</th><th>Alternative outcome</th></tr></thead><tbody>{replay.rows.map(row => <tr key={row.request_id}><td><code>{row.request_id}</code></td><td>{row.original_channel}</td><td>{row.selected_channel || 'No eligible channel'}</td><td>{money(row.scenario_estimated_cost, row.currency || '')}</td><td>{money(row.comparable_estimated_savings, row.currency || '')}</td><td>{words(row.execution_outcome_counterfactual)}</td></tr>)}</tbody></table></div>{Object.entries(replay.estimated_savings_by_currency).map(([currency, result]) => <p key={currency}>Comparable estimated price reduction: <span className="gw-money">{money(result.estimated_savings, currency)}</span> across {result.comparable_count} requests. This is not a realised saving.</p>)}</>}<ul className="gw-small">{replay.limitations.map(text => <li key={text}>{text}</li>)}</ul></div>}
  </section></div>;
}

function AccessPoliciesView({ catalog, onSaved }: { catalog: GatewayCatalog; onSaved: () => void }) {
  const [channel, setChannel] = useState(catalog.offers[0]?.channel_id || '');
  const offer = catalog.offers.find(item => item.channel_id === channel);
  const [draft, setDraft] = useState<GatewayAccessPolicy | null>(offer?.access_policy || null);
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setDraft(offer ? { ...offer.access_policy } : null); setEvidence(''); }, [offer]);
  function change<K extends keyof GatewayAccessPolicy>(key: K, value: GatewayAccessPolicy[K]) { setDraft(previous => previous ? { ...previous, [key]: value } : null); setNotice(''); }
  async function save(event: FormEvent) { event.preventDefault(); if (!draft) return; setSaving(true); setError(''); try { await gatewayApi.saveAccessPolicy(channel, { ...draft, evidence_reference: evidence }); setNotice('Reviewed access policy saved for this workspace.'); onSaved(); } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); } }
  return <section className="gw-panel"><header><h2>Account capabilities & data controls</h2><p>Account evidence determines eligibility for streaming, tools, region and sensitive requests. Public model claims alone do not confirm account access.</p></header><label className="gw-policy-picker">Provider offer<select value={channel} onChange={e => setChannel(e.target.value)}>{catalog.offers.map(item => <option key={item.channel_id} value={item.channel_id}>{item.provider} · {item.provider_model_id}</option>)}</select></label>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {draft && <form key={channel} className="gw-policy-form" onSubmit={save}><div className="gw-form-grid"><label>Streaming<select value={draft.stream} onChange={e => change('stream', e.target.value as GatewayAccessPolicy['stream'])}><option value="unknown">Unknown</option><option value="supported">Supported</option><option value="unsupported">Unsupported</option></select></label><label>Tool calling<select value={draft.tool_calling} onChange={e => change('tool_calling', e.target.value as GatewayAccessPolicy['tool_calling'])}><option value="unknown">Unknown</option><option value="supported">Supported</option><option value="unsupported">Unsupported</option></select></label><label>Maximum context tokens<input type="number" min="1" max="2000000" step="1" value={draft.max_context_tokens ?? ''} placeholder="Unknown" onChange={e => change('max_context_tokens', e.target.value === '' ? null : Number(e.target.value))} /></label><label>Storage regions<input defaultValue={draft.storage_regions.join(', ')} placeholder="Exact identifiers, e.g. UK, EU" onChange={e => change('storage_regions', e.target.value.split(',').map(text => text.trim()).filter(Boolean))} /></label><label>Retention days<input type="number" min="0" max="3650" step="1" value={draft.retention_days ?? ''} placeholder="Unknown" onChange={e => change('retention_days', e.target.value === '' ? null : Number(e.target.value))} /></label><label>Training use<select value={draft.training_use} onChange={e => change('training_use', e.target.value as GatewayAccessPolicy['training_use'])}><option value="unknown">Unknown</option><option value="not_used">Not used for training</option><option value="used">Used for training</option></select></label><label>Verification status<select value={draft.verification_status} onChange={e => change('verification_status', e.target.value)}><option value="pending_confirmation">Pending confirmation</option><option value="verified">Verified</option><option value="account_verified">Account verified</option><option value="contract_verified">Contract verified</option></select></label><div className="gw-policy-review-time"><span>Last reviewed by server</span><p>{date(draft.verified_at)}</p><small>A saved review receives a new server timestamp.</small></div><label>Compliance labels<input defaultValue={draft.compliance_labels.join(', ')} placeholder="Only evidenced labels" onChange={e => change('compliance_labels', e.target.value.split(',').map(text => text.trim()).filter(Boolean))} /></label><label className="gw-check gw-policy-check"><input type="checkbox" checked={draft.sensitive_tasks_allowed} onChange={e => change('sensitive_tasks_allowed', e.target.checked)} />Sensitive tasks approved for this account</label></div>
      <label>Evidence source URLs<textarea required defaultValue={draft.source_urls.join('\n')} onChange={e => change('source_urls', e.target.value.split('\n').map(text => text.trim()).filter(Boolean))} placeholder="One HTTPS source per line" rows={3} /></label><label>Account or contract evidence reference<input required value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Review, contract or account capability evidence reference" /></label><p className="gw-small">Saving requires workspace administration permission. Do not enter credentials, personal data or contract contents.</p><button className="gw-primary" disabled={saving}>{saving ? 'Saving…' : 'Save reviewed policy'}</button>
    </form>}
  </section>;
}

export default function GatewayWorkspacePage() {
  const [tab, setTab] = useState<Tab>('Compare & route');
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [project, setProject] = useState('default');
  const [model, setModel] = useState('');
  const [inputTokens, setInputTokens] = useState(10000);
  const [outputTokens, setOutputTokens] = useState(2000);
  const [cachedTokens, setCachedTokens] = useState(0);
  const [objective, setObjective] = useState<GatewayObjective>('balanced');
  const [manual, setManual] = useState<string | null>(null);
  const [stream, setStream] = useState(false);
  const [tools, setTools] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [noTraining, setNoTraining] = useState(false);
  const [regions, setRegions] = useState('');
  const [context, setContext] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [comparison, setComparison] = useState<GatewayComparison | null>(null);
  const [budget, setBudget] = useState<GatewayBudget | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [execution, setExecution] = useState<GatewayRecord | null>(null);
  const [revision, setRevision] = useState(0);
  const executionRequestId = useRef<string | null>(null);
  const minimumInput = prompt ? new TextEncoder().encode(JSON.stringify([{ role: 'user', content: prompt }])).length + 1040 : 0;
  const profile = useMemo<GatewayProfile>(() => ({ project_id: project, model_id: model,
    input_tokens: Math.max(inputTokens, minimumInput), output_tokens: outputTokens, cached_input_tokens: cachedTokens,
    objective, manual_channel_id: manual, requirements: { stream, tool_calling: tools, context_tokens: context,
      sensitive, allowed_regions: regions.split(',').map(value => value.trim()).filter(Boolean), require_no_training: noTraining },
  }), [project, model, inputTokens, minimumInput, outputTokens, cachedTokens, objective, manual, stream, tools, context, sensitive, regions, noTraining]);
  const loadCatalog = useCallback(async () => { setCatalogError(''); try { const result = await gatewayApi.catalog(); setCatalog(result); setModel(previous => previous || result.models.find(item => item.model_id.startsWith('deepseek-'))?.model_id || result.models[0]?.model_id || ''); } catch (err) { setCatalogError(errorMessage(err)); } }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { let alive = true; setBudget(null); gatewayApi.budget(project, 'USD').then(value => { if (alive) setBudget(value); }).catch(err => { if (alive) setError(errorMessage(err)); }); return () => { alive = false; }; }, [project, revision]);
  useEffect(() => { setComparison(null); setConfirmed(false); setExecution(null); executionRequestId.current = null; }, [profile, prompt]);
  const offers = comparison?.offers || catalog?.offers.filter(offer => offer.model_id === model) || [];
  const selected = comparison?.offers.find(offer => offer.channel_id === comparison.selected_channel);
  const readiness = selected ? catalog?.execution_readiness?.[selected.channel_id] : undefined;
  async function compare(event: FormEvent) {
    event.preventDefault(); setBusy('compare'); setError(''); setExecution(null); setConfirmed(false);
    try { const result = await gatewayApi.compare(profile); setComparison(result); if (result.budget) setBudget(result.budget); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  async function execute() {
    if (!confirmed || !prompt.trim() || !comparison?.selected_channel) return;
    setBusy('execute'); setError('');
    try { executionRequestId.current ||= `GW-${crypto.randomUUID()}`; setExecution(await gatewayApi.execute(executionRequestId.current, profile, prompt)); setConfirmed(false); setRevision(value => value + 1); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(''); }
  }
  return <main className="gw-page"><header className="gw-heading"><div><span className="gw-eyebrow">PROVIDER DECISION DESK</span><h1>Choose a route. Know the cost.</h1><p>Compare documented offers, observed performance and account controls before a request leaves your gateway.</p></div><div className="gw-heading-controls"><label>Project<input value={project} onChange={e => setProject(e.target.value)} required maxLength={100} /></label><button className="gw-secondary" onClick={() => { void loadCatalog(); setRevision(value => value + 1); }}>Refresh data</button><small>{catalog ? `Catalog loaded ${date(catalog.as_of)}` : 'Reading local catalog…'}</small></div></header>
    <nav className="gw-tabs" role="tablist" aria-label="Gateway workspace">{tabs.map(item => <button key={item} id={`gw-tab-${tabs.indexOf(item)}`} role="tab" aria-selected={tab === item} aria-controls="gw-active-panel" tabIndex={tab === item ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const step = event.key === 'ArrowRight' ? 1 : -1; const next = tabs[(tabs.indexOf(item) + step + tabs.length) % tabs.length]; setTab(next); document.getElementById(`gw-tab-${tabs.indexOf(next)}`)?.focus(); } }} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {catalogError && <Notice error>{catalogError} <button className="gw-text-button" onClick={() => void loadCatalog()}>Retry catalog</button></Notice>}
    <div id="gw-active-panel" role="tabpanel" aria-labelledby={`gw-tab-${tabs.indexOf(tab)}`}>
      {tab === 'Compare & route' && <>
        <form className="gw-request" onSubmit={compare}><div className="gw-form-grid"><label className="gw-model-field">Model<select value={model} onChange={e => { setModel(e.target.value); setManual(null); }} required><option value="" disabled>Choose a documented model</option>{catalog?.models.map(item => <option key={item.model_id} value={item.model_id}>{item.model_id} · {item.offer_count} {item.offer_count === 1 ? 'provider' : 'providers'}</option>)}</select></label><label>Preference<select value={objective} onChange={e => setObjective(e.target.value as GatewayObjective)}>{Object.entries(objectives).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Input tokens (including cache)<input type="number" min={minimumInput} step="1" required value={Math.max(inputTokens, minimumInput)} onChange={e => setInputTokens(Number(e.target.value))} /></label><label>Maximum output tokens<input type="number" min="1" step="1" required value={outputTokens} onChange={e => setOutputTokens(Number(e.target.value))} /></label><label>Cached input tokens<input type="number" min="0" max={Math.max(inputTokens, minimumInput)} step="1" required value={cachedTokens} onChange={e => setCachedTokens(Number(e.target.value))} /></label></div>
          <details className="gw-requirements"><summary>Capability & privacy requirements</summary><div className="gw-checkbox-grid"><label className="gw-check"><input type="checkbox" checked={stream} onChange={e => setStream(e.target.checked)} />Streaming required</label><label className="gw-check"><input type="checkbox" checked={tools} onChange={e => setTools(e.target.checked)} />Tool calling required</label><label className="gw-check"><input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />Sensitive task</label><label className="gw-check"><input type="checkbox" checked={noTraining} onChange={e => setNoTraining(e.target.checked)} />No training use</label></div><div className="gw-inline-form"><label>Allowed storage regions<input value={regions} onChange={e => setRegions(e.target.value)} placeholder="Exact identifiers, e.g. UK, EU" /></label><label>Required context tokens<input type="number" min="0" step="1" value={context} onChange={e => setContext(Number(e.target.value))} /></label></div><p className="gw-small">Unknown account capabilities cannot satisfy a strict requirement. Manual selection uses the same controls.</p></details>
          <div className="gw-request-actions"><button className="gw-primary" disabled={!!busy || !model || !project.trim()}>{busy === 'compare' ? 'Comparing…' : 'Compare providers'}</button><span>Quotes only. No provider request is sent.</span>{manual && <button type="button" className="gw-text-button" onClick={() => setManual(null)}>Clear manual choice</button>}</div>
        </form>
        {error && <Notice error>{error}</Notice>}
        <div className="gw-decision-grid"><section className="gw-panel gw-provider-panel"><header className="gw-section-head"><div><h2>Provider offers</h2><p>{offers.length ? `${offers.length} documented offers for this exact model.` : 'Choose a model to inspect its documented offers.'}</p></div><span className="gw-provenance">DOCUMENTED PRICES · LOCAL OBSERVATIONS</span></header>
          {comparison && <Notice error={comparison.recommendation.status === 'blocked' || comparison.budget_check?.allowed === false}><b>{comparison.recommendation.status === 'blocked' ? 'No eligible route. ' : `${selected?.provider || 'Provider'} recommended. `}</b>{comparison.recommendation.reason}{comparison.budget_check?.allowed === false && <p>Budget protection: {comparison.budget_check.reasons.map(words).join('; ')}.</p>}</Notice>}
          {!catalog && !catalogError ? <Empty>Loading documented provider offers…</Empty> : !offers.length ? <Empty>No documented offers for the selected model.</Empty> : <div className="gw-table-scroll"><table className="gw-provider-table"><thead><tr><th>Provider / source</th><th>Request estimate</th><th>Observed success</th><th>P95 / TTFT</th><th>Route</th></tr></thead><tbody>{offers.map(offer => <tr key={offer.channel_id} className={comparison?.selected_channel === offer.channel_id ? 'gw-selected-row' : offer.eligible === false ? 'gw-ineligible-row' : ''}><td><b>{offer.provider}</b><code className="gw-provider-model">{offer.provider_model_id}</code><span className={`gw-state ${offer.eligible === false ? 'gw-state-blocked' : ''}`}>{offer.eligible === false ? 'Excluded' : words(offer.quote_status)}</span><ProviderEvidence offer={offer} /></td><td><span className="gw-money">{comparison ? money(offer.estimated_cost, offer.currency || '') : 'Awaiting quote'}</span>{offer.difference_vs_selected?.estimated_cost != null && <small>Δ {offer.difference_vs_selected.estimated_cost} vs selected</small>}</td><td>{offer.health.sample_count ? <><b>{pct(offer.health.success_rate)}</b><small>{offer.health.sample_count} samples · {words(offer.health.status)}</small></> : <Unknown>Unmeasured</Unknown>}</td><td>{ms(offer.health.p95_latency_ms)}<small>TTFT {ms(offer.health.ttft_ms)}</small></td><td><label className="gw-route-choice"><input type="radio" name="provider-route" aria-label={`Select ${offer.provider}`} checked={manual === offer.channel_id} disabled={offer.eligible === false || !!busy} onChange={() => setManual(offer.channel_id)} /><span>{comparison?.selected_channel === offer.channel_id ? 'Selected' : 'Choose'}</span></label></td></tr>)}</tbody></table></div>}
        </section><CostReceipt offer={selected} comparison={comparison} budget={budget} /></div>
        <BudgetEditor project={project} budget={budget} onSave={value => { setBudget(value); setComparison(null); setConfirmed(false); }} />
        <section className="gw-panel gw-execute-panel"><header><h2>Execute an approved route</h2><p>Provider adapters, credentials and execution permission must all be configured on the server.</p></header><label>Request message<textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Write the request you want to send. Then compare providers to obtain a fresh quote." /></label>{prompt && <p className="gw-small">Input reserve uses at least {minimumInput.toLocaleString('en-GB')} tokens as a conservative UTF-8 byte bound plus framing allowance. The provider reports actual token usage after execution.</p>}
          <div className="gw-execute-actions"><label className="gw-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!comparison?.selected_channel || !readiness?.ready} />I authorise this request and the displayed cost reserve.</label><button className="gw-primary" onClick={() => void execute()} disabled={!!busy || !confirmed || !prompt.trim() || !comparison?.selected_channel || !readiness?.ready || stream || tools || comparison.budget_check?.allowed !== true}>{busy === 'execute' ? 'Executing…' : 'Execute selected route'}</button></div>
          {selected && !readiness?.ready && <p className="gw-small gw-negative">Execution is unavailable for this offer: {readiness?.reasons?.map(words).join('; ') || 'account adapter, credentials or server approval is not configured'}.</p>}
          {(stream || tools) && <p className="gw-small gw-negative">This execution adapter supports non-streaming text requests. Streaming and tool-call requirements remain active in comparison, but cannot be executed here yet.</p>}
          {execution?.response_content != null && <section className="gw-response-output" aria-label="Provider response"><h3>Provider response</h3><pre>{execution.response_content}</pre><p className="gw-small">Response content is shown for this execution only and is not saved to decision history.</p></section>}
          {execution && <Notice><b>{words(execution.status)}</b> · Local execution ID <code>{execution.request_id}</code> · Final channel {execution.final_channel || 'none'}. <button className="gw-text-button" onClick={() => setTab('Identity & recovery')}>View attempts</button></Notice>}<p className="gw-small">Local execution identifiers are generated by this application. They are not provider request IDs.</p>
        </section>
        {comparison && <details className="gw-limitations"><summary>Quote coverage & limitations</summary><ul>{comparison.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>}
      </>}
      {tab === 'Usage' && <UsageView project={project} refresh={revision} />}
      {tab === 'Identity & recovery' && <RecordView project={project} refresh={revision} />}
      {tab === 'Alerts & replay' && <AlertsReplayView project={project} catalog={catalog} />}
      {tab === 'Access policies' && (catalog ? <AccessPoliciesView catalog={catalog} onSaved={() => { void loadCatalog(); setComparison(null); }} /> : <Empty>Load the provider catalog to review account access policies.</Empty>)}
    </div>
  </main>;
}
