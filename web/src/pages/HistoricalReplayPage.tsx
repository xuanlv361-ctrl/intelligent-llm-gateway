import {getLocale,localeTags,translate as uiText,useLocale} from "../i18n/index";
import {useMemo,useState} from "react";
import {useMutation,useQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import {api,HistoricalReplayInput,HistoricalReplayItem} from "../services/api";
import {BusinessSkillAction} from "../components/console/BusinessSkillAction";

const STRATEGIES=[
  ["actual_observed","历史实际选择"],
  ["latency_first","延迟优先"],
  ["cost_first","成本优先"],
] as const;
const strategyName=(value:string)=>uiText(STRATEGIES.find(([key])=>key===value)?.[1]||value);
const localTime=(value:string|null|undefined)=>{
  const date=value?new Date(value):null;
  return !date||Number.isNaN(date.getTime())?uiText("未提供"):date.toLocaleString(localeTags[getLocale()],{hour12:false});
};
const value=(input:unknown,suffix="")=>input===null||input===undefined||input===""?uiText("不可计算"):`${input}${suffix}`;
const money=(input:string|null,currency:string|null)=>input===null?uiText("不可计算"):`${currency||"CNY"} ¥${input}`;
const percent=(input:number|null)=>input===null?uiText("不可计算"):input.toLocaleString(localeTags[getLocale()],{minimumFractionDigits:1,maximumFractionDigits:1})+"%";
const integer=(input:number|null|undefined)=>input===null||input===undefined?uiText("未提供"):input.toLocaleString(localeTags[getLocale()]);
const reasonSources:Record<string,string>={
  insufficient_candidate_latency_samples:"候选渠道延迟样本不足",
  candidate_cost_evidence_missing:"候选成本证据缺失",
  authoritative_channel_missing:"权威渠道证据缺失",
  price_version_missing:"价格版本缺失",
  token_evidence_missing:"Token证据缺失",
  unsupported_billing_unit:"计费单位暂不支持",
  historical_request_content_missing:"缺少历史请求内容，不能进行请求级模型重新选择",
  candidate_model_or_channel_price_missing:"候选模型或渠道价格证据缺失",
};
const reasonLabel:Record<string,string>=Object.defineProperties(Object.create(null),Object.fromEntries(
  Object.entries(reasonSources).map(([key,source])=>[key,{enumerable:true,get:()=>uiText(source)}])
));
const associationLabel=(association:HistoricalReplayItem["association"])=>uiText(association==="exact"?"精确关联":association==="historical_statistics"?"仅历史统计":association==="execution_only"?"仅执行记录":"无法使用");

function ReplayDrawer({item,onClose}:{item:HistoricalReplayItem;onClose:()=>void}){
  useLocale();
  return <div className="replay-drawer-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="replay-drawer" role="dialog" aria-modal="true" aria-label={uiText("请求回放详情")}>
      <header><div><span className="replay-kicker">{uiText("TRACE DETAIL")}</span><h2>{uiText("请求回放详情")}</h2><p>{localTime(item.occurred_at)}</p></div><button className="icon-button" onClick={onClose} aria-label={uiText("关闭详情")}>×</button></header>
      <section className="trace-identifiers"><div><small>{uiText("Request ID")}</small><code>{item.request_id||uiText("历史数据未提供")}</code></div><div><small>{uiText("Response ID")}</small><code>{item.response_id||uiText("未提供")}</code></div><div><small>{uiText("decision_id")}</small>{item.decision_id?<Link to={`/routing/decisions/${encodeURIComponent(item.decision_id)}`}><code>{item.decision_id}</code></Link>:<code>{uiText("历史数据未提供")}</code>}</div></section>
      <ol className="replay-timeline">{item.timeline.map(step=><li key={step.step} className={`trace-${step.status}`}><span>{step.step}</span><div><h3>{step.title}</h3><dl>{Object.entries(step.evidence).map(([key,itemValue])=><div key={key}><dt>{key}</dt><dd>{itemValue===null||itemValue===undefined?uiText("未提供"):typeof itemValue==="object"?uiText("结构化证据（见技术详情）"):String(itemValue)}</dd></div>)}</dl></div></li>)}</ol>
      <section className="replay-basis"><h3>{uiText("证据能力")}</h3><dl><div><dt>{uiText("配置版本")}</dt><dd>{item.configuration_version||uiText("未提供")}</dd></div><div><dt>{uiText("指标快照")}</dt><dd>{item.metric_snapshot_id||uiText("未提供")}</dd></div><div><dt>{uiText("历史价格说明")}</dt><dd>{item.actual.price_version||uiText("未提供")}</dd></div><div><dt>{uiText("关联等级")}</dt><dd>{associationLabel(item.association)}</dd></div></dl></section>
      <details className="replay-technical"><summary>{uiText("技术详情（默认折叠）")}</summary><p>{uiText("这里只展示脱敏后的结构字段，不包含凭据、Prompt 或完整响应正文。")}</p><dl><div><dt>{uiText("记录ID")}</dt><dd>{item.record_id}</dd></div><div><dt>{uiText("来源")}</dt><dd>{item.source_type||uiText("真实UAT调用日志")}</dd></div><div><dt>{uiText("成本依据")}</dt><dd>{item.counterfactual.cost_basis||reasonLabel[item.counterfactual.cost_unavailable_reason||""]||uiText("不可计算")}</dd></div><div><dt>{uiText("延迟依据")}</dt><dd>{item.counterfactual.latency_basis||reasonLabel[item.counterfactual.reason||""]||uiText("不可计算")}</dd></div></dl></details>
    </aside>
  </div>;
}

export default function HistoricalReplayPage(){
  useLocale();
  const [form,setForm]=useState<HistoricalReplayInput>({environment_id:"china_uat",occurred_from:null,occurred_to:null,model:null,channel:null,request_type:null,baseline_strategy:"actual_observed",candidate_strategy:"latency_first",exact_only:false,limit:1000});
  const [search,setSearch]=useState("");
  const [modelFilter,setModelFilter]=useState("");
  const [channelFilter,setChannelFilter]=useState("");
  const [changedOnly,setChangedOnly]=useState(false);
  const [lowOnly,setLowOnly]=useState(false);
  const [unestimableOnly,setUnestimableOnly]=useState(false);
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<HistoricalReplayItem|null>(null);
  const source=useQuery({queryKey:["historical-replay-source",form.environment_id],queryFn:({signal})=>api.historicalReplaySource({environment_id:form.environment_id},signal)});
  const replay=useMutation({mutationFn:()=>api.runHistoricalReplay(form),onSuccess:()=>setPage(1)});
  const result=replay.data;
  const filtered=useMemo(()=>{
    const needle=search.trim().toLowerCase();
    return (result?.items||[]).filter(item=>{
      if(needle&&!`${item.request_id||""} ${item.actual.model||""} ${item.actual.channel_id||""} ${item.counterfactual.model||""} ${item.counterfactual.channel_id||""}`.toLowerCase().includes(needle))return false;
      if(modelFilter&&item.actual.model!==modelFilter&&item.counterfactual.model!==modelFilter)return false;
      if(channelFilter&&item.actual.channel_id!==channelFilter&&item.counterfactual.channel_id!==channelFilter)return false;
      if(changedOnly&&item.counterfactual.choice_changed!==true)return false;
      if(lowOnly&&item.counterfactual.confidence!=="low")return false;
      if(unestimableOnly&&item.counterfactual.channel_id!==null&&item.counterfactual.estimated_cost!==null&&item.counterfactual.estimated_latency_ms!==null)return false;
      return true;
    });
  },[result,search,modelFilter,channelFilter,changedOnly,lowOnly,unestimableOnly]);
  const replayModels=useMemo(()=>Array.from(new Set((result?.items||[]).flatMap(item=>[item.actual.model,item.counterfactual.model]).filter((item):item is string=>Boolean(item)))).sort(),[result]);
  const replayChannels=useMemo(()=>Array.from(new Set((result?.items||[]).flatMap(item=>[item.actual.channel_id,item.counterfactual.channel_id]).filter((item):item is string=>Boolean(item)))).sort(),[result]);
  const pageSize=25,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const rows=filtered.slice((Math.min(page,totalPages)-1)*pageSize,Math.min(page,totalPages)*pageSize);
  const explainableDecision=(result?.items||[]).find(item=>Boolean(item.decision_id))?.decision_id;
  const set=(key:keyof HistoricalReplayInput,next:unknown)=>setForm(current=>({...current,[key]:next}));
  return <main className="historical-replay-page">
    <header className="replay-page-header"><div><span className="replay-kicker">{uiText("REAL UAT · OFFLINE COUNTERFACTUAL")}</span><h1>{uiText("历史回放")}</h1><p>{uiText("用同一批真实 UAT 请求比较历史实际选择与候选策略的离线决策。")}</p></div><Link className="secondary button-link" to="/routing/runs">{uiText("查看真实日志")}</Link></header>
    <BusinessSkillAction skillId="explain-routing-decision" label={uiText("解释回放中的真实决策")} argumentsValue={{decision_id:explainableDecision??"",include_metrics:true,include_execution:true}} disabledReason={explainableDecision?undefined:"当前回放结果没有可精确关联的 decision_id"}/>

    <section className="replay-filter-panel" aria-label={uiText("回放条件")}><div className="replay-filter-grid">
      <label>{uiText("环境")}<select value={form.environment_id} onChange={event=>set("environment_id",event.target.value)}><option value="china_uat">{uiText("国内 UAT")}</option></select></label>
      <label>{uiText("开始时间")}<input type="datetime-local" value={form.occurred_from?.slice(0,16)||""} onChange={event=>set("occurred_from",event.target.value?new Date(event.target.value).toISOString():null)}/></label>
      <label>{uiText("结束时间")}<input type="datetime-local" value={form.occurred_to?.slice(0,16)||""} onChange={event=>set("occurred_to",event.target.value?new Date(event.target.value).toISOString():null)}/></label>
      <label>{uiText("模型")}<input value={form.model||""} onChange={event=>set("model",event.target.value||null)} placeholder={uiText("全部模型")}/></label>
      <label>{uiText("渠道")}<input value={form.channel||""} onChange={event=>set("channel",event.target.value||null)} placeholder={uiText("全部渠道")}/></label>
      <label>{uiText("请求类型")}<input value={form.request_type||""} onChange={event=>set("request_type",event.target.value||null)} placeholder={uiText("全部类型")}/></label>
      <label>{uiText("基线策略")}<select value={form.baseline_strategy} onChange={event=>set("baseline_strategy",event.target.value)}>{STRATEGIES.map(([key,label])=><option key={key} value={key}>{uiText(label)}</option>)}</select></label>
      <label>{uiText("候选策略")}<select value={form.candidate_strategy} onChange={event=>set("candidate_strategy",event.target.value)}>{STRATEGIES.filter(([key])=>key!==form.baseline_strategy).map(([key,label])=><option key={key} value={key}>{uiText(label)}</option>)}</select></label>
      <label className="inline-check"><input type="checkbox" checked={form.exact_only} onChange={event=>set("exact_only",event.target.checked)}/>{uiText("只使用精确关联")}</label>
      <button onClick={()=>replay.mutate()} disabled={replay.isPending||form.baseline_strategy===form.candidate_strategy||!source.data?.sample_count}>{replay.isPending?uiText("正在回放…"):uiText("运行历史回放")}</button>
    </div></section>

    {source.isLoading&&<div className="replay-empty">{uiText("正在读取真实 UAT 日志来源…")}</div>}
    {source.error&&<div className="replay-error" role="alert">{uiText("真实日志来源读取失败，请检查本地后端后重试。")}</div>}
    {source.data&&<section className="replay-source-strip" aria-label={uiText("数据来源")}><div><b>{uiText("真实 UAT 日志 · 国内 UAT")}</b><span>{localTime(source.data.occurred_from)} {uiText("至 ")}{localTime(source.data.occurred_to)}</span><small>{source.data.sources.map(item=>`${item.source_type} ${item.count}`).join(" · ")||uiText("没有真实日志来源")}</small></div><dl><div><dt>{uiText("样本")}</dt><dd>{source.data.sample_count}</dd></div><div><dt>{uiText("精确关联 ")}</dt><dd>{source.data.exact_association_count}</dd></div><div><dt>{uiText("无法关联")}</dt><dd>{source.data.unlinked_count}</dd></div><div><dt>{uiText("最后同步")}</dt><dd>{localTime(source.data.last_synced_at)}</dd></div><div><dt>{uiText("同步水位")}</dt><dd>{source.data.source_watermark||uiText("未生成")}</dd></div><div><dt>{uiText("配置版本")}</dt><dd>{source.data.configuration_versions.join("、")||uiText("未提供")}</dd></div><div><dt>{uiText("价格版本")}</dt><dd>{source.data.price_versions.join("、")||uiText("未关联")}</dd></div></dl><Link to="/routing/runs">{uiText("查看来源")}</Link></section>}
    {source.data&&source.data.sample_count>0&&<>
      <section className="replay-observed" aria-label={uiText("历史实际数据")}><header><div><span className="replay-kicker">{uiText("OBSERVED USAGE")}</span><h2>{uiText("历史实际数据")}</h2></div><span>{uiText("按统一调用日志中的已发生结果统计，不依赖 Request ID 或候选价格版本")}</span></header><div className="replay-metric-row observed-metrics">
        <article><small>{uiText("实际调用")}</small><strong>{integer(source.data.actual.record_count)} {uiText("条")}</strong><span>{source.data.sources.map(item=>`${item.source_type} ${item.count}`).join(" · ")}</span></article>
        <article><small>{uiText("输入 Token")}</small><strong>{integer(source.data.actual.input_tokens)}</strong><span>{uiText("缓存输入 ")}{integer(source.data.actual.cached_input_tokens)}</span></article>
        <article><small>{uiText("输出 Token")}</small><strong>{integer(source.data.actual.output_tokens)}</strong><span>{uiText("来自标准化日志字段")}</span></article>
        <article><small>{uiText("历史实际费用")}</small><strong>{money(source.data.actual.total_cost,source.data.actual.currency)}</strong><span>{uiText("覆盖 ")}{source.data.actual.cost_coverage_count}/{source.data.actual.record_count} {uiText("· 花费字段")}</span></article>
        <article><small>{uiText("实际 P95 / P99")}</small><strong>{value(source.data.actual.p95_latency_ms," ms")} / {value(source.data.actual.p99_latency_ms," ms")}</strong><span>P50 {value(source.data.actual.p50_latency_ms," ms")}</span></article>
        <article><small>{uiText("失败与流式")}</small><strong>{source.data.actual.failure_count} {uiText("次失败")}</strong><span>{uiText("流式 ")}{source.data.actual.stream_count} {uiText("· 非流式 ")}{source.data.actual.nonstream_count}</span></article>
      </div></section>
      <section className="replay-capability-strip" aria-label={uiText("数据能力说明")}>
        <span><b>{uiText("历史聚合统计")}</b> {uiText("可用 · ")}{source.data.evidence_capabilities.historical_aggregation} {uiText("条")}</span>
        <span><b>{uiText("请求级精确关联")}</b> {source.data.evidence_capabilities.exact_decision_reconstruction}/{source.data.sample_count}</span>
        <span><b>{uiText("仅历史统计")}</b> {source.data.evidence_capabilities.historical_statistics_only} {uiText("条")}</span>
        <span><b>{uiText("渠道级比较")}</b> {source.data.evidence_capabilities.authoritative_channel?uiText("{0} 条有权威渠道证据", {"0": source.data.evidence_capabilities.authoritative_channel}):uiText("证据不足")}</span>
        <span><b>{uiText("无法使用")}</b> {source.data.evidence_capabilities.unusable} {uiText("条")}</span>
      </section>
    </>}
    {source.data?.sample_count===0&&<div className="replay-empty"><b>{uiText("当前没有可用于回放的真实UAT日志。")}</b><span>{uiText("系统不会自动切换到 Demo 数据，也不会生成成本、延迟或变化率。")}</span></div>}
    {replay.error&&<div className="replay-error" role="alert">{uiText("历史回放运行失败：请确认基线与候选策略不同，并检查筛选条件。")}</div>}

    {result&&<>
      <section className="replay-conclusion"><span>{uiText("离线结论")}</span><h2>{result.conclusion}</h2><p>{result.disclaimer}</p></section>
      <section className="replay-metric-row" aria-label={uiText("核心比较结果")}>
        <article><small>{uiText("有效样本")}</small><strong>{result.sample_count} {uiText("条")}</strong><span>{uiText("精确关联 ")}{result.exact_association_count} {uiText("· 覆盖率 ")}{result.sample_count?Math.round(result.exact_association_count/result.sample_count*100):0}%</span></article>
        <article><small>{uiText("选择发生变化")}</small><strong>{result.choice_changed_count} / {result.choice_comparable_count}</strong><span>{result.choice_changed_rate===null?uiText("缺少渠道关联"):`${(result.choice_changed_rate*100).toFixed(1)}%`} {uiText("· 仅比较可关联选择")}</span></article>
        <article><small>{uiText("候选策略费用")}</small><strong>{money(result.cost.candidate,result.cost.currency)}</strong><span>{result.cost.candidate===null?(reasonLabel[result.cost.candidate_unavailable_reason||""]||uiText("候选价格证据不足")):uiText("相对实际 {0}", {"0": percent(result.cost.delta_percent)})} {uiText("· 覆盖 ")}{result.cost.coverage_count}/{result.sample_count}</span></article>
        <article><small>{uiText("可估算延迟 P95")}</small><strong>{value(result.latency.baseline_p95_ms," ms")} → {value(result.latency.candidate_p95_ms," ms")}</strong><span>{uiText("覆盖 ")}{result.latency.coverage_count}/{result.sample_count} {uiText("· 最少3条同模型渠道样本")}</span></article>
        <article><small>{uiText("Fallback")}</small><strong>{result.fallback.baseline} → {result.fallback.candidate===null?uiText("不可推断"):result.fallback.candidate}</strong><span>{uiText("反事实执行未发生")}</span></article>
        <article><small>{uiText("成功状态变化")}</small><strong>{result.success_changes.success_to_failure===null?uiText("不可推断"):`${result.success_changes.success_to_failure} / ${result.success_changes.failure_to_success}`}</strong><span>{uiText("成功→失败 / 失败→成功 · 覆盖 0/")}{result.sample_count}</span></article>
        <article><small>{uiText("SLA 风险")}</small><strong>{result.sla.candidate_risk===null?uiText("无法判断"):result.sla.candidate_risk}</strong><span>{uiText("实际失败 ")}{result.sla.baseline_failure_count} {uiText("· 超时 ")}{result.sla.baseline_timeout_count} {uiText("· 限流 ")}{result.sla.baseline_rate_limit_count}</span></article>
        <article><small>{uiText("低置信度")}</small><strong>{result.low_confidence_count} {uiText("条")}</strong><span>{uiText("风险 ")}{result.risk_count} {uiText("· 不可估算 ")}{result.unestimable_count}</span></article>
      </section>

      {result.choice_comparable_count===0&&<div className="replay-comparison-empty"><b>{uiText("候选策略尚未产生可比较决策。")}</b><span>{uiText("历史实际 Token、费用和延迟统计仍然有效。")}</span><small>{reasonLabel[result.cost.candidate_unavailable_reason||""]||uiText("缺少可追溯的候选模型或渠道证据。")}</small></div>}

      <section className="replay-comparison"><header><div><span className="replay-kicker">{uiText("POLICY DIFF")}</span><h2>{uiText("基线策略 vs 候选策略")}</h2></div></header><div className="replay-table-scroll"><table><thead><tr><th>{uiText("项目")}</th><th><span className="actual-tag">{uiText("历史实际")}</span> {strategyName(result.baseline_strategy)}</th><th><span className="estimate-tag">{uiText("离线估算")}</span> {strategyName(result.candidate_strategy)}</th><th>{uiText("差异 / 口径")}</th></tr></thead><tbody>
        <tr><td>{uiText("模型与渠道选择")}</td><td>{uiText("当时真实执行结果")}</td><td>{result.choice_comparable_count?uiText("{0} 条发生变化", {"0": result.choice_changed_count}):uiText("渠道证据不足")}</td><td>{uiText("仅比较存在权威渠道关联的记录")}</td></tr>
        <tr><td>{uiText("成本")}</td><td>{money(result.actual.total_cost,result.actual.currency)}<small>{result.cost.actual_formula} {uiText("· 覆盖 ")}{result.actual.cost_coverage_count}/{result.actual.record_count}</small></td><td>{money(result.cost.candidate,result.cost.currency)}<small>{result.cost.candidate===null?(reasonLabel[result.cost.candidate_unavailable_reason||""]||uiText("不可计算")):result.cost.formula}</small></td><td>{percent(result.cost.delta_percent)} {uiText("· 候选覆盖 ")}{result.cost.coverage_count}/{result.sample_count}</td></tr>
        <tr><td>{uiText("P95 延迟")}</td><td>{value(result.latency.baseline_p95_ms," ms")}</td><td>{value(result.latency.candidate_p95_ms," ms")}</td><td>{result.latency.formula}</td></tr>
        <tr><td>{uiText("成功状态")}</td><td>{uiText("真实状态")}</td><td>{uiText("不可推断")}</td><td>{result.success_changes.reason}</td></tr>
        <tr><td>{uiText("SLA 风险")}</td><td>{uiText("失败 ")}{result.sla.baseline_failure_count} {uiText("· 超时 ")}{result.sla.baseline_timeout_count} {uiText("· P99 ")}{value(result.sla.baseline_p99_ms," ms")}</td><td>{uiText("无法判断")}</td><td>{result.sla.reason}</td></tr>
        <tr><td>{uiText("Fallback")}</td><td>{result.fallback.baseline} {uiText("次")}</td><td>{uiText("不可推断")}</td><td>{result.fallback.reason}</td></tr>
        <tr><td>{uiText("渠道集中度 HHI")}</td><td>{value(result.concentration.baseline_hhi)}</td><td>{value(result.concentration.candidate_hhi)}</td><td>{result.concentration.reason||result.concentration.formula}</td></tr>
      </tbody></table></div></section>

      <section className="replay-requests"><header><div><span className="replay-kicker">{uiText("REQUEST LEDGER")}</span><h2>{uiText("逐请求回放")}</h2><p>{uiText("点击任一记录，查看真实执行与候选策略估算的证据时间线。")}</p></div><a className="secondary button-link" href={api.historicalReplayExportUrl(result.replay_id)}>{uiText("导出 CSV")}</a></header>
        <div className="replay-request-filters"><label>{uiText("搜索记录")}<input value={search} onChange={event=>{setSearch(event.target.value);setPage(1)}} placeholder={uiText("Request ID 或模型")}/></label><label>{uiText("模型")}<select value={modelFilter} onChange={event=>{setModelFilter(event.target.value);setPage(1)}}><option value="">{uiText("全部模型")}</option>{replayModels.map(model=><option key={model}>{model}</option>)}</select></label><label>{uiText("渠道")}<select value={channelFilter} onChange={event=>{setChannelFilter(event.target.value);setPage(1)}}><option value="">{uiText("全部渠道")}</option>{replayChannels.map(channel=><option key={channel}>{channel}</option>)}</select></label><label><input type="checkbox" checked={changedOnly} onChange={event=>{setChangedOnly(event.target.checked);setPage(1)}}/>{uiText("只看发生变化")}</label><label><input type="checkbox" checked={lowOnly} onChange={event=>{setLowOnly(event.target.checked);setPage(1)}}/>{uiText("只看低置信度")}</label><label><input type="checkbox" checked={unestimableOnly} onChange={event=>{setUnestimableOnly(event.target.checked);setPage(1)}}/>{uiText("只看不可估算")}</label></div>
        <div className="replay-table-scroll"><table><thead><tr><th>{uiText("时间")}</th><th>{uiText("模型")}</th><th>{uiText("调用结果")}</th><th>{uiText("流式状态")}</th><th>{uiText("输入 Token")}</th><th>{uiText("输出 Token")}</th><th>{uiText("实际费用")}</th><th>{uiText("总耗时 / 首Token")}</th><th>{uiText("关联等级")}</th><th>{uiText("候选策略")}</th></tr></thead><tbody>{rows.map(item=><tr key={item.record_id} onClick={()=>setSelected(item)} tabIndex={0} onKeyDown={event=>{if(event.key==="Enter")setSelected(item)}}><td>{localTime(item.occurred_at)}</td><td>{item.actual.actual_model||item.actual.model||uiText("未提供")}<small>{item.actual.billed_model&&item.actual.billed_model!==(item.actual.actual_model||item.actual.model)?uiText("计费模型 {0}", {"0": item.actual.billed_model}):item.source_type==="historical_uat_csv"?uiText("历史 UAT"):uiText("实时执行")}</small></td><td>{item.actual.status||uiText("未提供")}<small>{item.actual.http_status?uiText("HTTP {0}", {"0": item.actual.http_status}):uiText("历史状态")}</small></td><td>{item.actual.stream===true?uiText("流式"):item.actual.stream===false?uiText("非流式"):uiText("未提供")}</td><td>{integer(item.actual.input_tokens)}<small>{uiText("缓存 ")}{integer(item.actual.cached_input_tokens)}</small></td><td>{integer(item.actual.output_tokens)}</td><td>{money(item.actual.cost_amount,item.actual.currency)}<small>{item.actual.price_version||uiText("价格说明未版本化")}</small></td><td>{value(item.actual.latency_ms," ms")}<small>{uiText("首Token ")}{value(item.actual.first_token_latency_ms," ms")}</small></td><td><span className={item.association==="exact"?"confidence-high":item.association==="historical_statistics"?"confidence-medium":"confidence-low"}>{associationLabel(item.association)}</span><small>{item.request_id||uiText("Request ID 未提供")}</small></td><td>{item.counterfactual.channel_id?`${item.counterfactual.model} / ${item.counterfactual.channel_id}`:uiText("不可比较")}<small>{reasonLabel[item.counterfactual.reason||item.counterfactual.cost_unavailable_reason||""]||uiText("证据充分")}</small></td></tr>)}</tbody></table></div>
        {!rows.length&&<div className="replay-empty">{uiText("当前筛选条件下没有逐请求记录。")}</div>}
        <footer className="replay-pagination"><span>{uiText("共 ")}{filtered.length} {uiText("条 · 第 ")}{Math.min(page,totalPages)} / {totalPages} {uiText("页")}</span><div><button className="secondary" disabled={page<=1} onClick={()=>setPage(current=>current-1)}>{uiText("上一页")}</button><button className="secondary" disabled={page>=totalPages} onClick={()=>setPage(current=>current+1)}>{uiText("下一页")}</button></div></footer>
      </section>
    </>}
    {selected&&<ReplayDrawer item={selected} onClose={()=>setSelected(null)}/>} 
  </main>;
}
