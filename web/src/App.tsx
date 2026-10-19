import { useEffect, useRef, useState } from "react";
import {motion,MotionConfig,useReducedMotion} from 'motion/react';
import {translate as uiText,useLocale} from './i18n';
import {LanguageSwitcher} from './i18n/LanguageSwitcher';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, DataMode, EnvironmentFilter, EnvironmentId, HealthCard, ImportBatch, UatRequestBody } from "./services/api";
import CostBudgetPage from "./pages/CostBudgetPage";
import GatewayWorkspacePage from "./pages/GatewayWorkspacePage";
import RealtimeLogSyncPage from "./pages/RealtimeLogSyncPage";
import SearchPage from "./pages/SearchPage";
import IncrementalMetricsPage from "./pages/IncrementalMetricsPage";
import ModelCapabilityMatrixPage from "./pages/ModelCapabilityMatrixPage";
import StickyRoutingPage from "./pages/StickyRoutingPage";
import SafetyGovernancePage from "./pages/SafetyGovernancePage";
import ConfigReviewPage from "./pages/ConfigReviewPage";
import {
  BugReportsPage,
  CompatibilityPage,
  ErrorCenterPage,
  ReportsPage,
  ShadowRoutingPage,
  SystemDescriptionPage,
  VisualTestPage,
} from "./pages/OperationalPages";
import {formatSourceType, labelEnum} from "./lib/presentation";
import {AcceptanceCenterPage,DashboardPage,ModelCatalogPage,RoutingExecutePage,RoutingRunsPage} from "./pages/ConsolePages";
import {CircuitBreakerPage,MonitoringOverviewPage,SchedulerPerformancePage,TrafficGovernancePage} from "./pages/OperationalClosurePages";
import {AgentSkillManagementPage} from "./pages/AgentSkillManagementPage";
import {StrategyEffectPage} from "./pages/LiveAcceptancePages";
import {ContinuousProbeDetailPage,ContinuousProbeListPage} from "./pages/ContinuousProbesPage";
import HistoricalReplayPage from "./pages/HistoricalReplayPage";
import {RoutingDecisionDetailPage,RoutingDecisionsPage} from "./pages/RoutingDecisionsPage";
import {BusinessSkillAction} from "./components/console/BusinessSkillAction";

const navGroups = [
  {label:"Gateway workspace",icon:"⇄",items:[["/gateway","Providers & budgets"]]},
  {label:"总览",icon:"⌂",items:[["/dashboard","总览"]]},
  {label:"调度执行",icon:"▶",items:[["/routing/execute","发起调度"],["/routing/runs","执行记录"]]},
  {label:"策略与数据",icon:"◇",items:[["/data/models","模型目录"],["/strategy/config","策略配置"],["/strategy/effect","策略效果"],["/strategy/shadow","影子调度"],["/data/snapshots","指标快照"],["/data/dynamic-metrics","动态指标"],["/data/capabilities","能力矩阵"],["/data/pricing","价格版本"]]},
  {label:"可靠性",icon:"◉",items:[["/reliability/channels","渠道健康"],["/reliability/circuit-breakers","熔断与恢复"],["/reliability/probes","探测任务"]]},
  {label:"监控与日志",icon:"▥",items:[["/observability/overview","监控总览"],["/observability/decisions","决策日志"],["/observability/replay","历史回放"],["/observability/errors","错误记录"],["/observability/performance","调度性能"]]},
  {label:"发布与集成",icon:"↗",items:[["/governance/traffic","正式流量切换"],["/integrations/agent-skill","Agent Skill"]]},
  {label:"验收中心",icon:"✓",items:[["/acceptance","验收中心"]]},
  {label:"系统设置",icon:"⚙",items:[["/settings/environments","环境配置"],["/settings/security","密钥与权限"],["/settings/budget","预算与审批"]]},
] as const;
const EMPTY = "尚未导入 UAT 证据，请先前往数据导入页面。";
type BadgeTone = "neutral" | "demo" | "uat" | "unified" | "fixture" | "success" | "warning" | "danger" | "info";

const Badge = ({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) =>
  <span className={`badge badge-${tone}`}>{children}</span>;
const Card = ({ title, value, note }: { title: string; value: string | number; note: string }) =>
  <article className="metric"><span>{uiText(title)}</span><strong>{value}</strong><small>{uiText(note)}</small></article>;
const provenanceTone = (source?: string | null): BadgeTone =>
  source === "demo_mock" ? "demo" :
  source === "measured_unified_uat" ? "unified" :
  source === "integration_test_fixture" ? "fixture" :
  source === "measured_uat" ? "uat" : "neutral";
const healthTone = (state: string, score: number | null): BadgeTone =>
  score === null || ["unknown", "insufficient_data"].includes(state) ? "neutral" :
  state === "healthy" ? "success" :
  ["degraded", "stale", "warning"].includes(state) ? "warning" :
  ["unhealthy", "failed", "blocked"].includes(state) ? "danger" : "neutral";

function QueryState({ loading, error, onRetry }: { loading: boolean; error: Error | null; onRetry: () => void }) {
  if (loading) return <div className="state loading" role="status"><b>{uiText("正在读取本地服务数据……")}</b><span>{uiText("服务启动期间会自动进行有限重试。")}</span></div>;
  if (error) {
    const apiError=error instanceof ApiError?error:null;
    const upstreamCode=apiError?.detail.details&&typeof apiError.detail.details==="object"&&"upstreamCode" in apiError.detail.details
      ?String((apiError.detail.details as {upstreamCode?:unknown}).upstreamCode||""):"";
    return <div className="state error" role="alert">
      <b>{apiError?.message||uiText("本地服务请求失败。")}</b>
      {apiError?.detail.diagnosticId&&<small>{uiText("诊断编号：")}{apiError.detail.diagnosticId}</small>}
      <button onClick={onRetry}>{uiText("重新连接")}</button>
      {apiError&&<details open><summary>{uiText("技术信息")}</summary><p>{uiText("错误类型：")}{apiError.detail.code}</p>{upstreamCode&&<p>{uiText("后端代码：")}{upstreamCode}</p>}<p>{uiText("HTTP 状态：")}{apiError.detail.status||uiText("未收到响应")}</p></details>}
    </div>;
  }
  return null;
}
function Empty({ goImport }: { goImport?: () => void }) {
  return <div className="state empty"><b>{uiText(EMPTY)}</b>{goImport && <button onClick={goImport}>{uiText("前往数据导入")}</button>}</div>;
}
function PageTitle({ title, sub, mode, last, source }: { title: string; sub: string; mode: DataMode; last?: string | null; source?: string | null }) {
  const effective = source || (mode === "demo" ? "demo_mock" : "measured_uat");
  const label = mode === "demo" ? "演示数据 / Demo Data" :
    effective === "integration_test_fixture" ? "集成测试夹具 / Fixture" :
    effective === "measured_unified_uat" ? "统一 UAT 观测" : "UAT 实测证据";
  return <header className="page-title"><p className="eyebrow">{uiText("EVIDENCE WORKSPACE")}</p><h1>{uiText(title)}</h1><p>{uiText(sub)}</p><div><Badge tone={provenanceTone(effective)}>{uiText(label)}</Badge>{last && <small>{uiText("最后更新：")}{last}</small>}</div></header>;
}

function Health({ mode }: { mode: DataMode }) {
  const q = useQuery({ queryKey: ["health", mode], queryFn: ({ signal }) => api.health(mode, signal) });
  const [selected, setSelected] = useState<HealthCard | null>(null);
  if (q.isLoading || q.error) return <QueryState loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.items.length) return <><PageTitle title={uiText("渠道健康")} sub={uiText("证据不足时不显示健康结论。")} mode={mode} /><Empty /></>;
  return <><PageTitle title={uiText("渠道健康")} sub={uiText("样本、置信度、新鲜度与来源始终同时展示。")} mode={mode} last={d.last_updated} source={d.source_type} />
    <BusinessSkillAction skillId="inspect-channel-health" label={uiText("分析渠道健康")} argumentsValue={{environment_id:"china_uat",time_range:"1h"}}/>
    <div className="table-wrap"><table><thead><tr><th>{uiText("渠道")}</th><th>{uiText("状态")}</th><th>{uiText("成功率")}</th><th>{uiText("样本")}</th><th>P50</th><th>{uiText("置信度")}</th><th>{uiText("来源")}</th></tr></thead>
      <tbody>{d.items.map(c => <tr key={c.channel_id} tabIndex={0} onClick={() => setSelected(c)}>
        <td>{c.channel_id} · {c.channel_name}</td><td><Badge tone={healthTone(c.health_state, c.health_score)}>{c.health_score === null ? uiText("证据不足") : labelEnum(c.health_state)}</Badge></td>
        <td>{c.observed_success_rate === null ? uiText("未知") : `${(c.observed_success_rate * 100).toFixed(1)}%`}</td><td>{c.sample_size}</td><td>{c.p50_latency ?? uiText("未知")} {uiText("ms")}</td>
        <td>{Math.round(c.confidence * 100)}%</td><td><Badge tone={provenanceTone(c.source_type)}>{formatSourceType(c.source_type)}</Badge></td>
      </tr>)}</tbody></table></div>
    {selected && <div className="drawer"><button aria-label={uiText("关闭")} className="secondary" onClick={() => setSelected(null)}>×</button><span>{uiText("渠道证据详情")}</span><h2>{selected.channel_id} · {selected.channel_name}</h2>
      <Badge tone={healthTone(selected.health_state, selected.health_score)}>{selected.health_score === null ? uiText("样本不足") : labelEnum(selected.health_state)}</Badge>
      <Card title={uiText("样本数")} value={selected.sample_size} note={selected.evidence_limitations} /><p>{uiText("最后观测：")}{selected.last_observation || uiText("待确认")} {uiText("· 新鲜度：")}{labelEnum(selected.freshness_status)}</p></div>}
  </>;
}

