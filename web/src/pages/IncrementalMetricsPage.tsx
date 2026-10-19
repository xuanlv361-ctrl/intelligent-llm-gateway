import {getLocale,localeTags,translate as uiText} from "../i18n/index";
import {useEffect,useMemo,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {Bar,BarChart,CartesianGrid,ComposedChart,Legend,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {api,DynamicMetricModel,EnvironmentFilter,MetricWindow} from "../services/api";

const uiLabel=(source:string|undefined)=>source===undefined?undefined:uiText(source);

const windows:Array<{id:MetricWindow;label:string}>=[{id:"5m",label:"最近5分钟"},{id:"1h",label:"最近1小时"},{id:"24h",label:"最近24小时"}];
const stateText:Record<string,string>={healthy:"可用于调度",stale:"数据已过期",insufficient_sample:"样本不足",blocked:"不参与调度",unknown:"待确认"};
const fmtTime=(value:string|null)=>value?new Intl.DateTimeFormat(localeTags[getLocale()],{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(value)):uiText("未记录");
const fmtPct=(value:number|null)=>value===null?"—":`${(value*100).toFixed(1)}%`;
const fmtMs=(value:number|null)=>value===null?"—":value<1000?`${value.toFixed(0)} ms`:`${(value/1000).toFixed(2)} s`;
const fmtCost=(value:number|null)=>value===null?uiText("待 Provider 日志同步"):`¥${value.toFixed(6)}`;
const tick=(value:string)=>new Intl.DateTimeFormat(localeTags[getLocale()],{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit"}).format(new Date(value));

function Kpi({label,value,note}:{label:string;value:string;note:string}){
  return <article className="dm-kpi"><span>{uiText(label)}</span><strong>{value}</strong><small>{uiText(note)}</small></article>;
}
function ChartPanel({title,note,children}:{title:string;note:string;children:React.ReactNode}){
  return <section className="dm-panel"><header><div><h2>{uiText(title)}</h2><p>{uiText(note)}</p></div></header><div className="dm-chart">{children}</div></section>;
}

export default function IncrementalMetricsPage({environment}:{environment:EnvironmentFilter}){
  const qc=useQueryClient();
  const [window,setWindow]=useState<MetricWindow>("24h");
  const [traffic,setTraffic]=useState("business");
  const [search,setSearch]=useState("");
  const [state,setState]=useState("all");
  const [sort,setSort]=useState("requests");
  const query=useQuery({
    queryKey:["dynamic-metrics",window,environment,traffic],
    queryFn:({signal})=>api.dynamicMetricsOverview(window,environment,traffic,signal),
    refetchInterval:15000,
  });
  const ensure=useMutation({mutationFn:api.ensureDynamicMetrics,onSuccess:()=>qc.invalidateQueries({queryKey:["dynamic-metrics"]})});
  useEffect(()=>{ensure.mutate();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const models=useMemo(()=>{
    const items=[...(query.data?.model_metrics||[])].filter(item=>item.model.toLowerCase().includes(search.toLowerCase())&&(state==="all"||item.status===state));
    items.sort((a,b)=>sort==="p95"?(b.p95_ms||0)-(a.p95_ms||0):sort==="success"?b.success_rate-a.success_rate:b.request_count-a.request_count);
    return items;
  },[query.data,search,state,sort]);
  if(query.isLoading)return <main className="dm-page"><div className="state loading">{uiText("正在读取真实动态指标…")}</div></main>;
  if(query.error||!query.data)return <main className="dm-page"><div className="state error"><b>{uiText("动态指标读取失败")}</b><span>{uiText("统一调用日志未受影响，请稍后重试。")}</span><button onClick={()=>query.refetch()}>{uiText("重新读取")}</button></div></main>;
  const data=query.data,k=data.kpis;
  const noData=k.request_count===0;
  return <main className="dm-page">
    <header className="dm-heading">
      <div><span className="eyebrow">{uiText("SCHEDULER SIGNALS")}</span><h1>{uiText("动态指标")}</h1><p>{uiText("把统一调用日志聚合成 Scheduler 可直接使用的滚动窗口证据。")}</p></div>
      <button className="primary" disabled={ensure.isPending} onClick={()=>ensure.mutate()}>{ensure.isPending?uiText("正在聚合…"):uiText("立即刷新")}</button>
    </header>

    <section className="dm-status" aria-label={uiText("自动更新状态")}>
      <span className={`dm-pulse ${data.update_status.status==="ready"?"ok":"delay"}`}/>
      <b>{uiText("自动更新：")}{data.update_status.status==="ready"?uiText("正常"):data.update_status.status==="running"?uiText("同步中"):uiText("数据更新稍有延迟")}</b>
      <span>{uiText("最近聚合 ")}{fmtTime(data.update_status.last_aggregated_at)} {uiText("UTC+8")}</span>
      <span>{uiText("日志水位 ")}{fmtTime(data.update_status.source_watermark)}</span>
      <span>{uiText("下次检查 ")}{fmtTime(data.update_status.next_refresh_at)}</span>
    </section>

    <div className="dm-controls">
      <div className="dm-segment">{windows.map(item=><button key={item.id} className={window===item.id?"active":""} onClick={()=>setWindow(item.id)}>{uiText(item.label)}</button>)}</div>
      <div className="dm-segment" aria-label={uiText("流量类型")}>{[["business","业务"],["probe","探测"],["all","全部"]].map(([id,label])=><button key={id} className={traffic===id?"active":""} onClick={()=>setTraffic(id)}>{uiText(label)}</button>)}</div>
    </div>

    <section className="dm-kpis">
      <Kpi label={uiText("请求数")} value={String(k.request_count)} note={`${window} · ${uiText(traffic==="business"?"业务流量":traffic==="probe"?"探测流量":"全部流量")}`}/>
      <Kpi label={uiText("成功率")} value={fmtPct(k.success_rate)} note={uiText("失败按真实状态分类")}/>
      <Kpi label={uiText("P95 延迟")} value={fmtMs(k.p95_ms)} note={uiText("P50 {0} · P99 {1}", {"0": fmtMs(k.p50_ms), "1": fmtMs(k.p99_ms)})}/>
      <Kpi label={uiText("总 Token")} value={k.total_tokens.toLocaleString()} note={uiText("输入 + 缓存 + 输出")}/>
      <Kpi label={uiText("可观测费用")} value={fmtCost(k.actual_cost)} note={k.pending_cost_count?uiText("{0} 条待同步费用", {"0": k.pending_cost_count}):uiText("Provider 实际费用")}/>
      <Kpi label={uiText("可用于调度模型")} value={String(k.eligible_model_count)} note={uiText("共观测 {0} 个模型", {"0": data.model_metrics.length})}/>
    </section>

    {noData?<section className="dm-empty"><b>{uiText("当前窗口无请求")}</b><span>{uiText("已保留你的时间窗口选择。最近日志水位为 ")}{fmtTime(data.update_status.source_watermark)}{uiText("，可切换到更长窗口查看。")}</span></section>:<>
      <div className="dm-grid">
        <ChartPanel title={uiText("请求量与成功率")} note={uiText("柱状为请求数，折线为成功率")}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.request_series}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="at" tickFormatter={tick}/><YAxis yAxisId="left"/><YAxis yAxisId="right" orientation="right" domain={[0,1]} tickFormatter={v=>`${Math.round(v*100)}%`}/><Tooltip labelFormatter={v=>fmtTime(String(v))}/><Legend/><Bar yAxisId="left" dataKey="requests" name={uiText("请求数")} fill="#6e7f38" radius={[4,4,0,0]}/><Line yAxisId="right" dataKey="success_rate" name={uiText("成功率")} stroke="#d88a3d" strokeWidth={2} dot={false}/></ComposedChart></ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={uiText("延迟趋势")} note={uiText("首Token与总耗时分开统计")}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.latency_series}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="at" tickFormatter={tick}/><YAxis/><Tooltip labelFormatter={v=>fmtTime(String(v))}/><Legend/><Line dataKey="p50" name="P50" stroke="#71854a" dot={false}/><Line dataKey="p95" name="P95" stroke="#d88a3d" strokeWidth={2} dot={false}/><Line dataKey="p99" name="P99" stroke="#b95745" dot={false}/><Line dataKey="ttft_p95" name={uiText("首Token P95")} stroke="#6f7fa6" dot={false}/></ComposedChart></ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={uiText("Token 构成")} note={uiText("输入、缓存与输出 Token 分开呈现")}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={data.token_series}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="at" tickFormatter={tick}/><YAxis/><Tooltip labelFormatter={v=>fmtTime(String(v))}/><Legend/><Bar dataKey="input" name={uiText("输入")} stackId="t" fill="#6e7f38"/><Bar dataKey="cached" name={uiText("缓存")} stackId="t" fill="#a9b486"/><Bar dataKey="output" name={uiText("输出")} stackId="t" fill="#d88a3d"/></BarChart></ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title={uiText("费用可观测性")} note={uiText("实际费用、版本化估算与待同步数量严格分开")}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.cost_series}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="at" tickFormatter={tick}/><YAxis/><Tooltip labelFormatter={v=>fmtTime(String(v))}/><Legend/><Line dataKey="actual" name={uiText("Provider实际费用")} stroke="#567344" strokeWidth={2} connectNulls/><Line dataKey="estimated" name={uiText("版本化估算")} stroke="#d88a3d" connectNulls/><Bar dataKey="pending" name={uiText("待同步记录")} fill="#d8c7a2"/></ComposedChart></ResponsiveContainer>
        </ChartPanel>
      </div>

      <section className="dm-panel dm-models">
        <header><div><h2>{uiText("模型指标排行")}</h2><p>{uiText("状态、样本量和置信区间共同决定调度资格。")}</p></div><div className="dm-table-tools"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={uiText("搜索模型")}/><select value={state} onChange={e=>setState(e.target.value)}><option value="all">{uiText("全部状态")}</option><option value="healthy">{uiText("可用于调度")}</option><option value="insufficient_sample">{uiText("样本不足")}</option><option value="stale">{uiText("数据已过期")}</option></select><select value={sort} onChange={e=>setSort(e.target.value)}><option value="requests">{uiText("按请求数")}</option><option value="success">{uiText("按成功率")}</option><option value="p95">{uiText("按P95")}</option></select></div></header>
        <div className="table-wrap"><table><thead><tr><th>{uiText("模型")}</th><th>{uiText("请求数")}</th><th>{uiText("成功率")}</th><th>P95</th><th>{uiText("Token")}</th><th>{uiText("费用")}</th><th>{uiText("最近样本")}</th><th>{uiText("置信区间")}</th><th>{uiText("状态")}</th><th>{uiText("调度")}</th></tr></thead><tbody>{models.map((item:DynamicMetricModel)=><tr key={item.model}><td><b>{item.model}</b></td><td>{item.request_count}</td><td>{fmtPct(item.success_rate)}</td><td>{fmtMs(item.p95_ms)}</td><td>{item.total_tokens.toLocaleString()}</td><td>{fmtCost(item.actual_cost)}</td><td>{fmtTime(item.last_sample_at)}<small>{Math.round(item.age_seconds/60)} {uiText("分钟前")}</small></td><td>{fmtPct(item.confidence.lower)} – {fmtPct(item.confidence.upper)}<small>{uiText("样本 ")}{item.confidence.sample_size}</small></td><td><span className={`dm-state ${item.status}`}>{uiLabel(stateText[item.status])||uiText("待确认")}</span></td><td>{item.eligible?uiText("参与"):uiText("暂不参与")}</td></tr>)}</tbody></table></div>
      </section>

      <section className="dm-bottom-grid">
        <div className="dm-panel"><header><div><h2>{uiText("数据新鲜度")}</h2><p>{uiText("Scheduler 不使用过期样本。")}</p></div></header><div className="dm-freshness">{data.freshness.slice(0,10).map(item=><div key={item.model}><span>{item.model}</span><div><i style={{width:`${Math.max(3,100-Math.min(100,item.age_seconds/864))}%`}}/></div><b>{Math.round(item.age_seconds/60)} {uiText("分钟")}</b></div>)}</div></div>
        <div className="dm-panel"><header><div><h2>{uiText("快照状态")}</h2><p>{uiText("每种状态都能下钻到对应模型。")}</p></div></header><div className="dm-state-list">{[["healthy","可用于调度"],["insufficient_sample","样本不足"],["stale","数据已过期"],["blocked","已阻止"],["unknown","待确认"]].map(([id,label])=><button key={id} onClick={()=>setState(id)}><span className={`dm-dot ${id}`}/><b>{uiText(label)}</b><strong>{data.snapshot_status[id]||0}</strong></button>)}</div></div>
      </section>
    </>}

    <details className="dm-technical"><summary>{uiText("技术详情")}</summary><div className="dm-tech-grid"><span>{uiText("聚合版本")}</span><code>{data.technical_metadata.aggregation_version}</code><span>{uiText("来源契约")}</span><code>{data.technical_metadata.source_contract}</code><span>{uiText("source watermark")}</span><code>{data.technical_metadata.source_watermark||"未记录"}</code><span>{uiText("配置版本")}</span><code>{data.technical_metadata.configuration_version||"未记录"}</code><span>{uiText("指标快照")}</span><code>{data.technical_metadata.snapshot_ids.join(", ")||"当前窗口未生成"}</code><span>{uiText("数据覆盖")}</span><pre>{JSON.stringify(data.coverage,null,2)}</pre></div></details>
  </main>;
}
