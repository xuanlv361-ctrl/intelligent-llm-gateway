import {translate as uiText} from "../i18n/index";
import {useEffect,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {api,ApiError,type TrafficControlProposal} from "../services/api";
import {EmptyState,ErrorState,PageHeader,Section,StatusBadge,formatLocalTime,formatValue} from "../components/console/ConsoleUI";
import {BusinessSkillAction} from "../components/console/BusinessSkillAction";

const uiLabel=(source:string|undefined)=>source===undefined?undefined:uiText(source);

const errorMessage=(error:unknown)=>error instanceof ApiError?error.message:error instanceof Error?error.message:uiText("请求失败");
const stateTone=(state:string):"success"|"warning"|"danger"|"neutral"|"info"=>{
  if(["VALIDATED","APPROVED","COMPLETED"].includes(state))return "success";
  if(["REJECTED","AUTO_STOPPED","ROLLED_BACK"].includes(state))return "danger";
  if(["PENDING_APPROVAL","PAUSED"].includes(state))return "warning";
  if(state==="CANARY_RUNNING")return "info";
  return "neutral";
};
const stateLabel:Record<string,string>={DRAFT:"草稿",VALIDATED:"已校验",PENDING_APPROVAL:"待审批",
  APPROVED:"已批准",CANARY_RUNNING:"灰度运行",PAUSED:"已暂停",COMPLETED:"已完成",
  AUTO_STOPPED:"自动停止",ROLLED_BACK:"已回滚",REJECTED:"已拒绝"};
const percent=(value:number|null|undefined)=>value===null||value===undefined?uiText("无法估算"):`${(value*100).toFixed(1)}%`;
const latency=(value:number|null|undefined)=>value===null||value===undefined?uiText("无法估算"):`${Math.round(value)} ms`;
const currency=(value:number|null|undefined)=>value===null||value===undefined?uiText("无法估算"):`CNY ¥${value.toFixed(6)}`;

export function TrafficGovernanceControlPage(){
  const qc=useQueryClient();
  const current=useQuery({queryKey:["traffic-control-current"],queryFn:({signal})=>api.trafficControlCurrent(signal),refetchInterval:5000});
  const proposals=useQuery({queryKey:["traffic-control-proposals"],queryFn:({signal})=>api.trafficControlProposals(signal),refetchInterval:5000});
  const models=useQuery({queryKey:["traffic-control-models"],queryFn:({signal})=>api.uatModels(false,signal)});
  const channels=useQuery({queryKey:["traffic-control-channels"],queryFn:({signal})=>api.trafficControlChannels(signal)});
  const versions=useQuery({queryKey:["traffic-control-versions"],queryFn:({signal})=>api.configReview(signal)});
  const [environmentMode,setEnvironmentMode]=useState<"sandbox"|"china_uat"|"production">("sandbox");
  const [modelId,setModelId]=useState("");const [channelId,setChannelId]=useState("");
  const [targetPolicy,setTargetPolicy]=useState("");const [rollout,setRollout]=useState(5);
  const [reason,setReason]=useState("");const [rollbackCondition,setRollbackCondition]=useState("");
  const [approvalReference,setApprovalReference]=useState("");const [observationMinutes,setObservationMinutes]=useState(15);
  const [minimumSamples,setMinimumSamples]=useState(10);const [selectedId,setSelectedId]=useState("");
  const [errorRate,setErrorRate]=useState(10);const [successRate,setSuccessRate]=useState(90);
  const [p95Limit,setP95Limit]=useState(10000);const [fallbackLimit,setFallbackLimit]=useState(20);
  const [consecutiveFailures,setConsecutiveFailures]=useState(3);
  useEffect(()=>{
    if(!targetPolicy){
      const active=versions.data?.versions.find(item=>item.is_active);
      setTargetPolicy(active?.configuration_version??current.data?.configuration_version??"");
    }
  },[targetPolicy,versions.data,current.data]);
  const eligibleChannels=(channels.data?.items??[]).filter(item=>!modelId||item.models.includes(modelId));
  useEffect(()=>{
    if(channelId&&!eligibleChannels.some(item=>item.channel_id===channelId))setChannelId("");
  },[modelId,channelId,eligibleChannels]);
  const impact=useQuery({queryKey:["traffic-control-impact",modelId,channelId],
    queryFn:({signal})=>api.trafficControlImpact(modelId,channelId,signal),enabled:Boolean(modelId&&channelId)});
  const selected=(proposals.data?.items??[]).find(item=>item.proposal_id===selectedId)??proposals.data?.items[0];
  useEffect(()=>{
    if(!selectedId&&proposals.data?.items[0])setSelectedId(proposals.data.items[0].proposal_id);
  },[selectedId,proposals.data]);
  const live=useQuery({queryKey:["traffic-control-live",selected?.proposal_id],
    queryFn:({signal})=>api.trafficControlMetrics(selected!.proposal_id,signal),
    enabled:Boolean(selected&&["CANARY_RUNNING","PAUSED","AUTO_STOPPED"].includes(selected.state)),refetchInterval:5000});
  const audit=useQuery({queryKey:["traffic-control-audit",selected?.proposal_id],
    queryFn:({signal})=>api.trafficControlAudit(selected!.proposal_id,signal),enabled:Boolean(selected)});
  const refresh=async()=>Promise.all([
    qc.invalidateQueries({queryKey:["traffic-control-current"]}),
    qc.invalidateQueries({queryKey:["traffic-control-proposals"]}),
    qc.invalidateQueries({queryKey:["traffic-control-live"]}),
    qc.invalidateQueries({queryKey:["traffic-control-audit"]}),
  ]);
  const create=useMutation({mutationFn:()=>api.createTrafficControlProposal({
    environment_mode:environmentMode,source_model_id:current.data?.current_model_id,
    source_channel_id:current.data?.current_channel_id,target_model_id:modelId,
    target_channel_id:channelId,source_policy_version:current.data?.configuration_version,
    target_policy_version:targetPolicy,rollout_percent:rollout,reason,
    approval_reference:approvalReference||null,observation_seconds:observationMinutes*60,
    minimum_sample_count:minimumSamples,rollback_condition:rollbackCondition,
    stop_conditions:{error_rate_above:errorRate/100,success_rate_below:successRate/100,
      p95_latency_ms_above:p95Limit,fallback_rate_above:fallbackLimit/100,
      consecutive_failures:consecutiveFailures},
  }),onSuccess:async value=>{setSelectedId(value.proposal_id);await refresh()}});
  type Action="validate"|"submit"|"approve"|"reject"|"activate"|"pause"|"resume"|"increase"|"decrease"|"rollback"|"complete"|"delete";
  const action=useMutation({mutationFn:async({kind,row}:{kind:Action;row:TrafficControlProposal})=>{
    if(kind==="approve")return api.approveTrafficControlProposal(row.proposal_id,approvalReference);
    if(kind==="reject")return api.rejectTrafficControlProposal(row.proposal_id,"审批未通过风险检查");
    if(kind==="activate")return api.activateTrafficControlProposal(row.proposal_id);
    if(kind==="increase"||kind==="decrease")return api.adjustTrafficControlProposal(row.proposal_id,
      Math.max(1,Math.min(100,row.rollout_percent+(kind==="increase"?5:-5))));
    if(kind==="rollback")return api.rollbackTrafficControlProposal(row.proposal_id,"操作员执行回滚");
    if(kind==="delete")return api.deleteTrafficControlProposal(row.proposal_id);
    return api.trafficControlAction(row.proposal_id,kind);
  },onSuccess:refresh});
  const formReady=Boolean(modelId&&channelId&&targetPolicy&&reason.trim()&&rollbackCondition.trim()&&rollout>0&&minimumSamples>0);
  const operationError=create.error||action.error;
  const renderActions=(row:TrafficControlProposal)=><div className="traffic-row-actions">
    {row.state==="DRAFT"&&<><button onClick={()=>action.mutate({kind:"validate",row})}>{uiText("校验变更")}</button><button className="secondary" onClick={()=>action.mutate({kind:"delete",row})}>{uiText("删除草稿")}</button></>}
    {row.state==="VALIDATED"&&<button onClick={()=>action.mutate({kind:"submit",row})}>{uiText("提交审批")}</button>}
    {row.state==="PENDING_APPROVAL"&&<><button onClick={()=>action.mutate({kind:"approve",row})}>{uiText("批准")}</button><button className="secondary" onClick={()=>action.mutate({kind:"reject",row})}>{uiText("拒绝")}</button></>}
    {row.state==="APPROVED"&&<button onClick={()=>action.mutate({kind:"activate",row})}>{uiText("开始灰度")}</button>}
    {row.state==="CANARY_RUNNING"&&<><button onClick={()=>action.mutate({kind:"pause",row})}>{uiText("暂停")}</button><button className="secondary" onClick={()=>action.mutate({kind:"increase",row})}>{uiText("增加 5%")}</button><button className="secondary" onClick={()=>action.mutate({kind:"decrease",row})}>{uiText("减少 5%")}</button><button className="danger" onClick={()=>action.mutate({kind:"rollback",row})}>{uiText("立即回滚")}</button><button className="secondary" onClick={()=>action.mutate({kind:"complete",row})}>{uiText("完成发布")}</button></>}
    {row.state==="PAUSED"&&<><button onClick={()=>action.mutate({kind:"resume",row})}>{uiText("继续灰度")}</button><button className="danger" onClick={()=>action.mutate({kind:"rollback",row})}>{uiText("回滚")}</button></>}
    {row.state==="AUTO_STOPPED"&&<button className="danger" onClick={()=>action.mutate({kind:"rollback",row})}>{uiText("确认回滚")}</button>}
  </div>;
  return <div className="traffic-control-page">
    <PageHeader title={uiText("流量切换")} description={uiText("创建、验证、审批、灰度、监控和回滚模型与渠道流量变更。")}/>
    <div className="traffic-mode-strip"><span><b>{uiText("当前模式")}</b> {uiText("沙箱验证")}</span><span><b>{uiText("国内 UAT")}</b> {uiText("可选")}</span><span><b>{uiText("生产执行")}</b> {uiText("未配置")}</span><span><b>{uiText("数据更新")}</b> {formatLocalTime(current.data?.data_updated_at)}</span></div>
    <Section title={uiText("当前流量")} description={uiText("来自当前持久化策略与去重后的统一真实调用日志。")}>
      {current.error?<ErrorState title={uiText("当前流量读取失败")} description={errorMessage(current.error)} onRetry={()=>current.refetch()}/>:current.data?.metrics_24h.request_count?<>
        <div className="traffic-current-grid"><div><small>{uiText("策略版本")}</small><b>{formatValue(current.data.configuration_version)}</b></div><div><small>{uiText("当前模型")}</small><b>{formatValue(current.data.current_model_id)}</b></div><div><small>{uiText("权威渠道")}</small><b>{formatValue(current.data.current_channel_id)}</b></div><div><small>{uiText("24 小时请求")}</small><b>{current.data.metrics_24h.request_count}</b></div><div><small>{uiText("成功率")}</small><b>{percent(current.data.metrics_24h.success_rate)}</b></div><div><small>{uiText("P95 延迟")}</small><b>{latency(current.data.metrics_24h.p95_latency_ms)}</b></div><div><small>{uiText("Token")}</small><b>{formatValue(current.data.metrics_24h.token_count)}</b></div><div><small>{uiText("费用")}</small><b>{currency(current.data.metrics_24h.total_cost)}</b></div><div><small>{uiText("Fallback")}</small><b>{percent(current.data.metrics_24h.fallback_rate)}</b></div></div>
        {current.data.traffic_distribution.length>0&&<div className="traffic-distribution">{current.data.traffic_distribution.slice(0,5).map(item=><div key={`${item.model_id}-${item.channel_id}`}><span>{item.model_id}<small>{item.channel_id}</small></span><i><em style={{width:`${item.percentage}%`}}/></i><b>{item.percentage}%</b></div>)}</div>}
      </>:<div className="traffic-inline-empty">{uiText("暂无真实流量数据。完成国内 UAT 调用并获得权威渠道证据后，这里会自动更新。")}</div>}
    </Section>
    <Section title={uiText("创建变更")} description={uiText("左右对照当前配置与目标配置；目标选项只来自真实模型目录和权威渠道证据。")}>
      <div className="traffic-environment-tabs"><button className={environmentMode==="sandbox"?"active":""} onClick={()=>setEnvironmentMode("sandbox")}>{uiText("沙箱验证")}</button><button className={environmentMode==="china_uat"?"active":""} onClick={()=>setEnvironmentMode("china_uat")}>{uiText("国内 UAT")}</button><button disabled title={uiText("生产适配器未配置")}>{uiText("正式环境")}</button></div>
      <div className="traffic-compare-editor"><div className="traffic-config-panel current"><span className="traffic-panel-label">{uiText("当前配置")}</span><dl><div><dt>{uiText("模型")}</dt><dd>{formatValue(current.data?.current_model_id)}</dd></div><div><dt>{uiText("渠道")}</dt><dd>{formatValue(current.data?.current_channel_id)}</dd></div><div><dt>{uiText("策略")}</dt><dd>{formatValue(current.data?.configuration_version)}</dd></div><div><dt>{uiText("流量")}</dt><dd>{uiText("观测分布")}</dd></div></dl></div><div className="traffic-direction" aria-hidden="true">→</div><div className="traffic-config-panel target"><span className="traffic-panel-label">{uiText("目标配置")}</span><label>{uiText("真实模型")}<select value={modelId} onChange={event=>setModelId(event.target.value)}><option value="">{uiText("选择 UAT 模型")}</option>{models.data?.models.map(item=><option value={item.id} key={item.id}>{item.id}</option>)}</select></label><label>{uiText("真实渠道")}<select value={channelId} onChange={event=>setChannelId(event.target.value)} disabled={!modelId||eligibleChannels.length===0}><option value="">{eligibleChannels.length?uiText("选择权威渠道"):uiText("暂无匹配渠道证据")}</option>{eligibleChannels.map(item=><option value={item.channel_id} key={item.channel_id}>{item.channel_name||item.channel_id} · {item.sample_count} {uiText("样本")}</option>)}</select></label><label>{uiText("目标策略")}<select value={targetPolicy} onChange={event=>setTargetPolicy(event.target.value)}><option value="">{uiText("选择真实配置版本")}</option>{versions.data?.versions.map(item=><option value={item.configuration_version} key={item.configuration_version}>{item.configuration_version}{item.is_active?uiText("（当前）"):""}</option>)}</select></label></div></div>
      {models.error&&<p className="traffic-warning">{uiText("真实模型目录读取失败：")}{errorMessage(models.error)}</p>}{channels.data?.total===0&&<p className="traffic-warning">{uiText("当前没有权威 channel_id，不能创建真实渠道灰度；系统不会根据模型名称猜测渠道。")}</p>}
      <div className="traffic-rollout"><label>{uiText("灰度比例 ")}<b>{rollout}%</b><input type="range" min="1" max="100" value={rollout} onChange={event=>setRollout(Number(event.target.value))}/></label><div>{[1,5,10,25,50,100].map(value=><button type="button" className={rollout===value?"active":""} onClick={()=>setRollout(value)} key={value}>{value}%</button>)}</div></div>
      <div className="traffic-form-grid"><label>{uiText("变更原因")}<textarea rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder={uiText("说明这次变更解决什么问题")}/></label><label>{uiText("回滚条件")}<textarea rows={3} value={rollbackCondition} onChange={event=>setRollbackCondition(event.target.value)} placeholder={uiText("说明何时必须回滚")}/></label><label>{uiText("观察时长（分钟）")}<input type="number" min="1" value={observationMinutes} onChange={event=>setObservationMinutes(Number(event.target.value))}/></label><label>{uiText("最小样本数")}<input type="number" min="1" value={minimumSamples} onChange={event=>setMinimumSamples(Number(event.target.value))}/></label><label>{uiText("审批引用（生产必填）")}<input value={approvalReference} onChange={event=>setApprovalReference(event.target.value)} placeholder={uiText("沙箱和 UAT 可留空")}/></label></div>
      <details className="traffic-stop-editor" open><summary>{uiText("自动停止条件")}</summary><div><label>{uiText("错误率超过")}<input type="number" min="0" max="100" value={errorRate} onChange={event=>setErrorRate(Number(event.target.value))}/><span>%</span></label><label>{uiText("成功率低于")}<input type="number" min="0" max="100" value={successRate} onChange={event=>setSuccessRate(Number(event.target.value))}/><span>%</span></label><label>{uiText("P95 延迟超过")}<input type="number" min="1" value={p95Limit} onChange={event=>setP95Limit(Number(event.target.value))}/><span>{uiText("ms")}</span></label><label>{uiText("Fallback 率超过")}<input type="number" min="0" max="100" value={fallbackLimit} onChange={event=>setFallbackLimit(Number(event.target.value))}/><span>%</span></label><label>{uiText("连续失败")}<input type="number" min="1" value={consecutiveFailures} onChange={event=>setConsecutiveFailures(Number(event.target.value))}/><span>{uiText("次")}</span></label></div></details>
      <div className="traffic-action-bar"><span>{!modelId?uiText("尚未选择目标模型"):!channelId?uiText("目标渠道未确认"):!targetPolicy?uiText("尚未选择目标策略"):!reason.trim()||!rollbackCondition.trim()?uiText("请填写变更与回滚原因"):impact.data?.status==="insufficient_evidence"&&environmentMode!=="sandbox"?uiText("影响评估证据不足"):uiText("可以创建变更草稿")}</span><button disabled={!formReady||create.isPending||(environmentMode!=="sandbox"&&impact.data?.status!=="ready")} onClick={()=>create.mutate()}>{uiText("保存变更草稿")}</button></div>
      {operationError&&<ErrorState title={uiText("流量变更操作失败")} description={errorMessage(operationError)}/>}
    </Section>
    <Section title={uiText("影响预估")} description={uiText("使用真实历史日志中目标模型与渠道的匹配样本；缺少证据时不显示 0。")}>
      {!modelId||!channelId?<div className="traffic-inline-empty">{uiText("选择目标模型和真实渠道后生成影响预估。")}</div>:impact.isLoading?<p role="status">{uiText("正在计算影响…")}</p>:impact.error?<ErrorState title={uiText("影响预估失败")} description={errorMessage(impact.error)}/>:<div className="table-scroll"><table className="console-table traffic-impact-table"><thead><tr><th>{uiText("指标")}</th><th>{uiText("当前配置")}</th><th>{uiText("目标估算")}</th><th>{uiText("差异")}</th><th>{uiText("数据覆盖率")}</th></tr></thead><tbody><tr><td>{uiText("成功率")}</td><td>{percent(impact.data?.baseline.success_rate)}</td><td>{percent(impact.data?.target.success_rate)}</td><td>{percent(impact.data?.difference.success_rate)}</td><td rowSpan={5}>{percent(impact.data?.coverage_rate)}</td></tr><tr><td>{uiText("P95 延迟")}</td><td>{latency(impact.data?.baseline.p95_latency_ms)}</td><td>{latency(impact.data?.target.p95_latency_ms)}</td><td>{latency(impact.data?.difference.p95_latency_ms)}</td></tr><tr><td>{uiText("单次费用")}</td><td>{currency(impact.data?.baseline.average_cost)}</td><td>{currency(impact.data?.target.average_cost)}</td><td>{currency(impact.data?.difference.average_cost)}</td></tr><tr><td>{uiText("Fallback 率")}</td><td>{percent(impact.data?.baseline.fallback_rate)}</td><td>{percent(impact.data?.target.fallback_rate)}</td><td>{percent(impact.data?.difference.fallback_rate)}</td></tr><tr><td>{uiText("渠道集中度")}</td><td>{uiText("无法估算")}</td><td>{impact.data?.channel_concentration===null?uiText("无法估算"):impact.data?.channel_concentration.toFixed(3)}</td><td>—</td></tr></tbody></table>{impact.data?.limitations.map(item=><p className="traffic-warning" key={item}>{item}</p>)}</div>}
    </Section>
    <Section title={uiText("审批与执行")} description={uiText("状态转换由后端校验并持久化；刷新页面不会丢失。")}>
      {selected?<><div className="traffic-lifecycle" aria-label={uiText("变更生命周期")}>{["DRAFT","VALIDATED","PENDING_APPROVAL","APPROVED","CANARY_RUNNING","PAUSED","COMPLETED"].map((state,index)=><span className={selected.state===state?"current":""} key={state}><i>{index+1}</i>{uiLabel(stateLabel[state])}</span>)}</div><div className="traffic-selected"><div><small>{uiText("当前变更")}</small><b>{selected.proposal_id}</b><StatusBadge tone={stateTone(selected.state)}>{uiLabel(stateLabel[selected.state])}</StatusBadge></div>{renderActions(selected)}</div></>:<EmptyState title={uiText("暂无流量变更记录")} description={uiText("选择真实目标后创建第一份变更草稿。")}/>}
    </Section>
    <Section title={uiText("实时监控")} description={uiText("灰度运行期间每 5 秒读取统一调用日志，并评估自动停止条件。")}>
      {!selected||!["CANARY_RUNNING","PAUSED","AUTO_STOPPED"].includes(selected.state)?<div className="traffic-inline-empty">{uiText("变更进入灰度运行后显示实时指标。")}</div>:live.error?<ErrorState title={uiText("灰度指标读取失败")} description={errorMessage(live.error)} onRetry={()=>live.refetch()}/>:<><div className="traffic-live-grid"><div><small>{uiText("灰度比例 ")}</small><b>{selected.rollout_percent}%</b></div><div><small>{uiText("请求数")}</small><b>{live.data?.metrics.request_count??0}</b></div><div><small>{uiText("成功率")}</small><b>{percent(live.data?.metrics.success_rate)}</b></div><div><small>{uiText("错误率")}</small><b>{percent(live.data?.metrics.error_rate)}</b></div><div><small>P95</small><b>{latency(live.data?.metrics.p95_latency_ms)}</b></div><div><small>{uiText("Token")}</small><b>{formatValue(live.data?.metrics.token_count)}</b></div><div><small>{uiText("费用")}</small><b>{currency(live.data?.metrics.total_cost)}</b></div><div><small>{uiText("Fallback")}</small><b>{percent(live.data?.metrics.fallback_rate)}</b></div></div>{live.data?.triggers.length?<div className="traffic-stop-alert"><b>{uiText("已触发自动停止条件")}</b>{live.data.triggers.map(item=><span key={item.condition}>{item.condition}{uiText("：实际 ")}{item.actual} {uiText("/ 阈值 ")}{item.threshold}</span>)}</div>:<p className="traffic-ok">{uiText("当前未触发自动停止条件 · 最近采集 ")}{formatLocalTime(live.data?.collected_at)}</p>}</>}
    </Section>
    <Section title={uiText("变更记录")} description={uiText("点击记录查看审批、灰度、停止与回滚审计。")}>
      {proposals.error?<ErrorState title={uiText("变更记录读取失败")} description={errorMessage(proposals.error)} onRetry={()=>proposals.refetch()}/>:proposals.data?.items.length?<div className="table-scroll"><table className="console-table"><thead><tr><th>{uiText("时间")}</th><th>{uiText("变更 ID")}</th><th>{uiText("环境")}</th><th>{uiText("当前 → 目标")}</th><th>{uiText("灰度")}</th><th>{uiText("状态")}</th><th>{uiText("操作")}</th></tr></thead><tbody>{proposals.data.items.map(row=><tr key={row.proposal_id} className={selected?.proposal_id===row.proposal_id?"selected-row":""}><td>{formatLocalTime(row.created_at)}</td><td><button className="text-button" onClick={()=>setSelectedId(row.proposal_id)}>{row.proposal_id}</button></td><td>{row.environment_mode==="sandbox"?uiText("沙箱验证"):row.environment_mode==="china_uat"?uiText("国内 UAT"):uiText("正式环境")}</td><td>{formatValue(row.source_model_id)} → {row.target_model_id}<small>{formatValue(row.source_channel_id)} → {row.target_channel_id}</small></td><td>{row.rollout_percent}%</td><td><StatusBadge tone={stateTone(row.state)}>{uiLabel(stateLabel[row.state])}</StatusBadge></td><td><button className="text-button" onClick={()=>setSelectedId(row.proposal_id)}>{uiText("查看详情")}</button></td></tr>)}</tbody></table></div>:<div className="traffic-inline-empty">{uiText("暂无流量变更记录。")}</div>}
    </Section>
    {selected&&<aside className="traffic-detail-drawer" aria-label={uiText("流量变更详情")}><header><div><small>{uiText("变更详情")}</small><h2>{selected.proposal_id}</h2></div><button aria-label={uiText("关闭详情")} onClick={()=>setSelectedId("")}>×</button></header><dl><div><dt>{uiText("操作者")}</dt><dd>{selected.operator_id??selected.proposer_id}</dd></div><div><dt>{uiText("当前配置")}</dt><dd>{formatValue(selected.source_model_id)} / {formatValue(selected.source_channel_id)}</dd></div><div><dt>{uiText("目标配置")}</dt><dd>{selected.target_model_id} / {selected.target_channel_id}</dd></div><div><dt>{uiText("策略变化")}</dt><dd>{formatValue(selected.source_policy_version)} → {selected.target_policy_version}</dd></div><div><dt>{uiText("灰度比例 ")}</dt><dd>{selected.rollout_percent}%</dd></div><div><dt>{uiText("Request ID")}</dt><dd>{selected.request_ids.length?selected.request_ids.join("、"):uiText("未关联")}</dd></div><div><dt>{uiText("Decision ID")}</dt><dd>{selected.decision_ids.length?selected.decision_ids.join("、"):uiText("未关联")}</dd></div><div><dt>{uiText("回滚条件")}</dt><dd>{selected.rollback_condition}</dd></div></dl><h3>{uiText("生命周期时间线")}</h3><ol className="traffic-audit-timeline">{audit.data?.items.map(item=><li key={item.audit_id}><span>{formatLocalTime(item.created_at)}</span><b>{item.event_type}</b><small>{item.actor_id}</small></li>)}</ol><details><summary>{uiText("技术详情")}</summary><dl><div><dt>{uiText("修订")}</dt><dd>{selected.revision}</dd></div><div><dt>{uiText("治理策略")}</dt><dd>{selected.policy_version}</dd></div><div><dt>{uiText("审批 ID")}</dt><dd>{formatValue(selected.approval_id)}</dd></div></dl></details></aside>}
    <div className="traffic-skill-bridge"><BusinessSkillAction skillId="propose-traffic-switch" label={uiText("通过 Agent Skill 创建治理提案")} argumentsValue={{source_policy_version:current.data?.configuration_version??"未记录",target_policy_version:targetPolicy,requested_percentage:rollout,environment:"china_uat",reason,rollback_condition:rollbackCondition}} disabledReason={targetPolicy&&reason&&rollbackCondition?undefined:"请先完成目标策略、原因和回滚条件"} confirmation/></div>
  </div>;
}