function Imports() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"select" | "preview" | "validated" | "confirmed">("select");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [sourceType, setSourceType] = useState("integration_test_fixture");
  const history = useQuery({ queryKey: ["imports"], queryFn: ({ signal }) => api.imports(signal) });
  const action = useMutation({
    mutationFn: async (kind: "preview" | "validate" | "confirm") => {
      if (!file) throw new Error("请选择文件");
      return api[kind](file, sourceType, {});
    },
    onSuccess: (data, kind) => {
      setBatch(data);
      setStage(kind === "confirm" ? "confirmed" : kind === "validate" ? "validated" : "preview");
      if (kind === "confirm") { qc.invalidateQueries(); history.refetch(); }
    },
  });
  const choose = (selected: File | null) => {
    if (!selected) return;
    const ext = selected.name.toLowerCase().split(".").pop();
    if (!["csv", "json", "jsonl", "ndjson"].includes(ext || "")) { alert(uiText("仅支持 CSV、JSON、JSONL")); return; }
    if (selected.size > 5_000_000) { alert(uiText("文件不能超过 5 MB")); return; }
    setFile(selected); setBatch(null); setStage("select");
  };
  const download = async () => {
    if (!batch) return;
    const text = await api.qualityReport(batch.batch_id);
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = `${batch.batch_id}-quality.md`; a.click(); URL.revokeObjectURL(url);
  };
  const step = stage === "select" ? 1 : stage === "preview" ? 2 : 3;
  return <><PageTitle title={uiText("数据导入")} sub={uiText("预览 → 验证 → 明确确认；文件不会写入 localStorage。")} mode="uat" source={sourceType} />
    <ol className="import-progress" aria-label={uiText("导入进度")}><li className={step === 1 ? "current" : "done"}>{uiText("1. 预览")}</li><li className={step === 2 ? "current" : step > 2 ? "done" : ""}>{uiText("2. 验证")}</li><li className={step === 3 ? "current" : ""}>{uiText("3. 确认")}</li></ol>
    <div className="drop"><input aria-label={uiText("选择证据文件")} type="file" accept=".csv,.json,.jsonl,.ndjson" onChange={e => choose(e.target.files?.[0] || null)} />
      <select aria-label={uiText("来源类型")} value={sourceType} onChange={e => setSourceType(e.target.value)}><option value="integration_test_fixture">{uiText("集成测试夹具")}</option><option value="measured_uat">{uiText("真实 UAT 观测")}</option><option value="measured_unified_uat">{uiText("统一 UAT 观测")}</option><option value="backend_log_export">{uiText("后端日志导出")}</option></select>
      {file && <p>{uiText("文件：")}{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}<button disabled={!file || action.isPending} onClick={() => action.mutate("preview")}>{uiText("1. 上传并预览")}</button></div>
    {action.error && <div className="state error" role="alert"><b>{action.error instanceof Error ? action.error.message : uiText("导入失败")}</b></div>}
    {batch && <section className="panel"><h2>{stage === "confirmed" ? uiText("不可变批次已保存") : uiText("导入检查")}</h2><Badge tone={provenanceTone(batch.source_type)}>{batch.source_type}</Badge>
      <p>{uiText("文件：")}{batch.provenance.filename} {uiText("· SHA-256：")}<code>{batch.source_sha256}</code></p><p>{uiText("总行数：")}{batch.row_count} {uiText("· 列：")}{batch.detected_columns.join(", ")}</p>
      <div className="metrics"><Card title={uiText("有效")} value={batch.valid_count} note={uiText("可导入")} /><Card title={uiText("警告")} value={batch.warning_count} note={uiText("需要检查")} /><Card title={uiText("拒绝")} value={batch.rejected_count} note={uiText("不会进入下游")} /><Card title={uiText("需确认")} value={batch.needs_confirmation_count} note={uiText("例如公式风险")} /></div>
      <div className="notice"><b>{uiText("字段自动匹配")}</b><br/>{uiText("系统按列标题匹配支持字段；未识别列保留在脱敏预览中，缺少必需字段会由后端明确标记。")}</div>
      <div className="table-wrap"><table><thead><tr><th>{uiText("行")}</th><th>{uiText("分类")}</th><th>{uiText("问题")}</th><th>{uiText("脱敏预览")}</th></tr></thead><tbody>{batch.normalized_preview.map((row, i) =>
        <tr key={i}><td>{String(row._row_number)}</td><td><Badge tone={row._classification === "rejected" ? "danger" : row._classification === "warning" || row._classification === "needs_confirmation" ? "warning" : "success"}>{labelEnum(row._classification)}</Badge></td><td>{Array.isArray(row._issues) ? row._issues.map(labelEnum).join("；") : uiText("无")}</td><td>{Object.entries(row).filter(([key,value])=>!key.startsWith("_")&&value!==null&&typeof value!=="object").slice(0,4).map(([key,value])=>`${labelEnum(key)}：${String(value)}`).join("；") || uiText("无可展示字段")}</td></tr>)}</tbody></table></div>
      {stage === "preview" && <button onClick={() => action.mutate("validate")}>{uiText("2. 运行后端验证")}</button>}
      {stage === "validated" && <><div className="notice">{uiText("确认后保存不可变批次；拒绝行不会进入下游统计。")}</div><button onClick={() => action.mutate("confirm")}>{uiText("3. 明确确认导入")}</button></>}
      {stage === "confirmed" && <><p>{uiText("批次：")}{batch.import_batch_id} {uiText("· 导入 ")}{batch.imported_row_count} {uiText("· 拒绝 ")}{batch.rejected_count} · {batch.audit_status}</p><button onClick={download}>{uiText("生成并下载质量报告")}</button></>}
    </section>}
    <section className="panel"><h2>{uiText("批次历史")}</h2>{history.isLoading ? <div className="state loading">{uiText("加载中…")}</div> : history.data?.items.length ?
      <div className="table-wrap"><table><tbody>{history.data.items.map(x => <tr key={x.batch_id}><td>{x.batch_id}</td><td>{x.provenance.filename}</td><td><Badge tone={provenanceTone(x.source_type)}>{formatSourceType(x.source_type)}</Badge></td><td>{x.imported_at}</td></tr>)}</tbody></table></div> : <p>{uiText("尚无导入批次。")}</p>}</section>
  </>;
}

