// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {AgentSkillPage,CircuitBreakerPage,MonitoringOverviewPage,ProbeTasksPage,SchedulerPerformancePage,TrafficGovernancePage} from "./OperationalClosurePages";
import {api} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,overview:vi.fn(),metricSnapshots:vi.fn(),circuitBreakerStatus:vi.fn(),
    callLogAnalytics:vi.fn(),observabilityOverview:vi.fn(),
    circuitBreakerTransitions:vi.fn(),recordCircuitEvent:vi.fn(),trafficChangeStatus:vi.fn(),
    proposeTrafficChange:vi.fn(),approveTrafficChange:vi.fn(),activateTrafficChange:vi.fn(),
    terminateTrafficChange:vi.fn(),trafficControlCurrent:vi.fn(),trafficControlChannels:vi.fn(),
    trafficControlProposals:vi.fn(),trafficControlImpact:vi.fn(),createTrafficControlProposal:vi.fn(),
    deleteTrafficControlProposal:vi.fn(),trafficControlAction:vi.fn(),approveTrafficControlProposal:vi.fn(),
    rejectTrafficControlProposal:vi.fn(),activateTrafficControlProposal:vi.fn(),adjustTrafficControlProposal:vi.fn(),
    rollbackTrafficControlProposal:vi.fn(),trafficControlMetrics:vi.fn(),trafficControlAudit:vi.fn(),
    uatModels:vi.fn(),configReview:vi.fn(),formalAgentSkillDiscovery:vi.fn(),formalAgentSkillStatus:vi.fn(),
    invokeFormalAgentSkill:vi.fn(),probeTasks:vi.fn(),probeGovernanceStatus:vi.fn(),
    createProbeTask:vi.fn(),startProbeTask:vi.fn(),stopProbeTask:vi.fn(),schedulerPerformance:vi.fn()}};
});

function show(node:React.ReactNode){
  const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<MemoryRouter><QueryClientProvider client={queryClient}>{node}</QueryClientProvider></MemoryRouter>);
}

