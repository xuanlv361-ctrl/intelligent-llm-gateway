import {translate as uiText} from "../i18n/index";
import {useEffect,useMemo,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {ApiError,api,CollectorRunPreview,EnvironmentFilter,EnvironmentId} from "../services/api";
import {DataSourceBanner,MetricCard,TechnicalDataDrawer} from "../components/operations/OperationsUI";
import {formatSourceType,formatTimestamp} from "../lib/presentation";

const stateLabel:Record<string,string>={
 created:"已创建",launching_browser:"正在启动浏览器",awaiting_manual_login:"等待手动登录",
 login_confirmed:"等待开始读取",collecting:"正在读取日志",preview_ready:"预览待确认",
 import_confirmed:"正在完成导入",completed:"采集完成",stop_requested:"正在停止",
 stopped:"已停止",failed:"采集失败",browser_closed:"浏览器被关闭",heartbeat_lost:"采集进程失联"
};
const activeStates=new Set(["created","launching_browser","awaiting_manual_login","login_confirmed","collecting","stop_requested"]);
const errorMessages:Record<string,string>={
 collector_already_running:"当前环境或浏览器会话已有采集任务。",
 collector_log_page_unconfirmed:"当前环境的日志页尚未确认。",
 collector_log_page_not_visible:"请先在新浏览器中打开已确认的日志页。",
 collector_browser_launch_failed:"本地浏览器启动失败，请检查 Playwright Chromium 安装。",
 collector_browser_closed:"浏览器窗口已关闭，本次采集已结束。",
 collector_heartbeat_lost:"采集进程心跳中断，请重新采集。",
 collector_invalid_state_transition:"当前采集状态不允许此操作。",
 collector_preview_hash_mismatch:"预览摘要不匹配，已阻止导入。",
 collector_environment_mismatch:"环境或浏览器会话不匹配。"
};
function messageOf(error:unknown){
 if(error instanceof ApiError){
  return errorMessages[error.detail.code||""]||error.detail.message||"采集操作未能完成。";
 }
 return "采集操作未能完成。";
}

export default function CollectorPage({environment}:{environment:EnvironmentFilter}){
 const concrete=environment==="all"?null:environment as EnvironmentId;
 const qc=useQueryClient(),today=new Date().toISOString().slice(0,10);
 const [dateFrom,setDateFrom]=useState(today),[dateTo,setDateTo]=useState(today);
 const [pages,setPages]=useState(1),[records,setRecords]=useState(20),[confirmed,setConfirmed]=useState(false);
 const [runId,setRunId]=useState<string|null>(null),[preview,setPreview]=useState<CollectorRunPreview|null>(null);
 const [importConfirmed,setImportConfirmed]=useState(false),[notice,setNotice]=useState("");
 const status=useQuery({queryKey:["collector-status",concrete],queryFn:({signal})=>api.collectorStatus(concrete!,signal),enabled:Boolean(concrete)});
 const history=useQuery({queryKey:["collector-collections",concrete],queryFn:({signal})=>api.collectorCollections(concrete!,signal),enabled:Boolean(concrete)});
 const run=useQuery({queryKey:["collector-run",concrete,runId],queryFn:({signal})=>api.collectorRun(runId!,signal),
  enabled:Boolean(concrete&&runId),refetchInterval:q=>activeStates.has(q.state.data?.status||"")?1500:false});
 const start=useMutation({mutationFn:()=>api.startCollectorRun({environment_id:concrete!,date_from:dateFrom,date_to:dateTo,
  maximum_pages:pages,maximum_records:records,page_delay_ms:1500,operator_confirmation:confirmed}),
  onSuccess:value=>{setRunId(value.run_id);setPreview(null);setNotice("已请求打开新的临时浏览器窗口。");},
  onError:error=>setNotice(messageOf(error))});
 const login=useMutation({mutationFn:()=>api.confirmCollectorLogin(runId!,concrete!),onSuccess:()=>run.refetch(),onError:error=>setNotice(messageOf(error))});
 const stop=useMutation({mutationFn:()=>api.stopCollectorRun(runId!,concrete!),onSuccess:()=>run.refetch(),onError:error=>setNotice(messageOf(error))});
 const confirmImport=useMutation({mutationFn:()=>api.confirmCollectorRunImport(runId!,concrete!,preview!.collection_id,preview!.payload_sha256),
  onSuccess:async()=>{setNotice("证据已确认导入，不可变证据视图已刷新。");setImportConfirmed(false);await qc.invalidateQueries();},
  onError:error=>setNotice(messageOf(error))});
 useEffect(()=>{setRunId(null);setPreview(null);setConfirmed(false);setImportConfirmed(false);setNotice("");
  qc.invalidateQueries({queryKey:["collector-status"]});qc.invalidateQueries({queryKey:["collector-collections"]});},[concrete,qc]);
 useEffect(()=>{if(run.data?.status==="preview_ready"&&runId&&concrete)void api.collectorRunPreview(runId,concrete).then(setPreview).catch(error=>setNotice(messageOf(error)))},[run.data?.status,runId,concrete]);
 const current=run.data,consistent=status.data?.status==="ready"&&status.data.configuration_consistent;
 const elapsed=useMemo(()=>current?`${Math.floor(current.elapsed_ms/60000)}分 ${Math.floor(current.elapsed_ms%60000/1000)}秒`:"—",[current]);
 if(!concrete)return <div className="state error"><b>{uiText("请选择具体环境")}</b><span>{uiText("采集不支持“全部环境”，请选择国内 UAT 或海外站。")}</span></div>;
 if(status.isLoading)return <div className="state loading">{uiText("正在读取 ")}{concrete} {uiText("采集配置…")}</div>;
 if(status.error)return <div className="state error">{uiText("无法连接本地采集服务。")}<button onClick={()=>status.refetch()}>{uiText("重试")}</button></div>;
 const s=status.data!;
 return <main className="collector-page">
  <header className="ops-page-header collector-hero"><div><p className="eyebrow">{uiText("VISIBLE · TEMPORARY · READ-ONLY")}</p><h1>{uiText("UAT日志采集")}</h1><p>{uiText("点击开始后，本机会打开一个全新的临时浏览器窗口。请在该窗口手动登录；系统不会读取或保存您的密码，也不调用模型 API。")}</p></div><div className="collector-orbit"><span className={current&&activeStates.has(current.status)?"pulse":""}/><b>{current?stateLabel[current.status]||current.status:uiText("等待开始")}</b><small>{s.environment_name}</small></div></header>
  <DataSourceBanner genuine label={`${s.environment_name} · ${s.source_type||"来源待确认"}`} sample={history.data?.items[0]?.record_count||0} kind="uat"/>
  {!consistent&&<div className="state error"><b>{uiText("当前环境尚不可采集")}</b><span>{s.blocking_reason||uiText("日志页或环境配置未确认。")}</span></div>}
  <section className="ops-section collector-config"><header><div><h2>{uiText("01 · 设置只读范围")}</h2><p>{uiText("URL、允许主机与来源类型由后端环境注册表派生，浏览器不能覆盖。")}</p></div></header>
   <div className="scope-grid"><label>{uiText("环境")}<input value={s.environment_name} readOnly/></label><label>{uiText("开始日期")}<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>{uiText("结束日期")}<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label><label>{uiText("最多页数")}<input type="number" min="1" max="10" value={pages} onChange={e=>setPages(Number(e.target.value))}/></label><label>{uiText("最多记录")}<input type="number" min="1" max="500" value={records} onChange={e=>setRecords(Number(e.target.value))}/></label></div>
   <dl className="environment-config-grid"><dt>{uiText("当前环境")}</dt><dd>{s.environment_name}（{s.environment_id}）</dd><dt>{uiText("允许主机")}</dt><dd>{s.allowed_hosts.join("、")}</dd><dt>{uiText("只读日志页")}</dt><dd>{s.log_page_url||uiText("待确认")}</dd></dl>
   <label className="confirmation"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{uiText("我确认当前环境为 ")}{s.environment_name}{uiText("，执行只读采集，并将在临时浏览器中手动完成登录、CAPTCHA 或 MFA。")}</label>
   <div className="uat-actions"><button disabled={!confirmed||!consistent||Boolean(current&&activeStates.has(current.status))||start.isPending} onClick={()=>start.mutate()}>{start.isPending?uiText("正在请求浏览器…"):uiText("开始采集")}</button>{current&&activeStates.has(current.status)&&<button className="secondary" disabled={stop.isPending} onClick={()=>stop.mutate()}>{uiText("停止采集")}</button>}{current&&["completed","stopped","failed","browser_closed","heartbeat_lost"].includes(current.status)&&<button className="secondary" onClick={()=>{setRunId(null);setPreview(null);setNotice("")}}>{uiText("重新采集")}</button>}</div>
   {notice&&<div className={current?.error_code?"state error":"state success-state"}>{uiText(notice)}</div>}
  </section>
  {current&&<section className="ops-section collector-progress"><header><div><h2>{uiText("02 · 实时运行状态")}</h2><p>{uiText("状态来自工作进程心跳，不以“进程已启动”代替真实采集进度。")}</p></div><span className={`run-state state-${current.status}`}>{stateLabel[current.status]||current.status}</span></header>
   <div className="heartbeat-strip"><span className="heartbeat-dot"/><b>{current.current_safe_url||uiText("等待浏览器进入允许页面")}</b><small>{uiText("最后心跳：")}{formatTimestamp(current.last_heartbeat_at)}</small></div>
   <dl className="run-grid"><dt>{uiText("运行 ID")}</dt><dd><code>{current.run_id}</code></dd><dt>{uiText("环境")}</dt><dd>{current.environment_id}</dd><dt>{uiText("开始时间")}</dt><dd>{formatTimestamp(current.started_at)}</dd><dt>{uiText("已运行")}</dt><dd>{elapsed}</dd><dt>{uiText("当前页面")}</dt><dd>{current.current_page||"—"}</dd><dt>{uiText("已捕获")}</dt><dd>{current.captured_count}</dd><dt>{uiText("已接受")}</dt><dd>{current.accepted_count}</dd><dt>{uiText("重复")}</dt><dd>{current.duplicate_count}</dd><dt>{uiText("已拒绝")}</dt><dd>{current.rejected_count}</dd></dl>
   {current.status==="awaiting_manual_login"&&<div className="login-gate"><b>{uiText("在临时浏览器中完成登录并打开日志页")}</b><p>{uiText("系统只校验当前 HTTPS 主机与路径，不检查密码字段或认证令牌。")}</p><button disabled={!current.current_safe_url||login.isPending} onClick={()=>login.mutate()}>{uiText("我已完成登录，开始读取")}</button></div>}
   {current.status==="collecting"&&<progress max={current.maximum_records} value={current.accepted_count}/>}
   {current.safe_error_message&&<div className="state error">{errorMessages[current.error_code||""]||current.safe_error_message}</div>}
   {!!current.warnings.length&&<div className="notice">{uiText("安全提示：")}{current.warnings.join("；")}</div>}
  </section>}
  {preview&&<section className="ops-section collector-preview"><header><div><h2>{uiText("03 · 检查并确认导入")}</h2><p>{uiText("这里只展示去敏结构化预览；导入前仍需明确确认。")}</p></div></header>
   <div className="ops-metrics"><MetricCard label={uiText("已接受")} value={String(preview.record_count)} context={s.environment_name} source={formatSourceType(preview.source_type)}/><MetricCard label={uiText("重复")} value={String(preview.duplicate_count)} context={uiText("未重复导入")} source="本地去重"/><MetricCard label={uiText("已拒绝")} value={String(preview.rejected_count)} context={uiText("越界或无效记录")} source="结构校验"/></div>
   {!!preview.warnings.length&&<div className="notice">{preview.warnings.join("；")}</div>}
   <div className="table-wrap dense"><table><thead><tr><th>{uiText("采集 ID")}</th><th>{uiText("环境")}</th><th>{uiText("证据来源")}</th><th>{uiText("载荷 SHA-256")}</th></tr></thead><tbody><tr><td><code>{preview.collection_id}</code></td><td>{preview.environment_id}</td><td>{preview.source_type}</td><td><code>{preview.payload_sha256}</code></td></tr></tbody></table></div>
   <label className="confirmation"><input type="checkbox" checked={importConfirmed} onChange={e=>setImportConfirmed(e.target.checked)}/>{uiText("我已检查结构化预览，并确认导入不可变证据管线。")}</label>
   <button disabled={!importConfirmed||confirmImport.isPending} onClick={()=>confirmImport.mutate()}>{confirmImport.isPending?uiText("正在导入…"):uiText("确认导入")}</button>
   <TechnicalDataDrawer data={{collection_id:preview.collection_id,environment_id:preview.environment_id,payload_sha256:preview.payload_sha256,record_count:preview.record_count}}/>
  </section>}
  <section className="ops-section"><h2>{s.environment_name} {uiText("最近采集历史")}</h2><div className="table-wrap dense"><table><thead><tr><th>{uiText("采集 ID")}</th><th>{uiText("时间")}</th><th>{uiText("来源")}</th><th>{uiText("记录")}</th></tr></thead><tbody>{history.data?.items.map(item=><tr key={item.collection_id}><td><code>{item.collection_id}</code></td><td>{formatTimestamp(item.collected_at)}</td><td>{item.source_type}</td><td>{item.record_count}</td></tr>)}{!history.data?.items.length&&<tr><td colSpan={4}>{uiText("当前环境暂无采集历史。")}</td></tr>}</tbody></table></div></section>
 </main>;
}