function UatExecution({environment, onEnvironmentChange}:{environment:EnvironmentId;onEnvironmentChange:(value:EnvironmentId)=>void}) {
  const qc = useQueryClient();
  const environmentsQuery = useQuery({ queryKey: ["environments"], queryFn: ({ signal }) => api.environments(signal) });
  const statusQuery = useQuery({ queryKey: ["environment-status",environment], queryFn: ({ signal }) => api.environmentStatus(environment,signal) });
  const [selectedChannel, setSelectedChannel] = useState("unified-routing");
  const optionsQuery = useQuery({ queryKey: ["uat-editor-options",selectedChannel], queryFn: ({ signal }) => api.uatEditorOptions(signal,selectedChannel) });
  const historyQuery = useQuery({ queryKey: ["environment-executions",environment], queryFn: ({ signal }) => api.environmentExecutions(environment,signal) });
  const credentialQuery = useQuery({ queryKey: ["environment-credential",environment], queryFn: ({ signal }) => api.environmentCredentialStatus(environment,signal) });
  const modelsQuery = useQuery({ queryKey: ["environment-models",environment], queryFn: ({ signal }) => api.environmentModels(environment,false,signal) });
  const controlQuery = useQuery({ queryKey: ["uat-execution-control"], queryFn: ({ signal }) => api.uatExecutionControl(signal) });
  const environmentStateQuery = useQuery({ queryKey: ["environment-execution-state",environment], queryFn: ({ signal }) => api.environmentExecutionState(environment,signal), enabled:environment==="china_uat" });
  const testCredential = useMutation({ mutationFn: api.testCredential });
  const environmentSwitch = useMutation({
    mutationFn:(enabled:boolean)=>api.setEnvironmentExecutionState(environment,enabled),
    onSuccess:async data=>{
      qc.setQueryData(["environment-execution-state",environment],data);
      await Promise.all([
        qc.invalidateQueries({queryKey:["environment-status",environment]}),
        qc.invalidateQueries({queryKey:["routing-execute-status",environment]}),
        qc.invalidateQueries({queryKey:["routing-execute-environment-state",environment]}),
      ]);
      testCredential.reset();
      if(data.enabled) testCredential.mutate();
    },
  });
  const [credential, setCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [credentialConfirmed, setCredentialConfirmed] = useState(false);
  const [editingCredential, setEditingCredential] = useState(false);
  const [editorMode, setEditorMode] = useState<"profile" | "custom">("profile");
  const [profileId, setProfileId] = useState("P01");
  const [confirmed, setConfirmed] = useState(false);
  const [prompt, setPrompt] = useState("用一句话说明水循环。");
  const [model, setModel] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelCatalogInitialized, setModelCatalogInitialized] = useState(false);
  const [stream, setStream] = useState(false);
  const [maxTokens, setMaxTokens] = useState(128);
  const [submitted, setSubmitted] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState("");
  const [platformLogId, setPlatformLogId] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [controlConfirmed, setControlConfirmed] = useState(false);
  const [taskMaxRequests,setTaskMaxRequests]=useState("");
  const [taskMaxCost,setTaskMaxCost]=useState("");
  const [taskDurationMinutes,setTaskDurationMinutes]=useState("");
  const [taskMaxConcurrency,setTaskMaxConcurrency]=useState("");
  const [taskMaxAttempts,setTaskMaxAttempts]=useState("");
  const [capabilityProvider,setCapabilityProvider]=useState("");
  const [capabilityContext,setCapabilityContext]=useState("");
  const [capabilityInput,setCapabilityInput]=useState("");
  const [capabilityOutput,setCapabilityOutput]=useState("");
  const [capabilitySource,setCapabilitySource]=useState("");
  const [capabilityVersion,setCapabilityVersion]=useState("");
  const [capabilityReviewConfirmed,setCapabilityReviewConfirmed]=useState(false);
  const controlledModels = ["deepseek-v4-flash","glm-5.2","claude-sonnet-5","gpt-5.6-terra","kimi-k2.7-code","doubao-seed-2-0-mini-260215"];
  const createControl = useMutation({mutationFn:()=>api.createUatExecutionControl({
    environment_id:"china_uat",allowed_models:controlledModels,allowed_channels:[selectedChannel],
    max_requests:Number(taskMaxRequests),max_total_cost:taskMaxCost,cost_currency:"CNY",max_duration_seconds:Number(taskDurationMinutes)*60,max_concurrency:Number(taskMaxConcurrency),max_attempts_per_request:Number(taskMaxAttempts),
    expires_at:new Date(Date.now()+Number(taskDurationMinutes)*60*1000).toISOString(),
    explicit_confirmation:controlConfirmed,
  }),onSuccess:async()=>{setControlConfirmed(false);await controlQuery.refetch();}});
  const approveControl=useMutation({mutationFn:()=>api.approveUatExecutionControl(
    controlQuery.data!.task!.task_id,{approval_reference:approvalReference,
      approval_expires_at:new Date(Date.now()+Number(taskDurationMinutes)*60*1000).toISOString()}),
    onSuccess:async()=>{await controlQuery.refetch();}});
  const activateControl=useMutation({mutationFn:()=>api.activateUatExecutionControl(controlQuery.data!.task!.task_id),
    onSuccess:async()=>{await controlQuery.refetch();}});
  const stopControl = useMutation({mutationFn:(kill:boolean)=>api.stopUatExecutionControl(kill?"operator_kill_switch":"operator_stop",kill),onSuccess:async()=>{await controlQuery.refetch();}});
  const reviewCapability=useMutation({mutationFn:()=>api.reviewUatOutputCapability({
    model_id:model,provider:capabilityProvider,channel_id:selectedChannel,
    max_context_tokens:Number(capabilityContext),max_input_tokens:Number(capabilityInput),
    max_output_tokens:Number(capabilityOutput),streaming_supported:null,
    multimodal_capabilities:[],evidence_source:capabilitySource,
    evidence_type:"reviewed_configuration",evidence_version:capabilityVersion,
    observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+24*60*60*1000).toISOString(),
    confidence_status:"confirmed",supersede_existing:true,
  }),onSuccess:async()=>{setCapabilityReviewConfirmed(false);await optionsQuery.refetch();}});
  const saveCredential = useMutation({ mutationFn: (value:string) => api.setEnvironmentCredential(environment,value), onSuccess: async () => {
    setCredential(""); setShowCredential(false); setCredentialConfirmed(false); setEditingCredential(false);
    setModelCatalogInitialized(false); setModel("");
    await Promise.all([credentialQuery.refetch(),statusQuery.refetch(),modelsQuery.refetch()]);
    if(environment==="china_uat") testCredential.mutate();
  }});
  const clearCredential = useMutation({ mutationFn: () => api.clearEnvironmentCredential(environment), onSuccess: async () => {
    setCredential(""); setShowCredential(false); setCredentialConfirmed(false); setEditingCredential(false); setModelCatalogInitialized(false); setModel("");
    testCredential.reset();
    await Promise.all([credentialQuery.refetch(),statusQuery.refetch(),modelsQuery.refetch()]);
  }});
  const refreshModels = useMutation({ mutationFn: () => api.environmentModels(environment,true), onSuccess: data => {
    setModelCatalogInitialized(true);
    qc.setQueryData(["environment-models",environment], data);
  }});
  const options = optionsQuery.data;
  const modelCatalog = modelsQuery.data;
  const catalogReady = modelCatalog?.catalog_status === "ready" || modelCatalog?.status === "ready";
  const availableModels = catalogReady ? modelCatalog!.models.filter(item =>
    item.execution_allowed && item.display_name.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase())) : [];
  useEffect(()=>{
    if(environment==="china_uat"&&environmentStateQuery.data?.enabled&&credentialQuery.data?.configured&&testCredential.isIdle)testCredential.mutate();
  },[environment,environmentStateQuery.data?.enabled,credentialQuery.data?.configured,testCredential]);
  useEffect(() => {
    if (!catalogReady || !modelCatalog) return;
    const ids = new Set(modelCatalog.models.filter(item => item.execution_allowed).map(item => item.id));
    if (!modelCatalogInitialized) {
      setModel(modelCatalog.models.find(item => item.execution_allowed)?.id || "");
      setModelCatalogInitialized(true);
    } else if (model && !ids.has(model)) {
      setModel("");
      setConfirmed(false);
    }
  }, [catalogReady, modelCatalog, model, modelCatalogInitialized]);
  const profile = options?.profiles.find(item => item.id === profileId);
  const body: UatRequestBody = {
    environment_id: environment,
    mode: "real_uat_execute",
    confirmation: { confirmed, confirmation_text: confirmed ? "I understand this will call the Weimeta UAT API and may incur UAT cost." : "" },
    request: { requested_model: model, channel_id:selectedChannel, messages: [{ role: "user", content: prompt }], stream, max_tokens: maxTokens },
    measurement: { plan_id: `UR-V3-${profileId}`, request_profile_id: profileId, session_id: "SESSION-D1-MORNING" },
    shadow: { run_before_execution: true, strategy: "confidence_aware_v2" },
  };
  const validation = useMutation({ mutationFn: () => api.validateEnvironmentRequest(environment,body) });
  const execution = useMutation({
    mutationFn: () => api.executeEnvironmentRequest(environment,body),
    onSuccess: async () => {
      setConfirmed(false);
      setSubmitted(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["environment-status",environment] }),
        qc.invalidateQueries({ queryKey: ["environment-executions",environment] }),
        qc.invalidateQueries({ queryKey: ["/api/v1/budgets/summary"] }),
      ]);
      await statusQuery.refetch();
    },
  });
  const attachment = useMutation({ mutationFn: () => api.attachBackendEvidence(selectedExecution, platformLogId), onSuccess: () => qc.invalidateQueries({ queryKey: ["uat-executions"] }) });
  if (statusQuery.isLoading || optionsQuery.isLoading || credentialQuery.isLoading || (environment==="china_uat"&&environmentStateQuery.isLoading) || statusQuery.error || optionsQuery.error || credentialQuery.error || environmentStateQuery.error) return <QueryState loading={statusQuery.isLoading || optionsQuery.isLoading || credentialQuery.isLoading || environmentStateQuery.isLoading} error={statusQuery.error || optionsQuery.error || credentialQuery.error || environmentStateQuery.error} onRetry={() => { statusQuery.refetch(); optionsQuery.refetch(); credentialQuery.refetch(); environmentStateQuery.refetch(); }} />;
  const status = statusQuery.data!;
  const executionControl=controlQuery.data;
  const environmentState=environmentStateQuery.data;
  const credentialState = credentialQuery.data!;
  const quotaUsed = status.request_limit_enabled && status.daily_request_limit !== null
    && status.requests_used_today >= status.daily_request_limit;
  const capabilityBlocked = Boolean(profile?.status === "blocked_capability" || (stream && !options?.stream_execution_ready));
  const selectedModelValid = Boolean(model && catalogReady && modelCatalog?.models.some(item => item.id === model && item.execution_allowed));
  const selectedOutputCapability=options?.model_output_capabilities.find(item=>item.model_id===model);
  const confirmedLimits=[selectedOutputCapability?.confirmed_max_output_tokens,
    selectedOutputCapability?.confirmed_channel_max_output_tokens]
    .filter((value):value is number=>typeof value==="number"&&value>0);
  const contextCapacity=selectedOutputCapability?.max_context_tokens;
  const effectiveUiLimit=confirmedLimits.length===2&&typeof contextCapacity==="number"?
    Math.min(...confirmedLimits,contextCapacity):null;
  const outputCapabilityBlocked=effectiveUiLimit===null||maxTokens<=0||maxTokens>effectiveUiLimit;
  const connectionReady=environment!=="china_uat"||testCredential.data?.connection_status==="success";
  const blocked = !status.execution_ready || !connectionReady || !executionControl?.execution_ready || !confirmed || execution.isPending || quotaUsed || capabilityBlocked || outputCapabilityBlocked || submitted || !selectedModelValid;
  const changeProfile = (id: string) => {
    setProfileId(id);
    const selected = options?.profiles.find(item => item.id === id);
    if (selected) { setPrompt(selected.prompt); setStream(selected.stream); setMaxTokens(selected.default_max_tokens); }
    setConfirmed(false);
    setSubmitted(false);
  };
  const observed = execution.data?.observed_api_result || {};
  const shadow = execution.data?.shadow_decision || {};
  const executionRecord = execution.data?.execution;
  const environmentInfo=environmentsQuery.data?.environments.find(item=>item.environment_id===environment);
  const overseasPending=environment==="overseas" && environmentInfo?.models_endpoint_status!=="read_only_validated";
  const changeEnvironment=(value:EnvironmentId)=>{
    setModel("");setModelSearch("");setModelCatalogInitialized(false);setConfirmed(false);setSubmitted(false);
    setSelectedExecution("");setCredential("");setCredentialConfirmed(false);setEditingCredential(false);testCredential.reset();onEnvironmentChange(value);
  };
  return <><PageTitle title={uiText("真实 API 执行")} sub={uiText("按环境隔离密钥、模型目录、执行记录与费用证据。")} mode="uat" source="measured_unified_uat" />
    <section className="panel environment-switcher"><label>{uiText("平台环境")}<select aria-label={uiText("平台环境")} value={environment} onChange={e=>changeEnvironment(e.target.value as EnvironmentId)}><option value="china_uat">{uiText("国内 UAT")}</option><option value="overseas">{uiText("海外站")}</option></select></label><div><b>{environmentInfo?.display_name || (environment==="china_uat"?uiText("国内 UAT"):uiText("海外站"))}</b><small>{uiText("配置状态：")}{environmentInfo?.configuration_status==="confirmed"?uiText("已确认"):uiText("待确认")}</small></div></section>
    {environment==="china_uat"&&environmentState&&<section className="panel uat-environment-switch-panel"><div><h2>{uiText("UAT 环境")}</h2><p className={environmentState.enabled?"environment-state-on":"environment-state-off"}>{environmentState.enabled?uiText("UAT 环境已开启，可以发送真实 UAT 请求。"):uiText("UAT 环境已关闭，不能发送真实 UAT 请求。")}</p></div><label className="uat-environment-toggle"><input aria-label={uiText("UAT 环境开关")} role="switch" type="checkbox" checked={environmentState.enabled} disabled={environmentSwitch.isPending} onChange={event=>environmentSwitch.mutate(event.target.checked)}/><b>{environmentSwitch.isPending?uiText("保存中…"):environmentState.enabled?uiText("开启"):uiText("关闭")}</b></label>{environmentSwitch.error&&<div className="state error" role="alert">{environmentSwitch.error instanceof ApiError?environmentSwitch.error.message:uiText("保存失败，已恢复原状态。")}</div>}</section>}
    {overseasPending && <div className="state pending-state" role="status"><b>{uiText("海外 API 地址已由官方资料确认，模型目录仍待当前 Key 的一次只读验证。")}</b><span>{uiText("请在“环境接入”页使用内部验证操作；完成执行、日志页与币种仍未确认。")}</span></div>}
    <div className="notice danger-notice">{uiText("这是真实 API 调用入口；仅配置完整且明确启用的环境可执行，可能产生测试费用。")}</div>
    <section className="panel credential-panel"><h2>{environmentInfo?.display_name || uiText("当前环境")}{uiText("密钥配置")}</h2>
      <Badge tone={credentialState.configured ? "success" : "neutral"}>{credentialState.credential_source === "windows_encrypted_vault" ? uiText("已加密保存") : credentialState.credential_source === "session" ? uiText("旧版临时会话") : credentialState.credential_source === "environment" ? uiText("后端环境变量已配置") : uiText("未配置")}</Badge>
      <p>{uiText("密钥使用 AES‑256‑GCM 加密，数据密钥由 Windows DPAPI CurrentUser 保护；不保存到浏览器、SQLite、日志或项目文件。")}</p>
      <p className="field-help">{uiText("浏览器刷新和后端重启后仍可使用。只有主动更换、清除或退出系统时才会删除。")}</p>
      {(!credentialState.configured || editingCredential) && <><div className="credential-input">
        <label>{uiText("UAT API Key")}<input aria-label={uiText("UAT API Key")} name="uat-api-key-new-value" type={showCredential ? "text" : "password"} autoComplete="new-password" data-1p-ignore="true" data-lpignore="true" spellCheck={false} value={credential} onChange={e=>setCredential(e.target.value)} /></label>
        <button type="button" className="secondary" onClick={()=>setShowCredential(v=>!v)}>{showCredential ? uiText("隐藏") : uiText("显示")}</button>
      </div>
      <label className="confirmation"><input aria-label={uiText("确认加密保存密钥")} type="checkbox" checked={credentialConfirmed} onChange={e=>setCredentialConfirmed(e.target.checked)} />{uiText("我确认将此密钥加密保存到当前 Windows 用户范围，直至更换、清除或退出系统。")}</label>
      <div className="uat-actions"><button onClick={()=>saveCredential.mutate(credential)} disabled={!credential.trim() || !credentialConfirmed || saveCredential.isPending}>{credentialState.configured ? uiText("确认更换密钥") : uiText("加密保存此密钥")}</button>{credentialState.configured&&<button type="button" className="secondary" onClick={()=>{setCredential("");setCredentialConfirmed(false);setEditingCredential(false)}}>{uiText("取消更换")}</button>}</div></>}
      {credentialState.configured && !editingCredential && <div className="uat-actions">{environment==="china_uat" && <button className="secondary" onClick={()=>testCredential.mutate()} disabled={testCredential.isPending}>{uiText("测试连接")}</button>}<button className="secondary" onClick={()=>{testCredential.reset();setEditingCredential(true)}}>{uiText("更换密钥")}</button><button className="danger" onClick={()=>clearCredential.mutate()} disabled={clearCredential.isPending}>{uiText("清除已保存密钥")}</button></div>}
      <dl><dt>{uiText("密钥来源")}</dt><dd>{credentialState.credential_source === "windows_encrypted_vault" ? uiText("Windows 加密保险库") : credentialState.credential_source === "session" ? uiText("旧版临时会话") : credentialState.credential_source === "environment" ? uiText("后端环境变量") : uiText("未配置")}</dd><dt>{uiText("保存时间")}</dt><dd>{credentialState.updated_at || credentialState.created_at || "—"}</dd><dt>{uiText("有效期")}</dt><dd>{credentialState.credential_source === "windows_encrypted_vault" ? uiText("直到更换、清除或退出系统") : credentialState.expires_at || "—"}</dd><dt>{uiText("保护方式")}</dt><dd>{credentialState.key_protection || "—"}</dd><dt>{uiText("指纹")}</dt><dd>{credentialState.key_fingerprint || "—"}</dd><dt>{uiText("接口检测")}</dt><dd>{testCredential.data?.connection_status || uiText("未测试")}</dd><dt>{uiText("请求基础条件")}</dt><dd>{status.execution_ready?uiText("已通过"):uiText("存在阻断")}</dd></dl>
      {testCredential.data && <div className={testCredential.data.connection_status==="success"?"state success-state":"state error"} role="status">{testCredential.data.message}</div>}
      {(saveCredential.error||clearCredential.error||testCredential.error) && <div className="state error" role="alert">{(()=>{
        const error=saveCredential.error||clearCredential.error||testCredential.error;
        return `${error instanceof ApiError?error.message:"密钥操作失败"}；未显示任何密钥内容。`;
      })()}</div>}
    </section>
    {environment==="china_uat"&&<section className="panel"><h2>{uiText("受控真实执行任务")}</h2>
      <p>{uiText("任务初始状态为草稿。任务参数只限制具体执行，不会开启、关闭或修改 UAT 环境状态。")}</p>
      <dl><dt>{uiText("状态")}</dt><dd>{labelEnum(executionControl?.status||"DISABLED")}</dd><dt>{uiText("运行 ID")}</dt><dd>{executionControl?.task?.run_id||"—"}</dd><dt>{uiText("请求进度")}</dt><dd>{executionControl?.task?uiText("{0} / {1}（剩余 {2}）", {"0": executionControl.task.used_requests, "1": executionControl.task.max_requests, "2": executionControl.task.remaining_requests}):"—"}</dd><dt>{uiText("费用进度")}</dt><dd>{executionControl?.task?uiText("{0} 已用 / {1} {2}（剩余 {3}）", {"0": executionControl.task.used_cost, "1": executionControl.task.max_total_cost, "2": executionControl.task.cost_currency, "3": executionControl.task.remaining_cost}):"—"}</dd><dt>{uiText("活动并发")}</dt><dd>{executionControl?.task?`${executionControl.task.active_requests} / ${executionControl.task.max_concurrency}`:"—"}</dd><dt>{uiText("到期")}</dt><dd>{executionControl?.task?.expires_at||"—"}</dd><dt>{uiText("任务执行条件")}</dt><dd>{executionControl?.execution_ready?uiText("已激活"):uiText("尚未激活")}</dd></dl>
      {(!executionControl?.task||["STOPPED","EXPIRED","BUDGET_EXHAUSTED","KILLED"].includes(executionControl.status))&&<>
        <div className="form-grid"><label>{uiText("允许渠道")}<select aria-label={uiText("允许渠道")} value={selectedChannel} onChange={e=>setSelectedChannel(e.target.value)}><option value="unified-routing">{uiText("unified-routing")}</option></select></label><label>{uiText("最大请求数")}<input aria-label={uiText("任务最大请求数")} type="number" min="1" max="24" placeholder={uiText("请输入本次测试允许的最大请求数")} value={taskMaxRequests} onChange={e=>setTaskMaxRequests(e.target.value)}/></label><label>{uiText("最大费用（CNY）")}<input aria-label={uiText("任务最大费用")} type="number" min="0.01" max="3" step="0.01" placeholder={uiText("请输入本次测试预算")} value={taskMaxCost} onChange={e=>setTaskMaxCost(e.target.value)}/></label><label>{uiText("有效分钟数")}<input aria-label={uiText("任务有效分钟数")} type="number" min="1" max="20" placeholder={uiText("请输入开启时长")} value={taskDurationMinutes} onChange={e=>setTaskDurationMinutes(e.target.value)}/></label><label>{uiText("最大并发")}<input aria-label={uiText("任务最大并发")} type="number" min="1" max="1" placeholder={uiText("请输入最大并发数")} value={taskMaxConcurrency} onChange={e=>setTaskMaxConcurrency(e.target.value)}/></label><label>{uiText("最大尝试次数")}<input aria-label={uiText("任务最大尝试次数")} type="number" min="1" max="3" placeholder={uiText("请输入单个请求允许的总尝试次数")} value={taskMaxAttempts} onChange={e=>setTaskMaxAttempts(e.target.value)}/></label></div>
        <label className="confirmation"><input aria-label={uiText("确认创建受控真实执行任务")} type="checkbox" checked={controlConfirmed} onChange={e=>setControlConfirmed(e.target.checked)} />{uiText("确认创建默认不可执行的 DRAFT；审批和激活必须分别完成，Kill Switch 始终可用。")}</label>
        <button onClick={()=>createControl.mutate()} disabled={!controlConfirmed||!taskMaxRequests||!taskMaxCost||!taskDurationMinutes||!taskMaxConcurrency||!taskMaxAttempts||createControl.isPending}>{uiText("创建 DRAFT")}</button></>}
      {executionControl?.status==="DRAFT"&&<><label>{uiText("审批/授权引用")}<input aria-label={uiText("审批引用")} value={approvalReference} onChange={e=>setApprovalReference(e.target.value)} /></label><button onClick={()=>approveControl.mutate()} disabled={!approvalReference.trim()||approveControl.isPending}>{uiText("批准任务")}</button></>}
      {executionControl?.status==="APPROVED"&&<button onClick={()=>activateControl.mutate()} disabled={activateControl.isPending}>{uiText("激活任务")}</button>}
      {executionControl?.status==="ACTIVE"&&<div className="uat-actions"><button className="secondary" onClick={()=>stopControl.mutate(false)} disabled={stopControl.isPending}>{uiText("停止任务")}</button><button className="danger" onClick={()=>stopControl.mutate(true)} disabled={stopControl.isPending}>{uiText("触发 Kill Switch")}</button></div>}
      {(createControl.error||approveControl.error||activateControl.error||stopControl.error)&&<div className="state error" role="alert">{uiText("受控执行任务操作失败；任务仍保持安全状态。")}</div>}
    </section>}
    <section className="uat-grid">
      <article className="panel"><h2>{uiText("运行状态")}</h2>
        <dl><dt>{uiText("UAT 环境")}</dt><dd>{environment==="china_uat"?(environmentState?.enabled?uiText("已开启"):uiText("已关闭")):uiText("不适用")}</dd><dt>{uiText("接口检测")}</dt><dd>{testCredential.data?.connection_status||uiText("未测试")}</dd><dt>{uiText("请求执行条件")}</dt><dd>{status.execution_ready&&(environment!=="china_uat"||executionControl?.execution_ready)&&!capabilityBlocked&&!outputCapabilityBlocked?uiText("可执行"):uiText("存在阻断")}</dd><dt>{uiText("受控任务")}</dt><dd>{environment==="china_uat"?labelEnum(executionControl?.status||"DISABLED"):uiText("不适用")}</dd><dt>{uiText("目标")}</dt><dd>{status.base_url}</dd><dt>{uiText("密钥")}</dt><dd>{status.key_configured ? uiText("已在后端配置") : uiText("未配置")}</dd></dl>
        {status.blocking_reasons.length > 0 && <div className="blocked" role="alert">{status.blocking_reasons.map(reason=>reason==="real_execution_disabled"?"UAT 环境当前已关闭，请打开 UAT 环境后再执行。":reason.startsWith("capability_pending")?"当前模型或渠道的能力信息待确认，暂不能执行真实请求。":labelEnum(reason)).join(" · ")}</div>}</article>
      <article className="panel"><h2>{uiText("预算与限制")}</h2><dl><dt>{uiText("今日请求")}</dt><dd>{status.requests_used_today} / {status.request_limit_enabled ? status.daily_request_limit : uiText("不限")}</dd><dt>{uiText("币种")}</dt><dd>{environmentInfo?.currency || uiText("费用币种待确认")}</dd><dt>{uiText("本地预算")}</dt><dd>{environmentInfo?.currency==="CNY" ? uiText("已使用 ¥{0} / {1}", {"0": status.estimated_cost_used_today.toFixed(4), "1": status.budget_limit_enabled && status.daily_budget_cny !== null ? `¥${status.daily_budget_cny.toFixed(2)}` : "不限"}) : uiText("费用币种待确认")}</dd><dt>{uiText("自动重试")}</dt><dd>{uiText("关闭")}</dd><dt>{uiText("流式执行")}</dt><dd>{uiText("首版未开放")}</dd></dl><p className="notice">{uiText("本地次数和预算限制已关闭。实际调用仍受账户余额、平台 RPM/TPM、模型可用性及上游渠道限制；不会跨环境或跨币种汇总费用。")}</p></article>
    </section>
    {quotaUsed && <div className="blocked" role="alert">{uiText("今日调用额度已用完")}</div>}
    <section className="panel"><h2>{uiText("受控请求编辑器")}</h2>
      <div className="editor-modes" role="radiogroup" aria-label={uiText("编辑器模式")}><label><input type="radio" name="editor-mode" checked={editorMode === "profile"} onChange={() => setEditorMode("profile")} />{uiText("档案模式")}</label><label><input type="radio" name="editor-mode" checked={editorMode === "custom"} onChange={() => setEditorMode("custom")} />{uiText("自定义安全请求")}</label></div>
      <div className="form-grid"><label>{uiText("请求档案")}<select aria-label={uiText("请求档案")} value={profileId} onChange={e => changeProfile(e.target.value)} disabled={editorMode === "custom"}>{options?.profiles.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}{item.status === "blocked_capability" ? uiText("（blocked_capability）") : ""}</option>)}</select></label>
        <fieldset className="model-picker"><legend>{uiText("模型（共 ")}{modelCatalog?.model_count ?? 0} {uiText("个）")}</legend>
          <div className="model-tools"><input aria-label={uiText("搜索模型")} placeholder={uiText("搜索模型……")} value={modelSearch} onChange={e=>setModelSearch(e.target.value)} /><button type="button" className="secondary" onClick={()=>refreshModels.mutate()} disabled={modelsQuery.isFetching||refreshModels.isPending}>{uiText("刷新")}</button></div>
          {modelsQuery.isLoading || modelsQuery.isFetching ? <p className="field-help" role="status">{uiText("正在读取 UAT 模型目录")}</p>
            : modelCatalog?.status === "error" || modelCatalog?.catalog_status === "error" || modelCatalog?.catalog_status === "blocked" ? <div className="state error" role="alert"><b>{modelCatalog.error?.message || (overseasPending?uiText("海外模型端点尚未确认"):uiText("模型目录不可用"))}</b><small>{modelCatalog.error?.code}</small><button type="button" className="secondary" onClick={()=>modelsQuery.refetch()}>{uiText("重新加载")}</button></div>
            : modelCatalog?.models.length === 0 ? <p className="model-empty">{uiText("当前 Key 未返回可用模型")}</p>
            : <><select aria-label={uiText("UAT 模型")} value={model} onChange={e => setModel(e.target.value)}><option value="">{uiText("请选择模型")}</option>{availableModels.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
              {model && modelCatalog?.models.find(item=>item.id===model) && <p className="model-meta">{uiText("提供方：")}{modelCatalog.models.find(item=>item.id===model)?.owned_by || uiText("未提供")} {uiText("· 流式能力：待确认")}</p>}
              {availableModels.length===0 && modelSearch && <p className="model-empty">{uiText("没有匹配的模型")}</p>}</>}
        </fieldset>
        <fieldset className="stream-field"><legend>{uiText("流式")}</legend><label><input type="radio" name="stream" checked={!stream} onChange={() => setStream(false)} disabled={editorMode === "profile"} />{uiText("false")}</label><label><input type="radio" name="stream" checked={stream} onChange={() => setStream(true)} disabled={!options?.stream_execution_ready || editorMode === "profile"} />{uiText("true（尚未开放真实执行）")}</label></fieldset>
        <label>{uiText("最大输出 tokens")}<input aria-label={uiText("最大输出 tokens")} type="number" min="1" step="1" value={maxTokens} onChange={e => {const value=Number(e.target.value);setMaxTokens(Number.isSafeInteger(value)&&value>0?value:0);}} /></label></div>
      <div className="uat-actions" aria-label={uiText("常用最大输出 tokens")}>{(options?.token_presets||[2048,4096,8192,12288,16384]).map(value=><button type="button" className="secondary" key={value} onClick={()=>setMaxTokens(value)}>{value}</button>)}</div>
      {model&&<div className="notice"><b>{uiText("模型/渠道输出能力证据")}</b><br/>{(()=>{const cap=options?.model_output_capabilities.find(item=>item.model_id===model);return `模型 ${cap?.model_id} · 渠道 ${cap?.channel_id||selectedChannel} · 上下文 ${cap?.max_context_tokens??"待确认"} · 输出上限 ${cap?.max_output_tokens??"待确认"} · 状态 ${cap?.status||"capability_pending"} · 来源 ${cap?.evidence_source||"pending_confirmation"} · 类型 ${cap?.evidence_type||"—"} · 版本 ${cap?.evidence_version||"—"} · 过期 ${cap?.expires_at||"—"} · 审查人 ${cap?.reviewed_by||"—"}`;})()}</div>}
      {model&&selectedOutputCapability?.status!=="confirmed"&&<details className="policy-drawer"><summary>{uiText("录入经过审查的能力记录")}</summary><p className="field-help">{uiText("只有有权操作员审核过的正式配置或渠道元数据可以确认上限；上下文、输入和输出上限必须分别取证，历史输出只可记录下限。")}</p><div className="form-grid"><label>{uiText("提供方")}<input aria-label={uiText("能力提供方")} value={capabilityProvider} onChange={e=>setCapabilityProvider(e.target.value)}/></label><label>{uiText("经审查的上下文容量")}<input aria-label={uiText("能力最大上下文")} type="number" min="1" value={capabilityContext} onChange={e=>setCapabilityContext(e.target.value)}/></label><label>{uiText("经审查的输入能力上限")}<input aria-label={uiText("能力最大输入")} type="number" min="1" value={capabilityInput} onChange={e=>setCapabilityInput(e.target.value)}/></label><label>{uiText("经审查的输出能力上限")}<input aria-label={uiText("能力最大输出")} type="number" min="1" value={capabilityOutput} onChange={e=>setCapabilityOutput(e.target.value)}/></label><label>{uiText("证据来源")}<input aria-label={uiText("能力证据来源")} value={capabilitySource} onChange={e=>setCapabilitySource(e.target.value)}/></label><label>{uiText("证据版本")}<input aria-label={uiText("能力证据版本")} value={capabilityVersion} onChange={e=>setCapabilityVersion(e.target.value)}/></label></div><label className="confirmation"><input aria-label={uiText("确认能力证据已审查")} type="checkbox" checked={capabilityReviewConfirmed} onChange={e=>setCapabilityReviewConfirmed(e.target.checked)}/>{uiText("我确认这些值来自经过审查的正式证据，不是根据历史输出猜测。")}</label><button onClick={()=>reviewCapability.mutate()} disabled={!capabilityReviewConfirmed||!capabilityProvider||!capabilityContext||!capabilityInput||!capabilityOutput||!capabilitySource||!capabilityVersion||reviewCapability.isPending}>{uiText("保存审查记录")}</button>{reviewCapability.error&&<div className="state error" role="alert">{uiText("能力证据保存失败，执行继续保持关闭。")}</div>}</details>}
      {profile && <div className="profile-meta"><b>{profile.purpose}</b><span>{uiText("输入规模：")}{profile.expected_input_scale}</span><span>{uiText("输出规模：")}{profile.expected_output_scale}</span>{profile.status === "blocked_capability" && <Badge tone="danger">{uiText("blocked_capability · ")}{profile.blocking_reason}</Badge>}</div>}
      <p className="field-help">{options?.streaming_explanation}</p>
      {options?.models.explanation && <p className="field-help">{options.models.explanation}</p>}
      <details className="policy-drawer"><summary>{uiText("查看执行策略")}</summary><dl><dt>{uiText("模型准入")}</dt><dd>{uiText("当前 Key 最近成功读取的 UAT 模型目录")}</dd><dt>{uiText("目录来源")}</dt><dd>{uiText("GET /v1/models")}</dd><dt>{uiText("自动回退")}</dt><dd>{uiText("关闭")}</dd><dt>{uiText("策略版本")}</dt><dd>{options?.policy_version}</dd></dl></details>
      <label>{uiText("安全请求内容")}<textarea aria-label={uiText("UAT 请求内容")} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <div className="request-preview"><code>{environmentInfo?.chat_completions_path ? `POST ${environmentInfo.chat_completions_path}` : "完成端点待确认"}</code><p>{uiText("environment_id: ")}{environment} {uiText("· model: ")}{model} {uiText("· stream: ")}{String(stream)} {uiText("· max_tokens: ")}{maxTokens}</p><p>{uiText("影子策略：confidence_aware_v2（平台实际渠道仍待后端日志确认）")}</p></div>
      <label className="confirmation"><input aria-label={uiText("确认执行真实 UAT 请求")} type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{uiText("我已审核请求，并理解本次调用可能产生 UAT 测试费用。")}</label>
      <div className="uat-actions"><button className="secondary" onClick={() => validation.mutate()} disabled={!confirmed || validation.isPending}>{uiText("仅验证请求")}</button><button onClick={() => execution.mutate()} disabled={blocked}>{execution.isPending ? uiText("执行中…") : uiText("执行一次真实 UAT 请求")}</button></div>
      {selectedModelValid&&outputCapabilityBlocked&&<div className="blocked" role="alert">{effectiveUiLimit===null?uiText("capability_pending：{0}{1}请先完成当前模型与 {2} 渠道的能力证据审核。", {"0": !selectedOutputCapability?.max_output_tokens?"模型/渠道输出上限缺失；":"", "1": !selectedOutputCapability?.max_context_tokens?"上下文容量缺失；":"", "2": selectedChannel}):uiText("token_limit_exceeded：用户请求 {0}，模型上限 {1}，渠道上限 {2}，上下文上限 {3}，当前静态可执行上限 {4}；不会静默截断。", {"0": maxTokens, "1": selectedOutputCapability?.confirmed_max_output_tokens, "2": selectedOutputCapability?.confirmed_channel_max_output_tokens, "3": selectedOutputCapability?.max_context_tokens, "4": effectiveUiLimit})}</div>}
      {validation.data && <div className={validation.data.valid ? "state success-state" : "state error"} role="status">{validation.data.valid ? uiText("execution_ready") : validation.data.blocking_reasons.join(" · ")} · {environmentInfo?.currency==="CNY"?uiText("预计费用 ¥{0}", {"0": validation.data.cost_estimate.estimated_cost_cny}):uiText("费用币种待确认")}{validation.data.token_boundary&&<><br/>{uiText("用户请求 ")}{validation.data.token_boundary.user_requested_max_tokens} {uiText("· 模型上限 ")}{validation.data.token_boundary.model_max_output_tokens??uiText("待确认")} {uiText("· 渠道上限 ")}{validation.data.token_boundary.channel_max_output_tokens??uiText("待确认")} {uiText("· 剩余上下文 ")}{validation.data.token_boundary.remaining_context_capacity??uiText("待确认")} {uiText("· 预算可负担输出 ")}{validation.data.token_boundary.budget_affordable_output_tokens??uiText("待确认")} {uiText("· 实际执行值 ")}{validation.data.token_boundary.effective_max_tokens??uiText("待确认")} {uiText("· 限制因素 ")}{validation.data.token_boundary.limiting_factor||uiText("无")}</>}</div>}
      {execution.error && <div className="state error" role="alert"><b>{execution.error instanceof ApiError ? `${execution.error.detail.code}: ${execution.error.message}` : uiText("执行失败")}</b></div>}
      {execution.data && <div className="result-rail"><h3>{uiText("执行摘要")}</h3><dl className="result-grid"><dt>{uiText("执行 ID")}</dt><dd>{executionRecord?.execution_id}</dd><dt>{uiText("决策 ID")}</dt><dd>{String(executionRecord?.decision_id || "—")}</dd><dt>{uiText("状态")}</dt><dd>{executionRecord?.status}</dd><dt>{uiText("网络调用")}</dt><dd>{execution.data.network_execution.network_called ? uiText("已发生") : uiText("未发生")}</dd><dt>HTTP</dt><dd>{String(observed.http_status ?? "—")}</dd><dt>{uiText("耗时")}</dt><dd>{String(observed.elapsed_ms ?? "—")} {uiText("ms")}</dd><dt>{uiText("关联")}</dt><dd>{execution.data.backend_correlation?.status}</dd></dl>
        <h3>{uiText("响应摘要")}</h3><dl className="result-grid"><dt>{uiText("Response ID")}</dt><dd>{String(observed.response_id ?? "未提供")}</dd><dt>{uiText("请求模型")}</dt><dd>{model}</dd><dt>{uiText("实际模型")}</dt><dd>{String(observed.actual_model ?? "未确认")}</dd><dt>{uiText("输入 tokens")}</dt><dd>{String(observed.input_tokens ?? "—")}</dd><dt>{uiText("输出 tokens")}</dt><dd>{String(observed.output_tokens ?? "—")}</dd><dt>{uiText("总 tokens")}</dt><dd>{String(observed.total_tokens ?? "—")}</dd><dt>{uiText("结束原因")}</dt><dd>{String(observed.finish_reason ?? "—")}</dd><dt>{uiText("完整性")}</dt><dd>{String(observed.response_completeness ?? "unknown")}</dd><dt>{uiText("Content-Type 不匹配")}</dt><dd>{String(observed.content_type_mismatch ?? false)}</dd><dt>{uiText("Request ID")}</dt><dd>{String(observed.request_id_header ?? "未提供")}</dd></dl>
        <h3>{uiText("安全内容")}</h3><div className="safe-content">{String(observed.assistant_content ?? "响应未提供可展示的助手内容")}</div>
        {Boolean(observed.reasoning_content) && <details><summary>{uiText("查看脱敏 reasoning content")}</summary><p>{String(observed.reasoning_content)}</p></details>}
        <h3>{uiText("影子摘要")}</h3><p>{uiText("推荐候选：")}{String(shadow.recommended_candidate ?? "无")}</p><p>{uiText("Fallback：")}{Array.isArray(shadow.fallback_order) ? shadow.fallback_order.join(" → ") : uiText("无")}</p><p>{uiText("目录：")}{String(shadow.catalog_version ?? "—")} · {String(shadow.catalog_sha256 ?? "—")}</p><p className="field-help">{uiText("本地推荐不代表平台实际渠道；实际渠道必须由后端日志证据确认。")}</p>
        <h3>{uiText("证据")}</h3><p>{uiText("来源：measured_unified_uat · 原始 Content-Type：")}{String(observed.original_content_type ?? "未提供")} {uiText("· 解析类型：")}{String(observed.parsed_body_type ?? "text")} {uiText("· Parser：")}{String(observed.parser_version ?? "—")}</p>
        <details><summary>{uiText("查看执行技术标识")}</summary><dl className="result-grid"><dt>{uiText("解析器版本")}</dt><dd>{String(observed.parser_version??"待确认")}</dd><dt>{uiText("目录版本")}</dt><dd>{String(shadow.catalog_version??"待确认")}</dd><dt>{uiText("目录摘要")}</dt><dd>{String(shadow.catalog_sha256??"待确认")}</dd><dt>{uiText("原始内容类型")}</dt><dd>{String(observed.original_content_type??"待确认")}</dd></dl></details></div>}
    </section>
    {environment==="overseas" ? <section className="panel"><h2>{uiText("海外日志采集")}</h2><div className="blocked" role="status">{uiText("overseas_log_page_unconfirmed · 海外只读日志页面尚未确认，日志采集与关联保持关闭。")}</div></section> : <section className="panel"><h2>{uiText("后端日志关联")}</h2><p className="field-help">{uiText("先在“数据导入”页以 backend_log_export 导入并确认脱敏日志，再在此选择执行。留空平台日志 ID 时按 Request ID / Response ID 精确关联；非精确关联仍需人工确认。")}</p>
      <div className="correlation-controls"><label>{uiText("执行记录")}<select aria-label={uiText("待关联执行")} value={selectedExecution} onChange={e => setSelectedExecution(e.target.value)}><option value="">{uiText("请选择")}</option>{historyQuery.data?.items.map(item => <option key={String(item.execution_id)} value={String(item.execution_id)}>{String(item.execution_id)} · {String(item.status)}</option>)}</select></label><label>{uiText("平台日志 ID（可选）")}<input aria-label={uiText("平台日志 ID")} value={platformLogId} onChange={e => setPlatformLogId(e.target.value)} /></label><button onClick={() => attachment.mutate()} disabled={!selectedExecution || attachment.isPending}>{uiText("关联已导入日志")}</button></div>
      {attachment.data && <div className="state success-state" role="status">{uiText("关联状态：")}{String(attachment.data.correlation_status)} {uiText("· 实际渠道：")}{String(attachment.data.platform_actual_channel ?? "未确认")}</div>}
      {attachment.error && <div className="state error" role="alert">{attachment.error instanceof ApiError ? attachment.error.message : uiText("关联失败")}</div>}
    </section>}
  </>;
}

