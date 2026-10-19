import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import SafetyGovernancePage from "./SafetyGovernancePage";
import {api} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,circuitBreakerStatus:vi.fn(),explorationStatus:vi.fn(),
    capabilityEvidence:vi.fn(),trafficChangeStatus:vi.fn(),probeGovernanceStatus:vi.fn(),
    highCostTestStatus:vi.fn(),safetyGovernanceTimeline:vi.fn(),formalAgentSkillDiscovery:vi.fn(),
    formalAgentSkillStatus:vi.fn(),schedulerAttribution:vi.fn(),priceStatus:vi.fn(),priceAudit:vi.fn(),
    schedulerOverhead:vi.fn(),decisionReconstruction:vi.fn()}};
});

function show(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><SafetyGovernancePage/></QueryClientProvider>);
}

describe("SafetyGovernancePage",()=>{
  beforeEach(()=>{
    vi.mocked(api.circuitBreakerStatus).mockResolvedValue({status:"ready",policy_version:"cb-v1",enabled:true,
      state_counts:{CLOSED:1,OPEN:0,HALF_OPEN:0},active_probe_leases:0,network_called:false,items:[]});
    vi.mocked(api.explorationStatus).mockResolvedValue({status:"blocked",mode:"shadow_only",feature_enabled:false,
      real_execution_allowed:false,policy_version:"explore-v1",approvals:[],kill_switches:[],usage:{requests:0,cost:0},
      budgets:{},stop_policy:{},allowed_circuit_states:["CLOSED"],decisions:[],authorization_status:"required",network_called:false});
    vi.mocked(api.capabilityEvidence).mockResolvedValue({status:"pending_confirmation",policy_version:"cap-v1",
      registry_version:"1",fixed_scenarios:{},media_bounds:{},network_called:false,items:[]});
    vi.mocked(api.trafficChangeStatus).mockResolvedValue({status:"disabled",capability_id:"ADV-017",enabled:false,
      mode:"offline_sandbox",real_execution_allowed:false,policy_version:"f-v1",state_counts:{},maximum_rollout_percent:10,
      required_gates:["health","circuit"],authorization_status:"required",kill_switches:[],items:[],network_called:false});
    vi.mocked(api.probeGovernanceStatus).mockResolvedValue({status:"disabled",capability_id:"ADV-018",enabled:false,
      mode:"mock_only",live_execution_allowed:false,policy_version:"g-v1",state_counts:{},active_approval_count:0,
      active_lease_count:0,limits:{},backoff_policy:{},stop_policy:{},authorization_status:"required",kill_switches:[],
      stopped_scopes:[],items:[],network_called:false});
    vi.mocked(api.highCostTestStatus).mockResolvedValue({status:"disabled",capability_id:"ADV-019",enabled:false,
      mode:"mock_only",real_execution_allowed:false,policy_version:"h-v1",state_counts:{},known_currencies:["CNY","USD"],
      limits:{},reserved_by_currency:{},authorization_status:"required",kill_switches:[],items:[],network_called:false});
    vi.mocked(api.safetyGovernanceTimeline).mockResolvedValue({status:"empty",series:[],latest_event_at:null,
      freshness_status:"unknown",stale_after_seconds:86400,scheduler_overhead:{status:"pending_confirmation",sample_count:0,
        reason:"not_integrated"},permission_boundary:"read_only_monitoring",generated_demo_points:false,network_called:false});
    vi.mocked(api.formalAgentSkillDiscovery).mockResolvedValue({registry_version:"skills-v1",skill_count:8,
      host_deployment_status:"repository_harness_only",network_called:false,skills:[]});
    vi.mocked(api.formalAgentSkillStatus).mockResolvedValue({status:"ready",registered_skill_count:8,
      browser_invocation_allowed:false,grant_issuance_allowed:false,host_deployment_status:"repository_harness_only",network_called:false});
    vi.mocked(api.schedulerAttribution).mockResolvedValue({status:"ready",total:1,network_called:false,items:[{
      decision_id:"DEC-1",status:"authoritative_execution_attribution_missing",authoritative_actual_channel:null,
      event_count:0,execution_events:[],scheduler_decision:{run_id:"RUN-1",request_id:"REQ-1",selected_target_id:"C1",
        selected_channel_id:"19",model_id:"model",policy_version:"p1",metric_snapshot_ids:[],confidence_snapshot_ids:[],
        downstream_correlation_id:null,execution_status:"decision_only"}}]});
    vi.mocked(api.priceStatus).mockResolvedValue({status:"unavailable",source_id:"approved_price_api",catalog_version:null,
      record_count:0,last_error_code:"catalog_missing",network_called:false});
    vi.mocked(api.priceAudit).mockResolvedValue({status:"ready",items:[],network_called:false});
    vi.mocked(api.schedulerOverhead).mockResolvedValue({status:"never_measured",window_minutes:60,sample_count:0,
      cold_start_sample_count:0,stages:[],provider_latency_included:false,network_called:false,
      metric_definition:"scheduler_compute_and_local_persistence_only",excluded_time:["provider_network_latency"],percentiles:["p50","p95","p99"]});
    vi.mocked(api.decisionReconstruction).mockResolvedValue({status:"blocked",reason:"decision_reconstruction_fields_missing",
      decision_id:"DEC-1",missing_fields:["candidate_ranking"],network_called:false});
  });

  it("shows correct Chinese and explicit fail-closed states",async()=>{
    show();
    expect(screen.getByText("正在读取安全治理状态…")).toBeInTheDocument();
    expect(await screen.findByText("价格目录不可用，成本门控保持阻止。")).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:"安全治理与执行归因"})).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:/ADV-017/})).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:/ADV-018/})).toBeInTheDocument();
    expect(screen.getByRole("heading",{name:/ADV-019/})).toBeInTheDocument();
    expect(screen.getAllByText("默认禁用").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("尚无 Scheduler 开销样本")).toBeInTheDocument();
    expect(screen.getByText("能力证据待确认（阻止）")).toBeInTheDocument();
    expect(await screen.findByText("决策重建被阻止")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[锛銆绱姝]/);
    expect(screen.queryByText(/raw json/i)).not.toBeInTheDocument();
  });

  it("renders price audit, overhead percentiles, candidates, fallback, attempts and provenance",async()=>{
    vi.mocked(api.priceStatus).mockResolvedValueOnce({status:"fresh",source_id:"approved_price_api",catalog_version:"PC-V1",
      record_count:12,fetched_at:"2026-08-01T00:00:00Z",network_called:false,automatic_sync_state:"manual_approved",
      scheduler_consumption:"fresh_exact_scope_only"});
    vi.mocked(api.priceAudit).mockResolvedValueOnce({status:"ready",network_called:false,items:[{audit_id:"PA-1",
      event_type:"catalog_activated",source_id:"approved_price_api",created_at:"2026-08-01T00:00:00Z",details:{}}]});
    vi.mocked(api.schedulerOverhead).mockResolvedValueOnce({status:"ready",window_minutes:60,sample_count:8,
      cold_start_sample_count:1,provider_latency_included:false,network_called:false,
      metric_definition:"scheduler_compute_and_local_persistence_only",excluded_time:["provider_network_latency"],
      percentiles:["p50","p95","p99"],stages:[{stage:"scheduler_total",sample_count:8,p50_ms:12,p95_ms:20,p99_ms:24,max_ms:25}]});
    vi.mocked(api.decisionReconstruction).mockResolvedValueOnce({status:"ready",schema_version:"decision_reconstruction_v1",
      decision_id:"DEC-1",run_id:"RUN-1",request_id:"REQ-1",network_called:false,
      policy_binding:{runtime_version:"RT-V1",catalog_version:"PC-V1",catalog_sha256:"catalog-hash",
        decision_policy_version:"DP-V1",metric_snapshot_ids:["MS-1"],confidence_snapshot_ids:["CS-1"]},
      candidate_evaluation:{candidate_count:2,eligible_count:1,excluded_count:1,selected_target_id:"candidate-a",
        selected_channel_id:"channel-a",fallback_order:["candidate-a","candidate-b"],excluded_candidates:[],
        candidate_ranking:[{candidate_id:"candidate-a",channel_id:"channel-a",rank:1,eligible:true,final_score:0.9},
          {candidate_id:"candidate-b",channel_id:"channel-b",rank:null,eligible:false,exclusion_reason:"stale_metrics"}]},
      execution_trace:{execution_attempted:true,execution_status:"succeeded",fallback_executed:false,fallback_trace:[],
        attempts:[{attempt_number:1,candidate_id:"candidate-a",channel_id:"channel-a",result:"success",latency_ms:5,network_called:false}],network_called:false},
      runtime_record_sha256:"runtime-hash",reconstruction_sha256:"reconstruction-hash"});
    show();
    expect(await screen.findByText(/价格目录新鲜/)).toBeInTheDocument();
    expect(screen.getAllByText("PC-V1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("catalog_activated")).toBeInTheDocument();
    expect(screen.getAllByText("Scheduler 总计").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("12.00 ms")).toBeInTheDocument();
    expect((await screen.findAllByText("candidate-a")).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("stale_metrics")).toBeInTheDocument();
    expect(screen.getByText("RT-V1")).toBeInTheDocument();
    expect(screen.getByText("runtime-hash")).toBeInTheDocument();
  });

  it("keeps stale and missing reconstruction data visibly blocked",async()=>{
    vi.mocked(api.priceStatus).mockResolvedValueOnce({status:"stale",source_id:"approved_price_api",catalog_version:"PC-OLD",
      record_count:4,fetched_at:"2025-01-01T00:00:00Z",network_called:false});
    show();
    expect(await screen.findByText("价格目录陈旧，成本门控保持阻止。")).toBeInTheDocument();
    expect(await screen.findByText(/缺失字段：candidate_ranking/)).toBeInTheDocument();
    expect(screen.queryByText("0.00 ms")).not.toBeInTheDocument();
  });

  it("renders an accessible fail-closed error with retry",async()=>{
    vi.mocked(api.trafficChangeStatus).mockRejectedValueOnce(new Error("offline"));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("安全治理状态读取失败");
    expect(screen.getByRole("button",{name:"重新读取"})).toBeEnabled();
  });
});
