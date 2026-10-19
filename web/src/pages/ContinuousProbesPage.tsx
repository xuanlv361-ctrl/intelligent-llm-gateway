import {getLocale,localeTags,translate as uiText,useLocale} from "../i18n/index";
import {FormEvent, useEffect, useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Link, useNavigate, useParams, useSearchParams} from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {api, ApiError, ProbeCreateInput, ProbeEvent, ProbeRun, ProbeRunSummary} from "../services/api";

const uiLabel=(source:string|undefined)=>source===undefined?undefined:uiText(source);

const STATUS_LABEL:Record<string,string>={
  CREATED:"待运行",RUNNING:"运行中",PAUSED:"已暂停",COMPLETED:"已完成",STOPPED:"已停止",
  FAILED:"运行失败",AUTO_STOPPED:"自动停止",INTERRUPTED:"意外中断",
};
const EVENT_LABEL:Record<string,string>={
  circuit_recovered:"熔断已恢复",half_open_probe:"半开状态探测",circuit_opened:"熔断已开启",
  circuit_control_failure:"熔断控制失败",throttled:"自动限速",probe_throttled:"自动限速",
  paused:"任务暂停",probe_paused:"任务暂停",probe_pause:"任务暂停",resumed:"任务恢复",probe_resumed:"任务恢复",
  probe_resume:"任务恢复",stopped:"任务停止",probe_stop:"任务停止",auto_stopped:"自动停止",probe_auto_stop:"自动停止",
  started:"任务开始",probe_start:"任务开始",completed:"任务完成",probe_complete:"任务完成",
};
const SOURCE_LABEL:Record<string,string>={provider_live:"Provider自然观测",provider_observed:"Provider自然观测",
  uat_fault_injection:"UAT受控故障注入",uat_injected:"UAT受控故障注入",local_control_event:"本地控制事件"};
const COLORS=["#486a42","#9d6d2d","#3d6f8c","#9b4840","#81724b","#67805d"];