function EnvironmentSettings({onSelectEnvironment}:{onSelectEnvironment:(value:EnvironmentFilter)=>void}){
  const navigate=useNavigate();
  const query=useQuery({queryKey:["environments"],queryFn:({signal})=>api.environments(signal)});
  const logStatus=useQuery({queryKey:["overseas-log-page-status"],queryFn:({signal})=>api.overseasLogPageStatus(signal)});
  const overseas=query.data?.environments.find(item=>item.environment_id==="overseas");
  const [confirmed,setConfirmed]=useState(false);
  const [disableConfirmed,setDisableConfirmed]=useState(false);
  const validation=useMutation({mutationFn:()=>api.validateOverseasDiscovery(),onSuccess:()=>query.refetch()});
  const disableLogPage=useMutation({mutationFn:()=>api.disableOverseasLogPage(),
    onSuccess:()=>{setDisableConfirmed(false);logStatus.refetch();query.refetch();}});
  const result=validation.data as {models_endpoint_status?:string;validation?:{model_count?:number};evidence?:{validation_id?:string}}|undefined;
  const savedLog=logStatus.data;
  return <><PageTitle title={uiText("环境接入")} sub={uiText("区分官方文档确认、只读模型验证与完成执行授权。")} mode="uat" source="local_versioned_config"/>
    <section className="panel"><h2>{uiText("海外站接入状态")}</h2><dl className="environment-config-grid">
      <dt>{uiText("控制台")}</dt><dd>{uiText("海外站控制台 · 官方资料已确认")}</dd>
      <dt>{uiText("官方来源")}</dt><dd>{uiText("唯元智创官方开发文档（仅作配置证据，不从产品跳转）")}</dd>
      <dt>{uiText("API 接入")}</dt><dd>{uiText("后端环境注册表 · 文档已确认")}</dd>
      <dt>{uiText("API Host allowlist")}</dt><dd><code>{overseas?.allowed_api_hosts?.join(", ")}</code> {uiText("· 精确匹配")}</dd>
      <dt>{uiText("模型目录")}</dt><dd>{uiText("只读目录接口 · ")}{labelEnum(overseas?.models_endpoint_status)}</dd>
      <dt>{uiText("完成执行")}</dt><dd>{uiText("聊天完成接口 · 未验证")}</dd>
      <dt>{uiText("API protocol")}</dt><dd>{labelEnum(overseas?.api_protocol)} {uiText("· 文档已确认")}</dd>
      <dt>{uiText("Log page")}</dt><dd>{labelEnum("overseas_log_page_unconfirmed")}</dd>
      <dt>{uiText("Currency")}</dt><dd>{uiText("费用币种：待确认")}</dd>
      <dt>{uiText("Real execution")}</dt><dd><Badge tone="danger">{labelEnum("overseas_completion_not_yet_authorized")}</Badge></dd>
    </dl><div className="notice"><b>{uiText("受控内部验证")}</b><br/>{uiText("浏览器只调用本地 FastAPI；后端仅进行一次只读模型目录验证，不重试、不回退、不调用完成接口。")}</div>
    <label className="confirmation"><input aria-label={uiText("确认海外模型目录验证")} type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{uiText("我确认发起恰好一次只读模型目录请求，且不会启用完成执行。")}</label>
    <button onClick={()=>validation.mutate()} disabled={!confirmed||validation.isPending}>{validation.isPending?uiText("正在验证模型目录"):uiText("验证模型目录")}</button>
    {result&&<div className={result.models_endpoint_status==="read_only_validated"?"state success-state":"state error"} role="status">{uiText("状态：")}{result.models_endpoint_status} {uiText("· 模型数：")}{result.validation?.model_count??0} {uiText("· 验证 ID：")}{result.evidence?.validation_id??"—"}{uiText("；完成执行仍保持关闭。")}</div>}
    {validation.error&&<div className="state error" role="alert">{validation.error instanceof ApiError?validation.error.message:uiText("验证失败")}</div>}
    <p className="field-help">{uiText("验证证据只保存 URL、状态、内容类型、耗时、响应摘要哈希、模型数与脱敏错误分类；不保存密钥或请求头。")}</p></section>
    <section className="panel overseas-log-settings"><h2>{uiText("海外使用日志接入")}</h2>
      <div className="ops-metrics">
        <div className="ops-metric"><header>{uiText("当前状态")}</header><strong>{labelEnum(savedLog?.log_page_status||"pending_confirmation")}</strong><small>{uiText("运行时设置")}</small></div>
        <div className="ops-metric"><header>{uiText("结构校验")}</header><strong>{labelEnum(savedLog?.structural_validation_status||"pending_confirmation")}</strong><small>{uiText("不访问远端")}</small></div>
        <div className="ops-metric"><header>{uiText("浏览器验证")}</header><strong>{labelEnum(savedLog?.browser_live_validation_status||"not_attempted")}</strong><small>{uiText("只读采集结果")}</small></div>
        <div className="ops-metric"><header>{uiText("最近记录数")}</header><strong>{savedLog?.latest_record_count??"—"}</strong><small>{savedLog?.latest_collection_at||uiText("尚未采集")}</small></div>
      </div>
      <dl className="environment-config-grid"><dt>{uiText("只读目标")}</dt><dd>{savedLog?.logs_page_url?uiText("已在本地后端安全配置"):uiText("尚未配置")}</dd><dt>{uiText("配置来源")}</dt><dd>{formatSourceType(savedLog?.source_type||"pending_confirmation")}</dd><dt>{uiText("人工确认时间")}</dt><dd>{savedLog?.operator_confirmed_at||uiText("待确认")}</dd><dt>{uiText("最近 Collection ID")}</dt><dd>{savedLog?.latest_collection_id||uiText("待确认")}</dd></dl>
      {savedLog?.logs_page_url?<><div className="uat-actions">
        <button onClick={()=>{api.setEnvironmentFilter("overseas");onSelectEnvironment("overseas");navigate("/collector")}}>{uiText("进入内部只读采集")}</button>
        <button className="secondary" onClick={()=>disableLogPage.mutate()} disabled={!disableConfirmed||disableLogPage.isPending}>{uiText("停用已保存地址")}</button></div>
        <label className="confirmation"><input aria-label={uiText("确认停用海外日志地址")} type="checkbox" checked={disableConfirmed} onChange={event=>setDisableConfirmed(event.target.checked)}/>{uiText("我确认停用本地保存的只读采集目标；此操作不会修改海外平台。")}</label>
        {!disableConfirmed&&<p className="field-help">{uiText("停用按钮需先明确确认，避免误清除本地运行时配置。")}</p>}</>:
        <div className="blocked"><b>{uiText("blocked_external · 海外日志入口缺少官方契约")}</b><span>{uiText("当前不要求用户离开控制台、复制外部地址或粘贴命令。待平台提供官方日志 API、OAuth、会话交换或 webhook 合同后，再开放内部接入。")}</span></div>}
      {disableLogPage.error&&<div className="state error" role="alert">{disableLogPage.error instanceof ApiError?uiText("停用本地日志地址失败。"):uiText("操作失败")}</div>}
      <p className="notice">{uiText("保存日志页地址只允许系统进行只读采集，不会开放真实模型生成、修改平台设置或保存登录凭据。")}</p>
      <details><summary>{uiText("查看技术证据")}</summary><dl><dt>{uiText("URL SHA-256")}</dt><dd>{savedLog?.value_sha256||uiText("待确认")}</dd><dt>{uiText("浏览器验证")}</dt><dd>{labelEnum(savedLog?.browser_live_validation_status||"not_attempted")}</dd></dl></details>
    </section></>
}

