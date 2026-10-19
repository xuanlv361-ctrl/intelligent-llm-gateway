import {getLocale,localeTags,translate as uiText} from "../i18n/index";
import {useEffect,useMemo,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {api,CapabilityEvidenceStatus,CapabilityKey,ModelCapabilitiesOverview,ModelCapabilityItem,ModelMappingItem} from '../services/api';

const uiLabel=(source:string|undefined)=>source===undefined?undefined:uiText(source);

const environmentId='china_uat';
const statusLabel:Record<CapabilityEvidenceStatus,string>={confirmed:'已确认',observed:'已观察',pending:'待确认',unsupported:'不支持'};
const capabilityLabel:Record<CapabilityKey,string>={text:'文本',image_understanding:'图片理解',image_generation:'图片生成',audio_input:'音频输入',audio_output:'音频输出',video_input:'视频输入',video_generation:'视频生成',streaming:'流式',tools:'工具调用'};
const sourceLabel:Record<string,string>={official_catalog:'官方目录',catalog:'官方目录',historical_uat_csv:'历史UAT日志',historical_uat_log:'历史UAT日志',historical_log:'历史UAT日志',realtime_execution:'实时执行',manual_review:'人工审核',explicit_evidence:'显式能力证据',none:'尚无证据'};
const evidenceLabel:Record<string,string>={exact:'精确映射',realtime_linked:'实时关联',historical_observation:'历史观察',pending:'待确认'};
const PAGE_SIZE=20;

const fmtTime=(value:string|null|undefined)=>value?new Intl.DateTimeFormat(localeTags[getLocale()],{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):uiText('未记录');
const fmtPct=(value:number|null|undefined)=>value==null?'—':`${(value*100).toFixed(1)}%`;
const fmtMs=(value:number|null|undefined)=>value==null?'—':value<1000?`${Math.round(value)} ms`:`${(value/1000).toFixed(2)} s`;
const fmtNumber=(value:number|null|undefined)=>value==null?'—':value.toLocaleString(localeTags[getLocale()]);

function StatusPill({status}:{status:CapabilityEvidenceStatus}){
  return <span className={`cap-status ${status}`}>{uiLabel(statusLabel[status])}</span>;
}
function CapabilityPill({model,keys,label}:{model:ModelCapabilityItem;keys:CapabilityKey[];label:string}){
  const cells=keys.map(key=>model.capabilities[key]).filter(Boolean);
  const status:CapabilityEvidenceStatus=cells.some(x=>x.status==='confirmed')?'confirmed':cells.some(x=>x.status==='observed')?'observed':cells.some(x=>x.status==='unsupported')&&cells.every(x=>x.status==='unsupported')?'unsupported':'pending';
  return <span title={`${uiText(label)}：${uiLabel(statusLabel[status])}`} className={`cap-cell ${status}`}><i aria-hidden="true"/>{uiLabel(statusLabel[status])}</span>;
}
function EmptyChart({children}:{children:string}){return <div className="cap-chart-empty">{children}</div>}

function ModelDrawer({model,onClose}:{model:ModelCapabilityItem;onClose:()=>void}){
  const detail=useQuery({queryKey:['model-capability-detail',model.model_id],queryFn:({signal})=>api.modelCapabilityDetail(model.model_id,environmentId,signal),initialData:model});
  const item=detail.data||model;
  return <div className="cap-drawer-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <aside className="cap-drawer" role="dialog" aria-modal="true" aria-label={uiText("{0}能力详情", {"0": item.display_name||item.model_id})}>
      <header><div><span className="cap-eyebrow">{uiText("模型证据详情")}</span><h2>{item.display_name||item.model_id}</h2><p><code>{item.model_id}</code> · {item.provider||uiText("Provider待确认")}</p></div><button className="secondary" onClick={onClose} aria-label={uiText("关闭详情")}>{uiText("关闭")}</button></header>
      <section><h3>{uiText("基本信息")}</h3><dl className="cap-facts"><div><dt>{uiText("可用端点")}</dt><dd>{item.endpoints.join('、')||uiText("未记录")}</dd></div><div><dt>{uiText("上下文上限")}</dt><dd>{fmtNumber(item.context_limit)}</dd></div><div><dt>{uiText("计费类型")}</dt><dd>{item.pricing_type||uiText("待确认")}</dd></div><div><dt>{uiText("目录更新时间")}</dt><dd>{fmtTime(item.catalog_updated_at)}</dd></div></dl></section>
      <section><h3>{uiText("能力证据")}</h3><div className="cap-evidence-list">{Object.entries(item.capabilities).map(([key,cell])=><article key={key}><div><b>{uiLabel(capabilityLabel[key as CapabilityKey])||key}</b><StatusPill status={cell.status}/></div><p>{uiText("证据 ")}{cell.evidence_count} {uiText("· 样本 ")}{cell.sample_count} {uiText("· 成功 ")}{cell.success_count??uiText("未记录")} {uiText("· 失败 ")}{cell.failure_count??uiText("未记录")}</p><small>{uiText("来源：")}{cell.sources?.map(x=>uiLabel(sourceLabel[x])||x).join('、')||uiText("尚无证据")} {uiText("· 最近成功：")}{fmtTime(cell.last_success_at)}</small></article>)}</div></section>
      <section><h3>{uiText("真实调用摘要")}</h3><dl className="cap-facts"><div><dt>{uiText("调用次数")}</dt><dd>{fmtNumber(item.call_summary.call_count)}</dd></div><div><dt>{uiText("成功率")}</dt><dd>{fmtPct(item.call_summary.success_rate)}</dd></div><div><dt>{uiText("流式 / 非流式")}</dt><dd>{item.call_summary.stream_count} / {item.call_summary.non_stream_count}</dd></div><div><dt>{uiText("P50 / P95")}</dt><dd>{fmtMs(item.call_summary.p50_ms)} / {fmtMs(item.call_summary.p95_ms)}</dd></div><div><dt>{uiText("输入 / 输出Token")}</dt><dd>{fmtNumber(item.call_summary.input_tokens)} / {fmtNumber(item.call_summary.output_tokens)}</dd></div><div><dt>{uiText("Provider实际费用")}</dt><dd>{item.call_summary.actual_cost==null?uiText("待Provider日志同步"):`¥${item.call_summary.actual_cost.toFixed(6)}`}</dd></div><div><dt>{uiText("最近Request ID")}</dt><dd><code>{item.call_summary.last_request_id||'未记录'}</code></dd></div></dl></section>
      <section><h3>{uiText("限制与冲突")}</h3>{item.limitations.length?<ul>{item.limitations.map(value=><li key={value}>{value}</li>)}</ul>:<p className="cap-quiet">{uiText("当前没有已记录的能力冲突。")}</p>}</section>
      <details className="cap-technical"><summary>{uiText("技术详情")}</summary><pre>{JSON.stringify(item.technical_metadata,null,2)}</pre></details>
    </aside>
  </div>;
}

function CapabilityMatrix({data}:{data:ModelCapabilitiesOverview}){
  const [search,setSearch]=useState('');
  const [provider,setProvider]=useState('all');
  const [status,setStatus]=useState('all');
  const [source,setSource]=useState('all');
  const [hasCalls,setHasCalls]=useState(false);
  const [sort,setSort]=useState<'calls'|'recent'|'model'>('calls');
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<ModelCapabilityItem|null>(null);
  const providers=useMemo(()=>Array.from(new Set(data.models.map(item=>item.provider).filter(Boolean) as string[])).sort(),[data.models]);
  const filtered=useMemo(()=>{
    const result=data.models.filter(item=>(!search||`${item.model_id} ${item.display_name}`.toLowerCase().includes(search.toLowerCase()))&&(provider==='all'||item.provider===provider)&&(status==='all'||item.evidence_summary.status===status)&&(source==='all'||item.evidence_summary.sources.includes(source))&&(!hasCalls||item.call_summary.call_count>0));
    return result.sort((a,b)=>sort==='model'?a.model_id.localeCompare(b.model_id):sort==='recent'?Date.parse(b.call_summary.last_called_at||'')-Date.parse(a.call_summary.last_called_at||''):b.call_summary.call_count-a.call_summary.call_count);
  },[data.models,search,provider,status,source,hasCalls,sort]);
  useEffect(()=>setPage(1),[search,provider,status,source,hasCalls,sort]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const items=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const clear=()=>{setSearch('');setProvider('all');setStatus('all');setSource('all');setHasCalls(false);};
  return <>
    <div className="cap-chart-grid">
      <section className="cap-panel"><header><div><h2>{uiText("能力覆盖分布")}</h2><p>{uiText("未发现证据不会被误判为“不支持”。")}</p></div></header>{data.capability_coverage.length?<div className="cap-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.capability_coverage} layout="vertical" margin={{left:18,right:12}}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="capability" width={76} tickFormatter={value=>uiLabel(capabilityLabel[value as CapabilityKey])||String(value)}/><Tooltip labelFormatter={value=>uiLabel(capabilityLabel[value as CapabilityKey])||String(value)}/><Legend/><Bar stackId="s" dataKey="confirmed" name={uiText("已确认")} fill="#547a42"/><Bar stackId="s" dataKey="observed" name={uiText("已观察")} fill="#547ba0"/><Bar stackId="s" dataKey="pending" name={uiText("待确认")} fill="#d39a35"/><Bar stackId="s" dataKey="unsupported" name={uiText("不支持")} fill="#aeb4aa"/></BarChart></ResponsiveContainer></div>:<EmptyChart>{uiText("尚无可聚合的能力证据。")}</EmptyChart>}</section>
      <section className="cap-panel"><header><div><h2>{uiText("证据来源分布")}</h2><p>{uiText("目录、历史与实时证据分开计数。")}</p></div></header>{data.evidence_sources.length?<div className="cap-source-bars">{data.evidence_sources.map(item=>{const max=Math.max(...data.evidence_sources.map(x=>x.count),1);return <div key={item.source}><span>{uiLabel(sourceLabel[item.source])||item.source}</span><i><b style={{width:`${item.count/max*100}%`}}/></i><strong>{item.count}</strong></div>})}</div>:<EmptyChart>{uiText("当前没有能力证据来源。")}</EmptyChart>}</section>
    </div>
    <section className="cap-panel cap-model-section"><header><div><h2>{uiText("模型能力")}</h2><p>{uiText("共匹配 ")}{filtered.length} {uiText("个目录或真实调用模型。")}</p></div></header>
      <div className="cap-filters"><input aria-label={uiText("搜索模型")} value={search} onChange={e=>setSearch(e.target.value)} placeholder={uiText("搜索模型ID或名称")}/><select aria-label={uiText("Provider")} value={provider} onChange={e=>setProvider(e.target.value)}><option value="all">{uiText("全部Provider")}</option>{providers.map(value=><option key={value}>{value}</option>)}</select><select aria-label={uiText("能力状态")} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{uiText("全部状态")}</option>{Object.entries(statusLabel).map(([id,label])=><option value={id} key={id}>{uiText(label)}</option>)}</select><select aria-label={uiText("证据来源")} value={source} onChange={e=>setSource(e.target.value)}><option value="all">{uiText("全部证据来源")}</option>{data.evidence_sources.map(item=><option key={item.source} value={item.source}>{uiLabel(sourceLabel[item.source])||item.source}</option>)}</select><select aria-label={uiText("排序")} value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="calls">{uiText("调用数优先")}</option><option value="recent">{uiText("最近调用优先")}</option><option value="model">{uiText("模型名称")}</option></select><label className="cap-check"><input type="checkbox" checked={hasCalls} onChange={e=>setHasCalls(e.target.checked)}/>{uiText("仅有真实调用")}</label><button className="secondary" onClick={clear}>{uiText("清空筛选")}</button></div>
      <div className="cap-desktop-table"><table><thead><tr><th>{uiText("模型")}</th><th>{uiText("Provider")}</th><th>{uiText("文本")}</th><th>{uiText("图片")}</th><th>{uiText("音频")}</th><th>{uiText("视频")}</th><th>{uiText("流式")}</th><th>{uiText("工具")}</th><th>{uiText("上下文")}</th><th>{uiText("调用样本")}</th><th>{uiText("最近验证")}</th><th>{uiText("状态")}</th><th>{uiText("操作")}</th></tr></thead><tbody>{items.map(item=><tr key={item.model_id}><td><b>{item.display_name||item.model_id}</b><small>{item.model_id}</small></td><td>{item.provider||uiText("待确认")}</td><td><CapabilityPill model={item} keys={['text']} label={uiText("文本")}/></td><td><CapabilityPill model={item} keys={['image_understanding','image_generation']} label={uiText("图片")}/></td><td><CapabilityPill model={item} keys={['audio_input','audio_output']} label={uiText("音频")}/></td><td><CapabilityPill model={item} keys={['video_input','video_generation']} label={uiText("视频")}/></td><td><CapabilityPill model={item} keys={['streaming']} label={uiText("流式")}/></td><td><CapabilityPill model={item} keys={['tools']} label={uiText("工具调用")}/></td><td>{fmtNumber(item.context_limit)}</td><td>{item.call_summary.call_count}</td><td>{fmtTime(item.evidence_summary.last_verified_at)}</td><td><StatusPill status={item.evidence_summary.status}/></td><td><button className="link-button" onClick={()=>setSelected(item)}>{uiText("查看详情")}</button></td></tr>)}</tbody></table></div>
      <div className="cap-mobile-cards">{items.map(item=><article key={item.model_id}><header><div><b>{item.display_name||item.model_id}</b><small>{item.model_id}</small></div><StatusPill status={item.evidence_summary.status}/></header><p>{item.provider||uiText("Provider待确认")} {uiText("· 调用 ")}{item.call_summary.call_count} {uiText("· 成功率 ")}{fmtPct(item.call_summary.success_rate)}</p><div><CapabilityPill model={item} keys={['text']} label={uiText("文本")}/><CapabilityPill model={item} keys={['image_understanding','image_generation']} label={uiText("图片")}/><CapabilityPill model={item} keys={['audio_input','audio_output']} label={uiText("音频")}/><CapabilityPill model={item} keys={['video_input','video_generation']} label={uiText("视频")}/></div><button className="secondary" onClick={()=>setSelected(item)}>{uiText("查看能力证据")}</button></article>)}</div>
      {!items.length&&<div className="cap-inline-empty">{uiText("没有符合当前筛选条件的模型。")}</div>}
      <footer className="cap-pagination"><span>{uiText("第 ")}{page} / {pages} {uiText("页")}</span><button className="secondary" disabled={page<=1} onClick={()=>setPage(x=>x-1)}>{uiText("上一页")}</button><button className="secondary" disabled={page>=pages} onClick={()=>setPage(x=>x+1)}>{uiText("下一页")}</button></footer>
    </section>
    {selected&&<ModelDrawer model={selected} onClose={()=>setSelected(null)}/>} 
  </>;
}

function MappingTab(){
  const query=useQuery({queryKey:['model-mappings',environmentId],queryFn:({signal})=>api.modelMappings(environmentId,signal),refetchInterval:30000});
  const [search,setSearch]=useState('');
  if(query.isLoading)return <div className="state loading">{uiText("正在读取真实模型映射…")}</div>;
  if(query.error||!query.data)return <div className="state error" role="alert"><b>{uiText("模型映射读取失败")}</b><span>{uiText("能力矩阵数据仍然可用，可稍后重试映射读取。")}</span><button onClick={()=>query.refetch()}>{uiText("重新读取")}</button></div>;
  const data=query.data;
  const items=data.items.filter(item=>!search||`${item.requested_model} ${item.billed_model} ${item.actual_model}`.toLowerCase().includes(search.toLowerCase()));
  const chartData=Array.isArray(data.consistency_distribution)?data.consistency_distribution:Object.entries(data.consistency_distribution).map(([status,count])=>({status,count}));
  return <><section className="cap-panel cap-mapping-chart"><header><div><h2>{uiText("映射一致性")}</h2><p>{uiText("缺少实际模型会保留为空，不自动复制请求模型。")}</p></div><input aria-label={uiText("搜索映射")} value={search} onChange={e=>setSearch(e.target.value)} placeholder={uiText("搜索请求、计费或实际模型")}/></header>{chartData.length?<div className="cap-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="status" tickFormatter={value=>(uiLabel({consistent:'完全一致',requested_billed_mismatch:'请求与计费不同',billed_actual_mismatch:'计费与实际不同',missing_actual:'实际模型缺失'}[String(value)])||String(value))}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="count" name={uiText("映射记录")} fill="#657c42" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div>:<EmptyChart>{uiText("尚无可统计的映射组合。")}</EmptyChart>}</section>
    <section className="cap-panel"><header><div><h2>{uiText("请求 → 计费 → 实际模型")}</h2><p>{data.items.length} {uiText("组真实映射观察。")}</p></div></header><div className="cap-desktop-table mapping"><table><thead><tr><th>{uiText("请求模型")}</th><th>{uiText("计费模型")}</th><th>{uiText("实际模型")}</th><th>{uiText("调用次数")}</th><th>{uiText("一致率")}</th><th>{uiText("不一致")}</th><th>{uiText("最近观察")}</th><th>{uiText("证据等级")}</th><th>{uiText("来源")}</th></tr></thead><tbody>{items.map((item:ModelMappingItem,index)=><tr key={`${item.requested_model}-${item.billed_model}-${item.actual_model}-${index}`}><td>{item.requested_model||uiText("待确认")}</td><td>{item.billed_model||uiText("待确认")}</td><td>{item.actual_model||<span className="cap-missing">{uiText("实际模型待确认")}</span>}</td><td>{item.call_count}</td><td>{fmtPct(item.consistency_rate)}</td><td>{item.mismatch_count}</td><td>{fmtTime(item.last_observed)}</td><td><span className={`mapping-level ${item.evidence_level}`}>{uiLabel(evidenceLabel[item.evidence_level])||item.evidence_level}</span></td><td>{uiLabel(sourceLabel[item.source])||item.source}</td></tr>)}</tbody></table></div>
      <div className="cap-mobile-cards mapping">{items.map((item,index)=><article key={`${item.requested_model}-${index}`}><header><b>{item.requested_model||uiText("请求模型待确认")}</b><span className={`mapping-level ${item.evidence_level}`}>{uiLabel(evidenceLabel[item.evidence_level])||item.evidence_level}</span></header><p>{uiText("计费：")}{item.billed_model||uiText("待确认")}</p><p>{uiText("实际：")}{item.actual_model||uiText("实际模型待确认")}</p><small>{uiText("调用 ")}{item.call_count} {uiText("· 一致率 ")}{fmtPct(item.consistency_rate)} · {fmtTime(item.last_observed)}</small></article>)}</div>
      {!items.length&&<div className="cap-inline-empty">{uiText("没有符合当前搜索条件的映射。")}</div>}
    </section><details className="cap-technical"><summary>{uiText("技术详情")}</summary><pre>{JSON.stringify(data.technical_metadata,null,2)}</pre></details></>;
}

export default function ModelCapabilityMatrixPage(){
  const qc=useQueryClient();
  const [tab,setTab]=useState<'capabilities'|'mappings'>('capabilities');
  const query=useQuery({queryKey:['model-capabilities',environmentId],queryFn:({signal})=>api.modelCapabilitiesOverview(environmentId,signal),refetchInterval:30000});
  const ensure=useMutation({mutationFn:()=>api.ensureModelCapabilities(environmentId),onSuccess:()=>qc.invalidateQueries({queryKey:['model-capabilities']})});
  useEffect(()=>{ensure.mutate();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  if(query.isLoading)return <main className="cap-page"><div className="state loading">{uiText("正在聚合真实模型目录与调用证据…")}</div></main>;
  if(query.error||!query.data)return <main className="cap-page"><div className="state error" role="alert"><b>{uiText("真实模型能力数据读取失败")}</b><span>{query.error instanceof Error?query.error.message:uiText("后端未返回可用数据。")}</span><button onClick={()=>query.refetch()}>{uiText("重新读取")}</button></div></main>;
  const raw=query.data as Partial<ModelCapabilitiesOverview>;
  const data:ModelCapabilitiesOverview={
    status:raw.status||'rebuilding',update_status:raw.update_status||'delayed',environment_id:raw.environment_id||environmentId,
    catalog_status:raw.catalog_status||'pending',catalog_model_count:raw.catalog_model_count||0,call_evidence_model_count:raw.call_evidence_model_count||0,
    confirmed_model_count:raw.confirmed_model_count||0,observed_model_count:raw.observed_model_count||0,pending_model_count:raw.pending_model_count||0,
    unsupported_model_count:raw.unsupported_model_count||0,mapping_count:raw.mapping_count||0,recent_24h_calls:raw.recent_24h_calls||0,
    historical_log_count:raw.historical_log_count||0,realtime_log_count:raw.realtime_log_count||0,evidence_count:raw.evidence_count||0,
    last_sync_at:raw.last_sync_at||null,last_aggregated_at:raw.last_aggregated_at||null,models:Array.isArray(raw.models)?raw.models.filter(item=>item&&item.model_id&&item.capabilities):[],
    capability_coverage:Array.isArray(raw.capability_coverage)?raw.capability_coverage:[],evidence_sources:Array.isArray(raw.evidence_sources)?raw.evidence_sources:[],
    technical_metadata:raw.technical_metadata||{},
  };
  const updateStatus=typeof data.update_status==='string'?data.update_status:data.update_status?.status||'delayed';
  const inconsistent=data.catalog_model_count>0&&data.models.length===0;
  return <main className="cap-page">
    <header className="cap-heading"><div><span className="cap-eyebrow">{uiText("MODEL EVIDENCE")}</span><h1>{uiText("模型能力与映射")}</h1><p>{uiText("根据真实模型目录、历史日志、实时调用和审核证据展示模型能力及请求模型到实际模型的关系。")}</p></div><div className="cap-update"><span className={`cap-live-dot ${updateStatus}`}/><b>{ensure.isPending?uiText("正在自动聚合"):updateStatus==='ready'?uiText("自动更新正常"):uiText("数据更新稍有延迟")}</b><small>{uiText("日志同步 ")}{fmtTime(data.last_sync_at)} {uiText("· 能力聚合 ")}{fmtTime(data.last_aggregated_at)}</small><button className="secondary" disabled={ensure.isPending} onClick={()=>ensure.mutate()}>{ensure.isPending?uiText("聚合中…"):uiText("立即刷新")}</button></div></header>
    <nav className="cap-evidence-rail" aria-label={uiText("证据处理流程")}><span className={data.catalog_model_count?'done':''}><i>1</i><b>{uiText("目录")}</b><small>{data.catalog_model_count} {uiText("个模型")}</small></span><em>→</em><span className={data.call_evidence_model_count?'done':''}><i>2</i><b>{uiText("调用 ")}</b><small>{data.call_evidence_model_count} {uiText("个模型有证据")}</small></span><em>→</em><span className={data.evidence_count?'done':''}><i>3</i><b>{uiText("证据 ")}</b><small>{data.evidence_count} {uiText("项")}</small></span><em>→</em><span className={data.mapping_count?'done':''}><i>4</i><b>{uiText("映射")}</b><small>{data.mapping_count} {uiText("组")}</small></span></nav>
    <section className="cap-kpis"><article><span>{uiText("目录模型")}</span><strong>{data.catalog_model_count}</strong><small>{uiText("真实UAT目录")}</small></article><article><span>{uiText("有调用证据模型")}</span><strong>{data.call_evidence_model_count}</strong><small>{uiText("历史与实时日志")}</small></article><article><span>{uiText("已确认能力模型")}</span><strong>{data.confirmed_model_count}</strong><small>{uiText("目录或审核证据")}</small></article><article><span>{uiText("待确认模型")}</span><strong>{data.pending_model_count}</strong><small>{uiText("不等于不支持")}</small></article><article><span>{uiText("映射组合")}</span><strong>{data.mapping_count}</strong><small>{uiText("请求→计费→实际")}</small></article><article><span>{uiText("近24小时调用")}</span><strong>{data.recent_24h_calls}</strong><small>{uiText("业务流量")}</small></article></section>
    <h2 className="sr-only">{uiText("模型映射")}</h2><div className="cap-tabs" role="tablist"><button role="tab" aria-selected={tab==='capabilities'} className={tab==='capabilities'?'active':''} onClick={()=>setTab('capabilities')}>{uiText("能力矩阵")}</button><button role="tab" aria-selected={tab==='mappings'} className={tab==='mappings'?'active':''} onClick={()=>setTab('mappings')}>{uiText("模型映射")}</button></div>
    {inconsistent&&<div className="cap-warning"><b>{uiText("能力聚合异常")}</b><span>{uiText("已读取 ")}{data.catalog_model_count} {uiText("个模型、")}{data.historical_log_count} {uiText("条历史日志和 ")}{data.realtime_log_count} {uiText("条实时日志，但没有生成模型能力。系统正在自动重建证据，无需人工确认。")}</span><button onClick={()=>ensure.mutate()} disabled={ensure.isPending}>{uiText("重新聚合")}</button></div>}
    {tab==='capabilities'?<CapabilityMatrix data={data}/>:<MappingTab/>}
    <details className="cap-technical"><summary>{uiText("技术详情")}</summary><div><span>{uiText("环境")}</span><code>{data.environment_id}</code><span>{uiText("目录状态")}</span><code>{data.catalog_status}</code><span>{uiText("历史日志")}</span><code>{data.historical_log_count}</code><span>{uiText("实时日志")}</span><code>{data.realtime_log_count}</code><span>{uiText("Mock / Demo")}</span><code>0</code></div><pre>{JSON.stringify(data.technical_metadata,null,2)}</pre></details>
  </main>;
}