describe("operational closure pages",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.mocked(api.overview).mockResolvedValue({records:2,sample_size:2,channels:1,errors:0,
      last_updated:"2026-08-04T01:00:00Z",source_type:"measured_uat",warnings:[],
      routing_distribution:{"channel-a":2},budget:{today_uat_spend:0.12}} as never);
    vi.mocked(api.callLogAnalytics).mockResolvedValue({status:"ready",schema_version:"standardized_call_log_v1",
      environment_id:"china_uat",request_count:646,success_count:645,failure_count:1,success_rate:645/646,
      total_latency_ms:4393000,average_latency_ms:6800.31,p50_latency_ms:2000,p95_latency_ms:24000,
      p99_latency_ms:43600,average_first_token_latency_ms:113.333,input_tokens:9453,
      cached_input_tokens:3704,output_tokens:68318,total_cost:"13.256422",currency:"CNY",
      average_cost:"0.020520777",stream_count:15,nonstream_count:631,model_mismatch_count:80,
      model_counts:{"deepseek-v4-flash":270},model_costs:{"deepseek-v4-flash":"1.00"},
      error_categories:{historical_platform_error:1},retry_count:0,fallback_count:0,
      today_request_count:0,today_tokens:0,today_cost:"0",trend:[
        {date:"2026-07-29",request_count:396,success_rate:395/396,average_latency_ms:7100,total_tokens:51000,total_cost:"8.500000",currency:"CNY"},
        {date:"2026-07-30",request_count:250,success_rate:1,average_latency_ms:6300,total_tokens:26771,total_cost:"4.756422",currency:"CNY"}],
      generated_at:"2026-08-05T01:00:00Z"});
    vi.mocked(api.observabilityOverview).mockResolvedValue({
      scope:{environment_id:"china_uat",time_range:"24h",start:"2026-08-05T00:00:00Z",end:"2026-08-06T00:00:00Z",traffic_class:"business",model_id:null,stream:null,source_type:"all"},
      filters:{models:["deepseek-v4-flash"]},kpis:{requests:646,success_rate:645/646,p50_ms:2000,p95_ms:24000,p99_ms:43600,ttft_p95_ms:250,tokens:77771,actual_cost:"13.256422",latency_coverage:646,ttft_coverage:15,token_coverage:646,cost_coverage:646,deltas:{requests:null,success_rate:null,p95_ms:null,ttft_p95_ms:null,tokens:null},provider_actual_cost:null,historical_actual_cost:"13.256422",estimated_cost:null,pending_cost_count:0},
      request_series:[{time:"2026-08-05T01:00:00Z",business:646,probe:0,requests:646,success_rate:645/646}],
      latency_series:[{time:"2026-08-05T01:00:00Z",p50_ms:2000,p95_ms:24000,p99_ms:43600,ttft_p95_ms:250}],
      token_series:[{time:"2026-08-05T01:00:00Z",input_tokens:9453,cached_tokens:3704,output_tokens:68318}],
      cost_series:[{time:"2026-08-05T01:00:00Z",provider_actual:null,historical_actual:"13.256422",estimated:null,pending:0}],
      model_distribution:[{model_id:"deepseek-v4-flash",request_count:270,success_rate:1,p95_ms:1000,tokens:20000,cost:"1.0",source_types:["historical_uat_csv"]}],
      stream_distribution:{stream:15,nonstream_completion:631,non_completion:0},error_distribution:[{code:"historical_platform_error",count:1}],
      reliability:{fallback_rate:0,retry_rate:0,open_count:0,half_open_count:0,active_probes:0,timeline:[]},
      freshness:{watermark:650,last_synced_at:"2026-08-05T01:00:00Z",source_counts:{historical_uat_csv:646,realtime_execution:4},provider_log_status:"ready"},
      coverage:{records:646,latency:646,ttft:15,tokens:646,actual_cost:646},recent_records:[{occurred_at:"2026-08-05T01:00:00Z",traffic_class:"business",model_id:"deepseek-v4-flash",status:"SUCCESS",total_latency_ms:1000,first_token_ms:null,tokens:20,cost:"0.001",cost_type:"actual_provider_cost",request_id:"REQ-REAL-123456",decision_id:"DEC-REAL-123456",error_category:null}],generated_at:"2026-08-05T01:00:00Z"});
    vi.mocked(api.metricSnapshots).mockResolvedValue({status:"ready",aggregation_version:"metrics-v1",
      source_watermark:"EV-2",last_refresh_at:"2026-08-04T01:00:00Z",event_count:2,total:1,
      limit:100,offset:0,has_more:false,source_contract:"immutable",network_called:false,
      refresh_runtime:{last_started_at:null,last_completed_at:null,last_status:"ready",last_error_code:null,consecutive_failures:0},
      items:[{snapshot_id:"MS-1",aggregation_version:"metrics-v1",window_name:"1h",window_seconds:3600,
        environment_id:"china_uat",model:"model-a",channel:"channel-a",stream:false,request_profile_id:"P01",
        currency:"CNY",window_start:"2026-08-04T00:00:00Z",window_end:"2026-08-04T01:00:00Z",
        generated_at:"2026-08-04T01:00:00Z",last_evidence_at:"2026-08-04T00:59:00Z",evidence_age_seconds:60,
        freshness_status:"fresh",data_state:"healthy_evidence",sample_count:2,source_watermark:"EV-2",
        metrics:{success_rate:1,latency_p50_ms:100,latency_p95_ms:140,latency_p99_ms:150,ttft_p50_ms:null,
          ttft_p95_ms:null,ttft_p99_ms:null,tpot_p50_ms:null,tpot_p95_ms:null,tpot_p99_ms:null,http_429_rate:0,
          http_5xx_rate:0,timeout_rate:0,incomplete_sse_rate:0,average_estimated_cost:0.06,estimated_cost_p95:0.07,
          average_actual_cost:0.06,actual_cost_p95:0.07,model_mapping_anomaly_rate:0,fallback_rate:0,
          schedulability_rate:1,missing_field_count:0,average_source_reliability:1,source_type_counts:{measured_uat:2},contains_mock:false}}]});
    vi.mocked(api.circuitBreakerStatus).mockResolvedValue({status:"ready",policy_version:"cb-v1",enabled:true,
      state_counts:{CLOSED:1,OPEN:0,HALF_OPEN:0},active_probe_leases:0,items:[],network_called:false});
    vi.mocked(api.circuitBreakerTransitions).mockResolvedValue({status:"ready",state:{},items:[],network_called:false});
    vi.mocked(api.trafficChangeStatus).mockResolvedValue({status:"disabled",capability_id:"ADV-017",enabled:false,
      mode:"offline_sandbox",real_execution_allowed:false,policy_version:"traffic-v1",state_counts:{},
      maximum_rollout_percent:10,required_gates:["health","confidence","budget","circuit"],
      authorization_status:"required",network_called:false,kill_switches:[],items:[]});
    vi.mocked(api.trafficControlCurrent).mockResolvedValue({status:"ready",environment_id:"china_uat",
      current_mode:"sandbox_validation",production_execution:"not_configured",policy_version:"policy-v2",
      configuration_version:"config-v2",current_model_id:"model-old",current_channel_id:"channel-old",
      channel_evidence_available:true,data_updated_at:"2026-08-05T10:00:00Z",traffic_distribution:[],
      metrics_24h:{request_count:20,success_rate:.95,error_rate:.05,p50_latency_ms:800,p95_latency_ms:1200,
        p99_latency_ms:1600,token_count:1000,total_cost:.12,average_cost:.006,fallback_rate:.05,
        coverage:{latency:1,cost:1},latest_at:"2026-08-05T10:00:00Z"},network_called:false});
    vi.mocked(api.trafficControlChannels).mockResolvedValue({status:"ready",items:[{channel_id:"channel-real",
      channel_name:"真实渠道",channel_source:"scheduler_decision",models:["model-target"],
      last_seen_at:"2026-08-05T10:00:00Z",sample_count:12}],total:1,network_called:false});
    vi.mocked(api.trafficControlProposals).mockResolvedValue({status:"ready",items:[],total:0,network_called:false});
    vi.mocked(api.uatModels).mockResolvedValue({source:"remote_model_endpoint",fetched_at:"2026-08-05T10:00:00Z",
      model_count:1,models:[{id:"model-target",display_name:"model-target",owned_by:"provider-a",
        execution_allowed:true,stream_capability:"pending_confirmation"}]});
    vi.mocked(api.configReview).mockResolvedValue({versions:[{configuration_version:"config-v2",revision:2,
      policy_version:"policy-v2",retry_policy_version:null,source_type:"runtime",source_sha256:"a",created_at:"2026-08-05T10:00:00Z",
      created_by:"operator",change_reason:"baseline",previous_version:null,checksum:"a",is_active:true,payload:{},diff:{}}]} as never);
    vi.mocked(api.trafficControlImpact).mockResolvedValue({status:"ready",
      baseline:{request_count:20,success_rate:.95,error_rate:.05,p50_latency_ms:800,p95_latency_ms:1200,p99_latency_ms:1600,
        token_count:1000,total_cost:.12,average_cost:.006,fallback_rate:.05,coverage:{latency:1,cost:1},latest_at:"2026-08-05T10:00:00Z"},
      target:{request_count:12,success_rate:1,error_rate:0,p50_latency_ms:700,p95_latency_ms:1000,p99_latency_ms:1300,
        token_count:700,total_cost:.06,average_cost:.005,fallback_rate:0,coverage:{latency:1,cost:1},latest_at:"2026-08-05T10:00:00Z"},
      difference:{success_rate:.05,p95_latency_ms:-200,average_cost:-.001,fallback_rate:-.05},coverage_rate:.6,
      channel_concentration:1,limitations:[],calculation_basis:"真实日志"});
    vi.mocked(api.formalAgentSkillDiscovery).mockResolvedValue({registry_version:"skills-v1",skill_count:1,
      host_deployment_status:"repository_harness_only",network_called:false,
      skills:[{skill_id:"inspect-circuit-breaker",version:"1",binding:"circuit_breaker.read",read_only:true,artifact_sha256:"a".repeat(64)}]});
    vi.mocked(api.formalAgentSkillStatus).mockResolvedValue({status:"ready",registered_skill_count:1,
      browser_invocation_allowed:false,grant_issuance_allowed:false,host_deployment_status:"repository_harness_only",network_called:false});
    vi.mocked(api.probeGovernanceStatus).mockResolvedValue({status:"mock_only",capability_id:"ADV-018",enabled:true,
      mode:"mock_only",live_execution_allowed:false,policy_version:"probe-v1",state_counts:{},active_approval_count:0,
      active_lease_count:0,limits:{channel:{requests:20,cost:2,rate_per_minute:5,burst:2,concurrency:1}},
      backoff_policy:{},stop_policy:{},authorization_status:"local",kill_switches:[],stopped_scopes:[],items:[],network_called:false});
    vi.mocked(api.schedulerPerformance).mockResolvedValue({scope:{environment_id:"china_uat",window_minutes:1440,
      start:"2026-08-05T00:00:00Z",end:"2026-08-06T00:00:00Z",traffic_class:"business",strategy_id:null,model_id:null,stream:null},
      kpis:{request_count:1,scheduler_p50_ms:8,scheduler_p95_ms:8,scheduler_p99_ms:8,scheduler_end_to_end_ratio:.01,largest_stage:"scoring"},
      stage_series:[{time:"2026-08-06T00:00:00Z",request_id:"REQ-1",scoring:3}],latency_series:[{time:"2026-08-06T00:00:00Z",p50_ms:8,p95_ms:8,p99_ms:8}],
      stage_distribution:[{stage:"scoring",average_ms:3,p95_ms:3,sample_count:1,share:.5}],provider_comparison:[{time:"2026-08-06T00:00:00Z",request_id:"REQ-1",scheduler_ms:8,provider_ms:800,end_to_end_ms:810}],
      strategy_comparison:[{strategy_id:"baseline",sample_count:1,p50_ms:8,p95_ms:8,average_candidate_count:5,average_filtered_count:2,average_scoring_ms:3}],
      recent_records:[{local_request_id:"REQ-1",provider_request_id:"PR-1",decision_id:"DEC-1",occurred_at:"2026-08-06T00:00:00Z",strategy_id:"baseline",model_id:"kimi-k2.6",candidate_count:5,filtered_count:2,scheduler_total_ms:8,provider_latency_ms:800,end_to_end_ms:810,success:1,stream:0,traffic_class:"business",source_type:"realtime_execution",error_category:null}],
      freshness:{generated_at:"2026-08-06T00:00:01Z",latest_record_at:"2026-08-06T00:00:00Z"},coverage:{scheduler_samples:1,provider_samples:1,end_to_end_samples:1,source_types:["realtime_execution"]}});
    vi.mocked(api.probeTasks).mockResolvedValue({status:"ready",mode:"mock_only",items:[],total:0,network_called:false});
  });

  it("renders monitoring from persisted APIs and shows an API failure",async()=>{
    const first=show(<MonitoringOverviewPage mode="uat" environment="china_uat"/>);
    expect((await screen.findAllByText("99.8%")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("24,000 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("¥13.256422").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("请求量与成功率")).toBeInTheDocument();
    expect(screen.getByText("历史平台错误")).toBeInTheDocument();
    expect(screen.queryByText("historical_platform_error")).not.toBeInTheDocument();
    first.unmount();
    vi.mocked(api.observabilityOverview).mockRejectedValueOnce(new Error("backend unavailable"));
    show(<MonitoringOverviewPage mode="uat" environment="overseas"/>);
    expect(await screen.findByText("监控数据读取失败")).toBeInTheDocument();
  });

  it("creates and starts a persisted mock probe and surfaces a safety rejection",async()=>{
    vi.mocked(api.createProbeTask).mockResolvedValue({task_id:"PT-1",name:"健康探测",environment_id:"china_uat",
      channel_id:"channel-a",model_id:"model-a",request_template:"mock_success",frequency_seconds:12,max_requests:2,
      used_requests:0,max_concurrency:1,deadline:"2026-08-05T12:00:00Z",stop_condition:"request_limit",state:"DRAFT",
      last_result:null,last_run_at:null,next_run_at:null,created_at:"2026-08-05T11:00:00Z",started_at:null,stopped_at:null,
      transport:"mock",network_called:false});
    const user=userEvent.setup();show(<ProbeTasksPage/>);
    const fields=screen.getAllByRole("textbox");
    await user.type(fields[0],"健康探测");await user.type(fields[1],"channel-a");await user.type(fields[2],"model-a");
    const numbers=screen.getAllByRole("spinbutton");
    await user.type(numbers[0],"12");await user.type(numbers[1],"2");await user.type(numbers[2],"1");
    fireEvent.change(screen.getByLabelText("截止时间"),{target:{value:"2026-08-05T19:00"}});
    await user.click(screen.getByRole("button",{name:"创建本地任务"}));
    expect(api.createProbeTask).toHaveBeenCalledWith(expect.objectContaining({channel_id:"channel-a",frequency_seconds:12}));
    vi.mocked(api.createProbeTask).mockRejectedValueOnce(new Error("超出本地安全边界"));
    await user.click(screen.getByRole("button",{name:"创建本地任务"}));
    expect(await screen.findByText("探测任务操作被拒绝")).toBeInTheDocument();
  });

  it("executes and reports a rejected circuit event",async()=>{
    vi.mocked(api.recordCircuitEvent).mockResolvedValueOnce({status:"accepted",result:{state:"CLOSED"},network_called:false});
    const user=userEvent.setup();show(<CircuitBreakerPage/>);
    await user.type(screen.getByPlaceholderText("例如 channel-a:model-x"),"channel-a:model-a");
    await user.click(screen.getByRole("button",{name:"记录失败"}));
    expect(api.recordCircuitEvent).toHaveBeenCalledWith("channel-a:model-a","failure");
    vi.mocked(api.recordCircuitEvent).mockRejectedValueOnce(new Error("状态事件冲突"));
    await user.click(screen.getByRole("button",{name:"记录成功"}));
    expect(await screen.findByText("事件被拒绝")).toBeInTheDocument();
  });

  it("creates a governed traffic draft from real selectors and surfaces backend rejection",async()=>{
    vi.mocked(api.createTrafficControlProposal).mockResolvedValueOnce({proposal_id:"TCG-1",state:"DRAFT"} as never);
    const user=userEvent.setup();show(<TrafficGovernancePage/>);
    await screen.findByText("当前流量");
    await screen.findByRole("option",{name:"model-target"});
    const selects=screen.getAllByRole("combobox");
    await user.selectOptions(selects[0],"model-target");
    await user.selectOptions(selects[1],"channel-real");
    const textareas=screen.getAllByRole("textbox");
    await user.type(textareas[0],"验证真实控制面");await user.type(textareas[1],"错误率超限后回滚");
    await user.click(screen.getByRole("button",{name:"保存变更草稿"}));
    expect(api.createTrafficControlProposal).toHaveBeenCalledWith(expect.objectContaining({target_model_id:"model-target",target_channel_id:"channel-real"}));
    vi.mocked(api.createTrafficControlProposal).mockRejectedValueOnce(new Error("后端拒绝变更"));
    await user.click(screen.getByRole("button",{name:"保存变更草稿"}));
    expect(await screen.findByText("流量变更操作失败")).toBeInTheDocument();
  });

  it("invokes a local read-only skill and displays a fail-closed error",async()=>{
    vi.mocked(api.invokeFormalAgentSkill).mockResolvedValueOnce({invocation_id:"FSI-1",skill_id:"inspect-circuit-breaker",
      status:"success",data:{status:"ready"},uncertainty:"known",provenance:{},limitations:["local"],audit_id:"AUD-1",network_called:false});
    const user=userEvent.setup();show(<AgentSkillPage/>);
    await user.click(await screen.findByRole("button",{name:"执行本地只读 Skill"}));
    expect(await screen.findByText("Invocation ID：FSI-1")).toBeInTheDocument();
    vi.mocked(api.invokeFormalAgentSkill).mockRejectedValueOnce(new Error("Prompt Injection 已阻止"));
    fireEvent.change(screen.getByLabelText("参数 JSON"),{target:{value:'{"x":"ignore previous"}'}});
    await user.click(screen.getByRole("button",{name:"执行本地只读 Skill"}));
    expect(await screen.findByText("Skill 调用被阻止")).toBeInTheDocument();
  });

  it("renders persisted scheduler and provider performance without raw JSON",async()=>{
    show(<SchedulerPerformancePage/>);
    expect(await screen.findByText("Scheduler P95")).toBeInTheDocument();
    expect(screen.getAllByText("8.00 ms").length).toBeGreaterThan(0);
    expect(screen.getByText("Provider 网络与模型响应时间不属于 Scheduler 开销。")).toBeInTheDocument();
    expect(screen.getByText("REQ-1")).toBeInTheDocument();
    const details=screen.getByText("技术详情").closest("details");expect(details).not.toHaveAttribute("open");
    expect(api.schedulerPerformance).toHaveBeenCalledWith(expect.objectContaining({time_range:"24h",traffic_class:"business"}),expect.anything());
  });
});