function GlobalSearch(){
  const navigate=useNavigate();
  const [value,setValue]=useState("");
  const submit=()=>{const trimmed=value.trim();if(trimmed)navigate(`/search?q=${encodeURIComponent(trimmed)}`);};
  return <form className="global-search" role="search" onSubmit={event=>{event.preventDefault();submit();}}>
    <input aria-label={uiText("全局搜索关键词")} placeholder={uiText("搜索请求、渠道、模型、错误…")} value={value} onChange={e=>setValue(e.target.value)}/>
    <button type="submit" disabled={!value.trim()}>{uiText("全局搜索")}</button>
  </form>;
}
function ErrorAndBugPage({mode}:{mode:DataMode}){
  return <><ErrorCenterPage mode={mode}/><details className="panel"><summary>{uiText("从错误详情生成 Bug 报告")}</summary><BugReportsPage/></details></>;
}
function App() {
  const {locale,localeTag}=useLocale();
  const reduceMotion=useReducedMotion();
  const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('llm-gateway.theme.v1')==='dark'?'dark':'light';}catch{return 'light';}});
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('llm-gateway.theme.v1',theme);}catch{/* Optional local preference. */}},[theme]);
  const queryClient=useQueryClient();
  const location=useLocation();
  const [mode, setMode] = useState<DataMode>("uat");
  const [environmentFilter,setEnvironmentFilter]=useState<EnvironmentFilter>("china_uat");
  const [executionEnvironment,setExecutionEnvironment]=useState<EnvironmentId>("china_uat");
  const [collapsed,setCollapsed]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const lastSyncVersion=useRef("");
  const lastEnsureAt=useRef(0);
  const syncStatus=useQuery({
    queryKey:["global-log-sync-status"],
    queryFn:({signal})=>api.logSyncStatus(signal),
    refetchInterval:5000,staleTime:3000,retry:1,
    enabled:import.meta.env.MODE!=="test",
  });
  const activeGroup=navGroups.find(group=>group.items.some(([path])=>location.pathname===path||location.pathname.startsWith(`${path}/`)))?.label||"总览";
  const [expandedGroup,setExpandedGroup]=useState<string>(activeGroup);
  useEffect(()=>{setExpandedGroup(activeGroup);setMobileNav(false)},[activeGroup]);
  useEffect(()=>{
    // Shadow comparison is a real-evidence workflow. Enter it in real-data mode so
    // a stale global demo selection cannot make measured sync evidence look mocked.
    if(location.pathname==="/strategy/shadow")setMode("uat");
  },[location.pathname]);
  useEffect(()=>{
    api.setEnvironmentFilter("china_uat");
    lastEnsureAt.current=Date.now();
    void api.ensureLogSync().catch(()=>undefined);
  },[]);
  useEffect(()=>{
    const value=syncStatus.data;if(!value)return;
    const version=`${value.last_success_at||""}|${value.watermark||""}|${value.linked}|${value.synced_logs}`;
    if(lastSyncVersion.current&&lastSyncVersion.current!==version){
      void queryClient.invalidateQueries({predicate:q=>q.queryKey[0]!=="global-log-sync-status"});
    }
    lastSyncVersion.current=version;
  },[syncStatus.data,queryClient]);
  useEffect(()=>{
    const last=syncStatus.data?.last_success_at?Date.parse(syncStatus.data.last_success_at):0;
    if(Date.now()-last>60000&&Date.now()-lastEnsureAt.current>15000){
      lastEnsureAt.current=Date.now();
      void api.ensureLogSync().catch(()=>undefined);
    }
  },[location.pathname,syncStatus.data?.last_success_at]);
  const globalSyncLabel=syncStatus.data?.status==="syncing"?"正在同步新日志…":
    syncStatus.data?.login_status==="automatic_recovery_in_progress"?"正在自动恢复日志会话…":
    syncStatus.data?.last_success_at?uiText('日志已同步 · {0}',{'0':new Date(syncStatus.data.last_success_at).toLocaleTimeString(localeTag,{hour:"2-digit",minute:"2-digit"})}):
    "日志数据更新稍有延迟";
  return <MotionConfig reducedMotion="user"><div lang={locale} className={`shell console-shell ${collapsed?"nav-collapsed":""} ${mobileNav?"mobile-nav-open":""}`}><aside className="sidebar"><div className="brand"><i aria-hidden="true"><svg viewBox="0 0 36 36" width="30" height="30"><path d="M8 10L27 18L8 27M8 10V27" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="10" r="3.5" fill="currentColor"/><circle cx="27" cy="18" r="3.5" fill="currentColor"/><circle cx="8" cy="27" r="3.5" fill="currentColor"/></svg></i><div><b>{uiText("LLM Gateway")}</b><span>{uiText('Operator console')}</span></div><button className="nav-toggle" aria-label={uiText(collapsed?"展开导航":"折叠导航")} onClick={()=>setCollapsed(x=>!x)}>{collapsed?"›":"‹"}</button></div>
    <Badge tone={mode === "demo" ? "demo" : "uat"}>{mode === "demo" ? uiText("演示数据 / Demo Data") : uiText("UAT 证据 / UAT Evidence")}</Badge>
    <nav aria-label={uiText('主导航')}>{navGroups.map(group=>{const open=expandedGroup===group.label||collapsed;return <div className={`nav-group ${open?"open":""}`} key={group.label}><button type="button" className="nav-group-trigger" aria-expanded={open} title={uiText(group.label)} onClick={()=>setExpandedGroup(current=>current===group.label?"":group.label)}><span className="nav-icon" aria-hidden="true">{group.icon}</span><span>{uiText(group.label)}</span><b aria-hidden="true">⌄</b></button>{open&&<motion.div initial={reduceMotion?false:{opacity:0,y:-4}} animate={{opacity:1,y:0}} transition={{duration:.16}} className="nav-children">{group.items.map(([to,label])=><NavLink to={to} key={to} title={uiText(label)}><span>{uiText(label)}</span></NavLink>)}</motion.div>}</div>})}</nav><div className="sidebar-footer"><span className="workspace-mark" aria-hidden="true">L</span><div><b>{uiText('Local workspace')}</b><small>{uiText('Operator console')}</small></div></div></aside>
    {mobileNav&&<button className="nav-scrim" aria-label={uiText("关闭导航")} onClick={()=>setMobileNav(false)}/>}<main><header className="top"><button className="mobile-menu" aria-label={uiText("打开导航")} onClick={()=>setMobileNav(true)}>☰</button><div><label className="top-field">{uiText("环境")}<select aria-label={uiText("全局环境筛选")} value={location.pathname==="/integrations/agent-skill"?"china_uat":environmentFilter} disabled={location.pathname==="/integrations/agent-skill"} onChange={e=>{const value=e.target.value as EnvironmentFilter;setEnvironmentFilter(value);api.setEnvironmentFilter(value);queryClient.invalidateQueries();}}>{location.pathname!=="/integrations/agent-skill"&&<option value="all">{uiText("全部环境")}</option>}<option value="china_uat">{uiText("国内 UAT")}</option>{location.pathname!=="/integrations/agent-skill"&&<option value="overseas">{uiText("海外站")}</option>}</select></label><label className="top-field">{uiText("数据模式")}<select aria-label={uiText("数据来源模式")} value={location.pathname==="/integrations/agent-skill"?"uat":mode} disabled={location.pathname==="/integrations/agent-skill"} onChange={e => setMode(e.target.value as DataMode)}>{location.pathname!=="/integrations/agent-skill"&&<option value="demo">{uiText("Mock 数据")}</option>}<option value="uat">{uiText("真实数据")}</option></select></label><NavLink className={`global-sync-status ${syncStatus.data?.requires_human?"needs-attention":""}`} to="/strategy/shadow#sync-history">{uiText(globalSyncLabel)}</NavLink></div><div className="top-tools"><GlobalSearch/><button className="user-menu" title={uiText("当前 Windows 本地操作员")}>{uiText("LX · 本地操作员")}</button></div></header>
      <div className="content"><div className="presentation-controls"><LanguageSwitcher/><button type="button" className="theme-toggle secondary" aria-label={uiText(theme==='light'?'Switch to dark theme':'Switch to light theme')} title={uiText(theme==='light'?'Switch to dark theme':'Switch to light theme')} onClick={()=>setTheme(value=>value==='light'?'dark':'light')}><span aria-hidden="true">{theme==='light'?'◐':'☀'}</span></button></div><Routes>
        <Route path="/gateway" element={<GatewayWorkspacePage/>}/>
        <Route path="/search" element={<SearchPage environment={environmentFilter} mode={mode}/>} />
        <Route path="/" element={<DashboardPage mode={mode}/>}/><Route path="/dashboard" element={<DashboardPage mode={mode}/>}/>
        <Route path="/routing/execute" element={<RoutingExecutePage mode={mode} environment={executionEnvironment} onEnvironmentChange={setExecutionEnvironment}/>}/><Route path="/routing/runs" element={<RoutingRunsPage environment={executionEnvironment}/>}/>
        <Route path="/data/models" element={<ModelCatalogPage environment={executionEnvironment}/>}/><Route path="/strategy/config" element={<ConfigReviewPage/>}/><Route path="/strategy/effect" element={<StrategyEffectPage/>}/><Route path="/strategy/shadow" element={<ShadowRoutingPage mode={mode}/>}/><Route path="/data/snapshots" element={<Imports/>}/><Route path="/data/dynamic-metrics" element={<IncrementalMetricsPage environment={environmentFilter}/>}/><Route path="/data/capabilities" element={<ModelCapabilityMatrixPage/>}/><Route path="/data/pricing" element={<CostBudgetPage mode={mode} onModeChange={setMode}/>}/>
        <Route path="/reliability/channels" element={<Health mode={mode}/>}/><Route path="/reliability/circuit-breakers" element={<CircuitBreakerPage/>}/><Route path="/reliability/probes" element={<ContinuousProbeListPage/>}/><Route path="/reliability/probes/:probeRunId" element={<ContinuousProbeDetailPage/>}/>
        <Route path="/observability/overview" element={<MonitoringOverviewPage mode={mode} environment={environmentFilter}/>}/><Route path="/observability/decisions" element={<RoutingDecisionsPage/>}/><Route path="/routing/decisions/:decisionId" element={<RoutingDecisionDetailPage/>}/><Route path="/observability/replay" element={<HistoricalReplayPage/>}/><Route path="/observability/errors" element={<ErrorAndBugPage mode={mode}/>}/><Route path="/observability/performance" element={<SchedulerPerformancePage/>}/>
        <Route path="/governance/traffic" element={<TrafficGovernancePage/>}/><Route path="/integrations/agent-skill" element={<AgentSkillManagementPage/>}/><Route path="/acceptance" element={<AcceptanceCenterPage/>}/>
        <Route path="/settings/environments" element={<EnvironmentSettings onSelectEnvironment={setEnvironmentFilter}/>}/><Route path="/settings/security" element={<UatExecution environment={executionEnvironment} onEnvironmentChange={setExecutionEnvironment}/>}/><Route path="/settings/budget" element={<CostBudgetPage mode={mode} onModeChange={setMode}/>}/>
        <Route path="/uat-execution" element={<UatExecution environment={executionEnvironment} onEnvironmentChange={setExecutionEnvironment}/>}/><Route path="/collector" element={<RealtimeLogSyncPage environment={environmentFilter} />} /><Route path="/imports" element={<Imports/>}/><Route path="/metrics" element={<IncrementalMetricsPage environment={environmentFilter}/>}/><Route path="/health" element={<Navigate to="/reliability/channels" replace/>}/>
        <Route path="/sticky-routing" element={<StickyRoutingPage environment={environmentFilter}/>} />
        <Route path="/safety-governance" element={<SafetyGovernancePage/>} />
        <Route path="/shadow" element={<Navigate to="/strategy/shadow" replace/>}/><Route path="/replay" element={<Navigate to="/observability/replay" replace/>}/><Route path="/errors" element={<Navigate to="/observability/errors" replace/>}/><Route path="/bugs" element={<Navigate to="/observability/errors?tab=bug-report" replace/>}/><Route path="/budgets" element={<Navigate to="/settings/budget" replace/>}/><Route path="/mappings" element={<Navigate to="/data/capabilities" replace/>}/><Route path="/environment-settings" element={<Navigate to="/settings/environments" replace/>}/><Route path="/compatibility" element={<CompatibilityPage mode={mode} />}/>
        <Route path="/config-review" element={<ConfigReviewPage />} /><Route path="/exports" element={<ReportsPage mode={mode} />} /><Route path="/about" element={<SystemDescriptionPage />} />
        {import.meta.env.DEV && <Route path="/__visual-test" element={<VisualTestPage />} />}
      </Routes></div></main>
  </div></MotionConfig>;
}
export default App;