const asNumber=(value:unknown,fallback=0)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
const pct=(value:unknown)=>typeof value==="number"?value.toLocaleString(localeTags[getLocale()],{style:"percent",minimumFractionDigits:1,maximumFractionDigits:1}):uiText("暂无数据");
const ms=(value:unknown)=>typeof value==="number"?`${Math.round(value).toLocaleString(localeTags[getLocale()])} ms`:uiText("暂无数据");
const money=(value:unknown)=>value===null||value===undefined||value===""?uiText("待 Provider 日志同步"):`¥${value}`;
const cnTime=(value:unknown)=>{
  if(!value)return uiText("未记录");
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?uiText("未记录"):date.toLocaleString(localeTags[getLocale()],{timeZone:"Asia/Shanghai",hour12:false});
};
const elapsed=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(Math.floor(seconds%60)).padStart(2,"0")}`;
const stringList=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
const configOf=(run:ProbeRun):Record<string,unknown>=>{
  if(run.configuration)return run.configuration;
  if(run.configuration_json&&typeof run.configuration_json==="object")return run.configuration_json;
  if(typeof run.configuration_json==="string")try{return JSON.parse(run.configuration_json) as Record<string,unknown>;}catch{return {};}
  return {};
};
const summaryOf=(run?:ProbeRun):ProbeRunSummary=>{
  if(!run)return {};
  if(run.summary)return run.summary;
  if(run.summary_json&&typeof run.summary_json==="object")return run.summary_json as ProbeRunSummary;
  if(typeof run.summary_json==="string")try{return JSON.parse(run.summary_json) as ProbeRunSummary;}catch{return {};}
  return {};
};

function ProbeState({error,onRetry}:{error:unknown;onRetry:()=>void}){
  useLocale();
  const message=uiText(error instanceof ApiError?error.message:error instanceof Error?error.message:"请求失败");
  return <section className="probe-empty probe-error" role="alert"><b>{uiText("探测数据读取失败")}</b><span>{message}</span><button onClick={onRetry}>{uiText("重新读取")}</button></section>;
}

type Draft={name:string;endpoint:string;method:string;models:string[];stream:boolean;prompt:string;duration:string;customDuration:string;
  interval:string;concurrency:string;timeout:string;maxTokens:string;maxRequests:string;provider:string;
  consecutiveFailures:string;minimumSuccessRate:string;max429Rate:string;max5xxRate:string;maxP95:string;
  maxActualCost:string;pauseOnCircuit:boolean;resumeAfterRecovery:boolean};
const initialDraft:Draft={name:"5分钟国内UAT模型探测",endpoint:"/v1/chat/completions",method:"POST",models:[],stream:false,prompt:"请只回答：OK",duration:"300",customDuration:"",
  interval:"5",concurrency:"1",timeout:"30",maxTokens:"16",maxRequests:"",provider:"",
  consecutiveFailures:"5",minimumSuccessRate:"90",max429Rate:"10",max5xxRate:"5",maxP95:"20000",
  maxActualCost:"",pauseOnCircuit:true,resumeAfterRecovery:true};

function CreateProbeDrawer({open,onClose,seed}:{open:boolean;onClose:()=>void;seed?:Partial<Draft>}){
  useLocale();
  const navigate=useNavigate();
  const [draft,setDraft]=useState<Draft>({...initialDraft,...seed});
  const [advanced,setAdvanced]=useState(false);
  const catalog=useQuery({queryKey:["probe-model-catalog"],queryFn:({signal})=>api.environmentModels("china_uat",false,signal),enabled:open});
  const create=useMutation({mutationFn:(body:ProbeCreateInput)=>api.createProbe(body),onSuccess:run=>navigate(`/reliability/probes/${encodeURIComponent(run.probe_run_id)}`)});
  useEffect(()=>{if(open&&seed)setDraft({...initialDraft,...seed});},[open,seed]);
  if(!open)return null;
  const providers=Array.from(new Set((catalog.data?.models??[]).map(model=>model.owned_by).filter(Boolean) as string[]));
  const visibleModels=(catalog.data?.models??[]).filter(model=>!draft.provider||model.owned_by===draft.provider);
  const toggle=(id:string)=>setDraft(value=>({...value,models:value.models.includes(id)?value.models.filter(item=>item!==id):[...value.models,id]}));
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    const duration=Number(draft.duration==="custom"?draft.customDuration:draft.duration);
    create.mutate({name:draft.name.trim(),environment_id:"china_uat",base_url:"https://api-uat.weimeta.cn",
      endpoint:draft.endpoint,method:draft.method,models:draft.models,stream:draft.stream,prompt:draft.prompt,
      duration_seconds:duration,interval_seconds:Number(draft.interval),max_concurrency:Number(draft.concurrency),
      timeout_seconds:Number(draft.timeout),max_tokens:Number(draft.maxTokens),max_requests:draft.maxRequests?Number(draft.maxRequests):null,
      rotation_mode:"round_robin",stop_thresholds:{consecutive_failures:Number(draft.consecutiveFailures),
        minimum_success_rate:Number(draft.minimumSuccessRate)/100,max_429_rate:Number(draft.max429Rate)/100,
        max_5xx_rate:Number(draft.max5xxRate)/100,max_p95_ms:Number(draft.maxP95),
        ...(draft.maxActualCost?{max_actual_cost:draft.maxActualCost}:{}),
        pause_on_circuit_open:draft.pauseOnCircuit,resume_after_recovery:draft.resumeAfterRecovery}});
  };
  return <div className="probe-drawer-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <aside className="probe-drawer" role="dialog" aria-modal="true" aria-labelledby="new-probe-title">
      <header><div><span className="probe-eyebrow">{uiText("NEW UAT PROBE")}</span><h2 id="new-probe-title">{uiText("新建探测任务")}</h2><p>{uiText("运行 ID 将由后端创建，无需填写审批引用。")}</p></div><button className="probe-icon" aria-label={uiText("关闭新建任务")} onClick={onClose}>×</button></header>
      <form onSubmit={submit}>
        <section><h3>{uiText("基本配置")}</h3><div className="probe-form-grid">
          <label className="wide">{uiText("任务名称")}<input value={draft.name} required onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
          <label>{uiText("环境")}<input value={uiText("国内 UAT")} disabled/></label><label>{uiText("API Key 状态")}<input value={uiText("使用后端安全会话")} disabled/></label>
          <label>{uiText("Base URL")}<input value="https://api-uat.weimeta.cn" disabled/></label><label>{uiText("Endpoint")}<input value={draft.endpoint} onChange={e=>setDraft({...draft,endpoint:e.target.value})}/></label>
          <label>{uiText("HTTP Method")}<select value={draft.method} onChange={e=>setDraft({...draft,method:e.target.value})}>{["GET","POST","PUT","PATCH","DELETE"].map(method=><option key={method}>{method}</option>)}</select></label><label>{uiText("响应方式")}<select value={String(draft.stream)} onChange={e=>setDraft({...draft,stream:e.target.value==="true"})}><option value="false">{uiText("非流式")}</option><option value="true">{uiText("流式")}</option></select></label>
          <label className="wide">{uiText("探测请求内容")}<textarea rows={3} value={draft.prompt} required onChange={e=>setDraft({...draft,prompt:e.target.value})}/></label>
        </div></section>
        <section><div className="probe-section-title"><h3>{uiText("模型范围")}</h3><span>{draft.models.length} {uiText("个已选 · 真实目录 ")}{catalog.data?.model_count??uiText("读取中")}</span></div>
          <label className="probe-inline-filter">{uiText("Provider")}<select value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="">{uiText("全部 Provider")}</option>{providers.map(item=><option key={item}>{item}</option>)}</select></label>
          {catalog.error?<p className="probe-form-error">{uiText("真实模型目录读取失败，无法创建任务。")}</p>:<div className="probe-model-picker">{visibleModels.map(model=><label key={model.id}><input type="checkbox" checked={draft.models.includes(model.id)} onChange={()=>toggle(model.id)}/><span>{model.display_name||model.id}<small>{model.id}{model.owned_by?` · ${model.owned_by}`:""}</small></span></label>)}</div>}
        </section>
        <section><h3>{uiText("运行配置")}</h3><div className="probe-form-grid">
          <label>{uiText("持续时间")}<select value={draft.duration} onChange={e=>setDraft({...draft,duration:e.target.value})}><option value="60">{uiText("1分钟")}</option><option value="300">{uiText("5分钟")}</option><option value="900">{uiText("15分钟")}</option><option value="1800">{uiText("30分钟")}</option><option value="custom">{uiText("自定义")}</option></select></label>
          {draft.duration==="custom"&&<label>{uiText("自定义秒数")}<input type="number" min="10" value={draft.customDuration} required onChange={e=>setDraft({...draft,customDuration:e.target.value})}/></label>}
          <label>{uiText("请求间隔（秒）")}<input type="number" min="0.5" step="0.5" value={draft.interval} required onChange={e=>setDraft({...draft,interval:e.target.value})}/></label>
          <label>{uiText("最大并发")}<input type="number" min="1" max="10" value={draft.concurrency} required onChange={e=>setDraft({...draft,concurrency:e.target.value})}/></label>
          <label>{uiText("单请求超时（秒）")}<input type="number" min="1" value={draft.timeout} required onChange={e=>setDraft({...draft,timeout:e.target.value})}/></label>
          <label>{uiText("最大输出 Token")}<input type="number" min="1" value={draft.maxTokens} required onChange={e=>setDraft({...draft,maxTokens:e.target.value})}/></label>
          <label>{uiText("最大总请求数（可选）")}<input type="number" min="1" value={draft.maxRequests} onChange={e=>setDraft({...draft,maxRequests:e.target.value})}/></label>
          <label>{uiText("模型轮询")}<input value={uiText("轮转（Round Robin）")} disabled/></label>
        </div></section>
        <details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}><summary>{uiText("高级停止条件")}</summary><div className="probe-form-grid advanced">
          <label>{uiText("连续失败次数")}<input type="number" min="1" value={draft.consecutiveFailures} onChange={e=>setDraft({...draft,consecutiveFailures:e.target.value})}/></label>
          <label>{uiText("成功率低于（%）")}<input type="number" min="0" max="100" value={draft.minimumSuccessRate} onChange={e=>setDraft({...draft,minimumSuccessRate:e.target.value})}/></label>
          <label>{uiText("429比例超过（%）")}<input type="number" min="0" max="100" value={draft.max429Rate} onChange={e=>setDraft({...draft,max429Rate:e.target.value})}/></label>
          <label>{uiText("5xx比例超过（%）")}<input type="number" min="0" max="100" value={draft.max5xxRate} onChange={e=>setDraft({...draft,max5xxRate:e.target.value})}/></label>
          <label>{uiText("P95超过（ms）")}<input type="number" min="1" value={draft.maxP95} onChange={e=>setDraft({...draft,maxP95:e.target.value})}/></label>
          <label>{uiText("实际费用超过（¥）")}<input inputMode="decimal" value={draft.maxActualCost} onChange={e=>setDraft({...draft,maxActualCost:e.target.value})}/></label>
          <label className="probe-checkbox"><input type="checkbox" checked={draft.pauseOnCircuit} onChange={e=>setDraft({...draft,pauseOnCircuit:e.target.checked})}/>{uiText("熔断后自动暂停")}</label>
          <label className="probe-checkbox"><input type="checkbox" checked={draft.resumeAfterRecovery} onChange={e=>setDraft({...draft,resumeAfterRecovery:e.target.checked})}/>{uiText("恢复后继续")}</label>
        </div></details>
        {create.error&&<p className="probe-form-error" role="alert">{create.error instanceof Error?create.error.message:uiText("创建失败")}</p>}
        <footer><button type="button" className="secondary" onClick={onClose}>{uiText("取消")}</button><button disabled={create.isPending||draft.models.length===0||!draft.name.trim()}>{create.isPending?uiText("正在创建…"):uiText("开始探测")}</button></footer>
      </form>
    </aside>
  </div>;
}

export function ContinuousProbeListPage(){
  useLocale();
  const [params,setParams]=useSearchParams();
  const [showCreate,setShowCreate]=useState(false);
  const [lookup,setLookup]=useState("");
  const query=params.get("q")??"";const status=params.get("status")??"";const range=params.get("range")??"7d";
  const start=params.get("start")??"";const end=params.get("end")??"";
  const runs=useQuery({queryKey:["probes",query,status,range,start,end],queryFn:({signal})=>api.probes({query,status,time_range:range,start:start?new Date(`${start}T00:00:00+08:00`).toISOString():undefined,end:end?new Date(`${end}T23:59:59+08:00`).toISOString():undefined,limit:100},signal),refetchInterval:10000});
  const navigate=useNavigate();
  const client=useQueryClient();
  const control=useMutation({mutationFn:({id,action}:{id:string;action:'pause'|'resume'|'stop'})=>api.probeAction(id,action),onSuccess:()=>client.invalidateQueries({queryKey:["probes"]})});
  const clone=useMutation({mutationFn:(id:string)=>api.cloneProbe(id),onSuccess:value=>{if("probe_run_id" in value)navigate(`/reliability/probes/${encodeURIComponent(value.probe_run_id)}`);}});
  const searchRun=()=>{const id=lookup.trim();if(id)navigate(`/reliability/probes/${encodeURIComponent(id)}`);};
  return <main className="probe-page probe-list-page">
    <header className="probe-heading"><div><span className="probe-eyebrow">{uiText("UAT RELIABILITY CONTROL")}</span><h1>{uiText("持续探测")}</h1><p>{uiText("对国内UAT模型执行独立探测，监测可用性、延迟、错误和熔断状态。")}</p></div><div className="probe-heading-actions"><button className="secondary" onClick={()=>runs.refetch()}>{uiText("刷新")}</button><button onClick={()=>setShowCreate(true)}>{uiText("新建探测任务")}</button></div></header>
    <section className="probe-run-rail" aria-label={uiText("任务查找与筛选")}>
      <label className="probe-search">{uiText("搜索任务")}<input placeholder={uiText("输入任务名称或运行 ID")} value={query} onChange={e=>setParams(current=>{const next=new URLSearchParams(current);if(e.target.value)next.set("q",e.target.value);else next.delete("q");return next;})}/></label>
      <label>{uiText("状态")}<select value={status} onChange={e=>setParams(current=>{const next=new URLSearchParams(current);if(e.target.value)next.set("status",e.target.value);else next.delete("status");return next;})}><option value="">{uiText("全部状态")}</option>{Object.entries(STATUS_LABEL).map(([key,label])=><option key={key} value={key}>{uiText(label)}</option>)}</select></label>
      <label>{uiText("时间")}<select value={range} onChange={e=>setParams(current=>{const next=new URLSearchParams(current);next.set("range",e.target.value);return next;})}><option value="today">{uiText("今天")}</option><option value="7d">{uiText("最近7天")}</option><option value="custom">{uiText("自定义")}</option><option value="all">{uiText("全部")}</option></select></label>
      {range==="custom"&&<div className="probe-custom-dates"><input aria-label={uiText("开始日期")} type="date" value={start} onChange={e=>setParams(current=>{const next=new URLSearchParams(current);next.set("start",e.target.value);return next;})}/><input aria-label={uiText("结束日期")} type="date" value={end} onChange={e=>setParams(current=>{const next=new URLSearchParams(current);next.set("end",e.target.value);return next;})}/></div>}
      <div className="probe-id-lookup"><input aria-label={uiText("按运行ID查询")} placeholder={uiText("PRB-…")} value={lookup} onChange={e=>setLookup(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")searchRun();}}/><button className="secondary" onClick={searchRun}>{uiText("打开运行")}</button></div>
    </section>
    {runs.isLoading?<section className="probe-empty"><b>{uiText("正在读取探测任务…")}</b></section>:runs.error?<ProbeState error={runs.error} onRetry={()=>runs.refetch()}/>:!runs.data?.items.length?<section className="probe-empty"><span className="probe-empty-mark">○</span><b>{uiText("尚无探测任务")}</b><p>{uiText("创建一个1分钟或5分钟国内UAT探测，验证模型可用性、延迟和熔断恢复。")}</p><button onClick={()=>setShowCreate(true)}>{uiText("新建探测任务")}</button></section>:<>
      <section className="probe-table-wrap"><table className="probe-table"><thead><tr><th>{uiText("任务名称")}</th><th>{uiText("运行 ID")}</th><th>{uiText("模型范围")}</th><th>{uiText("状态")}</th><th>{uiText("进度")}</th><th>{uiText("请求数")}</th><th>{uiText("成功率")}</th><th>P95</th><th>{uiText("实际费用")}</th><th>{uiText("开始时间")}</th><th>{uiText("操作")}</th></tr></thead><tbody>{runs.data.items.map(run=>{const summary=summaryOf(run);const config=configOf(run);const duration=asNumber(run.planned_duration_seconds??config.duration_seconds);const done=asNumber(run.duration_seconds??summary.duration_seconds);const progress=run.status==="COMPLETED"?1:typeof run.progress==="number"?(run.progress>1?run.progress/100:run.progress):(duration?done/duration:0);return <tr key={run.probe_run_id}><td><b>{run.name||run.task_name||uiText("未命名探测")}</b></td><td><code>{run.probe_run_id}</code></td><td>{(run.model_ids??stringList(config.models??config.model_ids)).slice(0,2).join("、")||uiText("未记录")}</td><td><span className={`probe-status ${String(run.status).toLowerCase()}`}>{uiLabel(STATUS_LABEL[run.status])??run.status}</span></td><td>{duration?`${Math.min(100,Math.round(progress*100))}%`:"—"}</td><td>{summary.request_count??run.completed_count??0}</td><td>{pct(summary.natural_success_rate??summary.comprehensive_success_rate??summary.success_rate)}</td><td>{ms(summary.p95_ms)}</td><td>{money(summary.actual_provider_cost)}</td><td>{cnTime(run.started_at??run.created_at)}</td><td><div className="probe-row-actions"><Link to={`/reliability/probes/${encodeURIComponent(run.probe_run_id)}`}>{uiText("查看")}</Link>{run.status==="RUNNING"&&<button onClick={()=>control.mutate({id:run.probe_run_id,action:"pause"})}>{uiText("暂停")}</button>}{run.status==="PAUSED"&&<button onClick={()=>control.mutate({id:run.probe_run_id,action:"resume"})}>{uiText("继续")}</button>}{["RUNNING","PAUSED","CREATED"].includes(run.status)&&<button onClick={()=>control.mutate({id:run.probe_run_id,action:"stop"})}>{uiText("停止")}</button>}<button onClick={()=>clone.mutate(run.probe_run_id)}>{uiText("复制配置")}</button></div></td></tr>;})}</tbody></table></section>
      <section className="probe-mobile-runs">{runs.data.items.map(run=>{const summary=summaryOf(run);return <article key={run.probe_run_id}><header><div><b>{run.name||run.task_name||uiText("未命名探测")}</b><code>{run.probe_run_id}</code></div><span className={`probe-status ${String(run.status).toLowerCase()}`}>{uiLabel(STATUS_LABEL[run.status])??run.status}</span></header><dl><div><dt>{uiText("请求")}</dt><dd>{summary.request_count??run.completed_count??0}</dd></div><div><dt>{uiText("自然成功率")}</dt><dd>{pct(summary.natural_success_rate)}</dd></div><div><dt>P95</dt><dd>{ms(summary.p95_ms)}</dd></div><div><dt>{uiText("实际费用")}</dt><dd>{money(summary.actual_provider_cost)}</dd></div></dl><Link to={`/reliability/probes/${encodeURIComponent(run.probe_run_id)}`}>{uiText("查看详情")}</Link></article>;})}</section>
    </>}
    <CreateProbeDrawer open={showCreate} onClose={()=>setShowCreate(false)}/>
  </main>;
}

function Kpi({label,value,note}:{label:string;value:string|number;note?:string}){return <article className="probe-kpi"><span>{uiText(label)}</span><strong>{value}</strong>{note&&<small>{uiText(note)}</small>}</article>;}
function ChartPanel({title,note,children}:{title:string;note:string;children:React.ReactNode}){return <section className="probe-panel probe-chart-panel"><header><div><h2>{uiText(title)}</h2><p>{uiText(note)}</p></div></header><div className="probe-chart">{children}</div></section>;}

export function ContinuousProbeDetailPage(){
  useLocale();
  const {probeRunId=""}=useParams();const navigate=useNavigate();const client=useQueryClient();
  const detail=useQuery({queryKey:["probe",probeRunId],queryFn:({signal})=>api.probe(probeRunId,signal),retry:false,refetchInterval:query=>query.state.data?.status==="RUNNING"||query.state.data?.status==="PAUSED"?3000:false});
  const live=detail.data?.status==="RUNNING"||detail.data?.status==="PAUSED";
  const metrics=useQuery({queryKey:["probe-metrics",probeRunId],queryFn:({signal})=>api.probeMetrics(probeRunId,signal),enabled:!!detail.data,refetchInterval:live?3000:false});
  const events=useQuery({queryKey:["probe-events",probeRunId],queryFn:({signal})=>api.probeEvents(probeRunId,signal),enabled:!!detail.data,refetchInterval:live?3000:false});
  const requests=useQuery({queryKey:["probe-requests",probeRunId],queryFn:({signal})=>api.probeRequests(probeRunId,signal),enabled:!!detail.data,refetchInterval:live?3000:false});
  const [showCreate,setShowCreate]=useState(false);
  const action=useMutation({mutationFn:(name:'pause'|'resume'|'stop')=>api.probeAction(probeRunId,name),onSuccess:()=>client.invalidateQueries({queryKey:["probe",probeRunId]})});
  if(detail.isLoading)return <main className="probe-page"><section className="probe-empty"><b>{uiText("正在读取探测任务…")}</b></section></main>;
  if(detail.error)return <main className="probe-page"><section className="probe-empty probe-not-found"><b>{uiText("未找到该探测任务")}</b><span>{probeRunId}</span><p>{uiText("请检查运行 ID，系统不会回退到历史验收数据。")}</p><button onClick={()=>navigate("/reliability/probes")}>{uiText("返回任务列表")}</button></section></main>;
  const run=detail.data!;const metricData=metrics.data;const flatSummary:ProbeRunSummary=metricData?{
    request_count:metricData.request_count,success_count:metricData.success_count,failure_count:metricData.failure_count,
    natural_success_rate:metricData.natural_success_rate,comprehensive_success_rate:metricData.comprehensive_success_rate,
    p50_ms:metricData.p50_ms,p95_ms:metricData.p95_ms,p99_ms:metricData.p99_ms,input_tokens:metricData.input_tokens,
    cached_tokens:metricData.cached_input_tokens,output_tokens:metricData.output_tokens,actual_provider_cost:metricData.actual_provider_cost,
    actual_cost_synced_count:metricData.actual_cost_synced_count,estimated_versioned_price:metricData.estimated_versioned_price,
    pending_provider_sync:metricData.pending_provider_sync_count,max_observed_concurrency:metricData.max_observed_concurrency,
  }:{};
  const summary={...summaryOf(run),...flatSummary,...(metricData?.summary??{})};const config=configOf(run);
  const planned=asNumber(run.planned_duration_seconds??config.duration_seconds);const started=run.started_at?new Date(run.started_at).getTime():Date.now();
  const ran=run.finished_at?Math.max(0,(new Date(run.finished_at).getTime()-started)/1000):Math.max(0,(Date.now()-started)/1000);
  const requestSeries=(metricData?.request_series??[]).map(row=>({...row,
    requests:row.requests??row.request_count,comprehensive_success_rate:row.comprehensive_success_rate??row.success_rate}));
  const latencySeries=metricData?.latency_series??metricData?.request_series??[];
  const errorSeries=(metricData?.error_distribution??metricData?.error_composition??[]).map(row=>({...row,label:typeof row.label==="string"?uiText(row.label):typeof row.category==="string"?uiText(row.category):row.label??row.category}));
  const modelSeries=metricData?.model_metrics??[];
  const tokenSeries=(metricData?.token_cost_series??metricData?.request_series??[]).map(row=>({...row,
    cached_tokens:row.cached_tokens??row.cached_input_tokens,estimated_cost:row.estimated_cost??row.estimated_versioned_price}));
  const eventItems=events.data?.items??[];const requestItems=requests.data?.items??[];
  const modelIds=run.model_ids??stringList(config.models??config.model_ids);
  return <main className="probe-page probe-detail-page">
    <header className="probe-detail-heading"><Link to="/reliability/probes" className="probe-back">{uiText("← 探测任务")}</Link><div className="probe-detail-title"><div><span className={`probe-status ${String(run.status).toLowerCase()}`}>{uiLabel(STATUS_LABEL[run.status])??run.status}</span><h1>{run.name||run.task_name||uiText("国内UAT模型探测")}</h1><button className="copy-id" onClick={()=>navigator.clipboard.writeText(run.probe_run_id)} title={uiText("复制运行 ID")}>{run.probe_run_id} {uiText("· 复制")}</button></div><div className="probe-control-actions">{run.status==="RUNNING"&&<button className="secondary" onClick={()=>action.mutate("pause")}>{uiText("暂停")}</button>}{run.status==="PAUSED"&&<button onClick={()=>action.mutate("resume")}>{uiText("继续")}</button>}{["RUNNING","PAUSED","CREATED"].includes(run.status)&&<button className="danger-button" onClick={()=>action.mutate("stop")}>{uiText("停止")}</button>}<button className="secondary" onClick={()=>setShowCreate(true)}>{uiText("复制配置")}</button></div></div>
      <div className="probe-progress"><span style={{width:`${Math.min(100,planned?ran/planned*100:0)}%`}}/><b>{uiLabel(STATUS_LABEL[run.status])??run.status} {uiText("· 已运行 ")}{elapsed(ran)}{planned?` / ${elapsed(planned)}`:""}</b></div>
    </header>
    {action.error&&<ProbeState error={action.error} onRetry={()=>client.invalidateQueries({queryKey:["probe",probeRunId]})}/>} 
    <section className="probe-kpis">
      <Kpi label={uiText("运行时长")} value={`${elapsed(ran)}${planned?` / ${elapsed(planned)}`:""}`} note={run.current_interval_seconds?uiText("当前间隔 {0} 秒", {"0": run.current_interval_seconds}):undefined}/>
      <Kpi label={uiText("已发送请求")} value={summary.request_count??run.completed_count??0} note={uiText("成功 {0} · 失败 {1}", {"0": summary.success_count??run.success_count??0, "1": summary.failure_count??run.failure_count??0})}/>
      <Kpi label={uiText("自然成功率")} value={pct(summary.natural_success_rate)} note={uiText("排除UAT受控故障注入")}/>
      <Kpi label={uiText("综合成功率")} value={pct(summary.comprehensive_success_rate)} note={uiText("包含受控注入")}/>
      <Kpi label="P95" value={ms(summary.p95_ms)} note={uiText("P50 {0} · P99 {1}", {"0": ms(summary.p50_ms), "1": ms(summary.p99_ms)})}/>
      <Kpi label={uiText("Provider实际费用")} value={money(summary.actual_provider_cost)} note={summary.pending_provider_sync?uiText("{0} 条待同步", {"0": summary.pending_provider_sync}):uiText("已同步 {0} 条", {"0": summary.actual_cost_synced_count??0})}/>
    </section>
    <div className="probe-chart-grid">
      <ChartPanel title={uiText("请求与成功率趋势")} note={uiText("自然成功率排除UAT受控故障注入")}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={requestSeries}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={cnTime}/><YAxis yAxisId="count"/><YAxis yAxisId="rate" orientation="right" domain={[0,1]} tickFormatter={value=>`${value*100}%`}/><Tooltip labelFormatter={cnTime}/><Legend/><Bar yAxisId="count" dataKey="requests" name={uiText("每分钟请求数")} fill="#718855"/><Line yAxisId="rate" dataKey="natural_success_rate" name={uiText("自然成功率")} stroke="#316a78" dot={false}/><Line yAxisId="rate" dataKey="comprehensive_success_rate" name={uiText("综合成功率")} stroke="#b06b35" dot={false}/></ComposedChart></ResponsiveContainer></ChartPanel>
      <ChartPanel title={uiText("延迟趋势")} note={uiText("模型响应耗时与超时阈值")}><ResponsiveContainer width="100%" height="100%"><AreaChart data={latencySeries}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={cnTime}/><YAxis unit="ms"/><Tooltip labelFormatter={cnTime}/><Legend/><Area dataKey="p99_ms" name="P99" stroke="#a65a4c" fill="#a65a4c18"/><Area dataKey="p95_ms" name="P95" stroke="#b78335" fill="#b7833520"/><Area dataKey="p50_ms" name="P50" stroke="#4e7851" fill="#4e785128"/><ReferenceLine y={asNumber(config.timeout_seconds,30)*1000} stroke="#9b4840" strokeDasharray="5 4" label={uiText("超时阈值")}/></AreaChart></ResponsiveContainer></ChartPanel>
      <ChartPanel title={uiText("错误构成")} note={uiText("受控注入与Provider自然失败独立统计")}>{errorSeries.length?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={errorSeries} dataKey="count" nameKey="label" innerRadius="48%" outerRadius="72%" paddingAngle={2}>{errorSeries.map((_,index)=><Cell key={index} fill={COLORS[index%COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>:<div className="probe-chart-empty">{uiText("当前运行没有错误记录")}</div>}</ChartPanel>
      <ChartPanel title={uiText("模型表现对比")} note={uiText("真实持久化请求数、成功率与P95")}><ResponsiveContainer width="100%" height="100%"><BarChart data={modelSeries} layout="vertical" margin={{left:30}}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis dataKey="model_id" type="category" width={125}/><Tooltip/><Legend/><Bar dataKey="request_count" name={uiText("请求数")} fill="#6e8352"/><Bar dataKey="p95_ms" name="P95 ms" fill="#c1833e"/></BarChart></ResponsiveContainer></ChartPanel>
      <ChartPanel title={uiText("Token与费用趋势")} note={uiText("实际费用与版本化估算费用分别展示")}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={tokenSeries}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tickFormatter={cnTime}/><YAxis yAxisId="token"/><YAxis yAxisId="cost" orientation="right"/><Tooltip labelFormatter={cnTime}/><Legend/><Bar stackId="token" yAxisId="token" dataKey="input_tokens" name={uiText("输入Token")} fill="#58724f"/><Bar stackId="token" yAxisId="token" dataKey="cached_tokens" name={uiText("缓存Token")} fill="#91a779"/><Bar stackId="token" yAxisId="token" dataKey="output_tokens" name={uiText("输出Token")} fill="#c4a05f"/><Line yAxisId="cost" dataKey="actual_provider_cost" name={uiText("Provider实际费用")} stroke="#9c4d41"/><Line yAxisId="cost" dataKey="estimated_cost" name={uiText("版本化估算费用")} stroke="#496e8a" strokeDasharray="5 3"/></ComposedChart></ResponsiveContainer></ChartPanel>
      <ChartPanel title={uiText("熔断时间线")} note={uiText("点击下方事件可查看原因与关联请求")}><div className="probe-circuit-timeline">{eventItems.filter(event=>/circuit|half_open|recovered/.test(event.event_type)).length?eventItems.filter(event=>/circuit|half_open|recovered/.test(event.event_type)).map((event,index)=><article key={event.event_id||index}><i/><time>{cnTime(event.created_at)}</time><b>{uiLabel(EVENT_LABEL[event.event_type])??uiText("熔断状态变化")}</b><small>{event.reason||event.request_id||uiText("查看事件详情")}</small></article>):<div className="probe-chart-empty">{uiText("本次运行未发生熔断状态转换")}</div>}</div></ChartPanel>
    </div>
    <section className="probe-panel"><header><div><h2>{uiText("本次配置")}</h2><p>{uiText("运行开始时保存的不可变配置快照")}</p></div></header><dl className="probe-config-grid"><div><dt>{uiText("环境")}</dt><dd>{uiText("国内 UAT")}</dd></div><div><dt>{uiText("模型范围")}</dt><dd>{modelIds.join("、")||uiText("未记录")}</dd></div><div><dt>{uiText("持续时间")}</dt><dd>{planned?uiText("{0} 分钟", {"0": planned/60}):uiText("未记录")}</dd></div><div><dt>{uiText("请求间隔")}</dt><dd>{String(config.interval_seconds??run.current_interval_seconds??uiText("未记录"))} {uiText("秒")}</dd></div><div><dt>{uiText("最大并发")}</dt><dd>{String(config.max_concurrency??run.current_concurrency??uiText("未记录"))}</dd></div><div><dt>{uiText("响应方式")}</dt><dd>{config.stream?uiText("流式"):uiText("非流式")}</dd></div><div><dt>{uiText("单请求超时")}</dt><dd>{String(config.timeout_seconds??uiText("未记录"))} {uiText("秒")}</dd></div><div><dt>{uiText("最大输出Token")}</dt><dd>{String(config.max_tokens??uiText("未记录"))}</dd></div><div><dt>{uiText("停止条件")}</dt><dd>{uiText("连续失败、成功率、429、5xx、P95及费用阈值")}</dd></div><div><dt>{uiText("故障注入")}</dt><dd>{config.fault_injection_enabled?<><strong className="probe-injected">{uiText("UAT受控故障注入")}</strong><small>{uiText("不代表Provider自然故障")}</small></>:uiText("未启用")}</dd></div></dl></section>
    <section className="probe-panel"><header><div><h2>{uiText("控制事件")}</h2><p>{uiText("北京时间（UTC+8） · 英文事件码仅在技术详情展示")}</p></div></header>{eventItems.length?<div className="probe-table-wrap"><table className="probe-table"><thead><tr><th>{uiText("时间")}</th><th>{uiText("事件")}</th><th>{uiText("影响模型")}</th><th>{uiText("原因")}</th><th>{uiText("触发指标")}</th><th>{uiText("处理结果")}</th><th>{uiText("关联请求")}</th></tr></thead><tbody>{eventItems.slice().reverse().map((event,index)=><ProbeEventRow event={event} key={event.event_id||index}/>)}</tbody></table></div>:<div className="probe-inline-empty">{uiText("暂无控制事件")}</div>}</section>
    <section className="probe-panel"><header><div><h2>{uiText("最近请求")}</h2><p>{uiText("仅统计当前运行 ID，探测流量不会污染业务指标")}</p></div></header>{requestItems.length?<div className="probe-table-wrap"><table className="probe-table"><thead><tr><th>{uiText("时间")}</th><th>{uiText("请求 ID")}</th><th>{uiText("模型")}</th><th>{uiText("状态")}</th><th>{uiText("耗时")}</th><th>{uiText("Token")}</th><th>{uiText("费用")}</th><th>{uiText("错误来源")}</th></tr></thead><tbody>{requestItems.slice(0,30).map((row,index)=>{const actualCost=row.actual_provider_cost??row.actual_cost;const estimatedCost=row.estimated_versioned_price??row.estimated_cost;const source=row.error_source??row.fault_source??"";return <tr key={row.local_request_id||row.request_id||index}><td>{cnTime(row.occurred_at)}</td><td><code>{row.request_id||row.local_request_id||uiText("未记录")}</code></td><td>{row.actual_model||row.requested_model||row.model_id||uiText("未记录")}</td><td>{row.success?uiText("成功"):row.status||uiText("失败")}</td><td>{ms(row.latency_ms)}</td><td>{asNumber(row.input_tokens)+asNumber(row.cached_input_tokens??row.cached_tokens)+asNumber(row.output_tokens)}</td><td>{actualCost?`¥${actualCost}`:estimatedCost?uiText("估算 ¥{0}", {"0": estimatedCost}):uiText("待 Provider 日志同步")}</td><td>{uiLabel(SOURCE_LABEL[source])??row.error_category??uiText("无")}</td></tr>;})}</tbody></table></div>:<div className="probe-inline-empty">{uiText("尚未产生请求")}</div>}</section>
    <details className="probe-technical"><summary>{uiText("技术详情")}</summary><pre>{JSON.stringify({probe_run_id:run.probe_run_id,status:run.status,audit_id:run.audit_id,configuration:config,freshness:metrics.data?.freshness??null,raw_event_codes:eventItems.map(item=>item.event_type)},null,2)}</pre></details>
    <CreateProbeDrawer open={showCreate} onClose={()=>setShowCreate(false)} seed={{name:`${run.name||run.task_name||"探测任务"} - 副本`,endpoint:String(config.endpoint??"/v1/chat/completions"),method:String(config.method??"POST"),models:modelIds,stream:Boolean(config.stream),prompt:String(config.prompt??"请只回答：OK"),duration:String(planned||300),interval:String(config.interval_seconds??5),concurrency:String(config.max_concurrency??1),timeout:String(config.timeout_seconds??30),maxTokens:String(config.max_tokens??16)}}/>
  </main>;
}

function ProbeEventRow({event}:{event:ProbeEvent}){
  useLocale();
  const details=event.details??(typeof event.details_json==="object"?event.details_json:{});
  return <tr><td>{cnTime(event.created_at)}</td><td><b>{uiLabel(EVENT_LABEL[event.event_type])??uiText("运行事件")}</b><small className="probe-source">{uiLabel(SOURCE_LABEL[event.source_type??""])??uiText("本地控制事件")}</small></td><td>{event.model_id??String(details?.model_id??uiText("全部"))}</td><td>{event.reason??String(details?.reason??uiText("未记录"))}</td><td>{event.trigger_metric??String(details?.trigger_metric??"—")}</td><td>{event.result??String(details?.result??uiText("已记录"))}</td><td>{event.request_id?<code>{event.request_id}</code>:"—"}</td></tr>;
}
