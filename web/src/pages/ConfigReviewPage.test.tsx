// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import ConfigReviewPage from "./ConfigReviewPage";
import {api,ConfigReviewResult} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,configReview:vi.fn()}};
});

const version={configuration_version:"decision-policy-v2.0.0",revision:1,policy_version:"decision-policy-v2.0.0",
  retry_policy_version:"retry-v2.0.0",source_type:"current_persisted_configuration",source_sha256:"A".repeat(64),
  created_at:"2026-08-05T01:00:00Z",created_by:"system_baseline",change_reason:"真实基线",previous_version:null,
  checksum:"B".repeat(64),is_active:true,payload:{timeout:10},diff:{}};
const base:ConfigReviewResult={
  status:"ready",empty_message:null,environment_id:"china_uat",is_mock:false,
  data_source:{sources:[{source:"realtime_execution",count:1}],time_from:"2026-08-05T01:00:00Z",time_to:"2026-08-05T02:00:00Z",sample_count:1,raw_count:2,deduplicated_count:1,exact_duplicate_count:1,duplicate_candidate_count:0,exact_link_count:1,channel_coverage_count:1,channel_coverage_rate:1,last_synced_at:"2026-08-05T02:00:01Z",configuration_version:version.configuration_version,price_version:null,price_synced_at:null,metric_snapshot_id:null,metric_generated_at:null},
  configuration:{policy_version:"decision-policy-v2.0.0",strategies:[],fallback_configured:true,timeout_ms:10000,maximum_attempts:2,retry_policy_version:"retry-v2.0.0",retryable_errors:["timeout"]},
  metrics:{sample_count:1,success_rate:1,p95_latency_ms:800,p99_latency_ms:800,input_tokens:20,output_tokens:10,total_cost:"0.01",average_cost:"0.01",cost_coverage:1,timeout_count:0,retry_count:0,fallback_count:0,concentration:{hhi:1,maximum_share:1,channel_count:1,sample_count:1,basis:"权威渠道"},model_metrics:[]},
  versions:[version],selected_versions:{baseline:version.configuration_version,comparison:version.configuration_version},configuration_diff:{},
  risks:[{risk:"请求超时",status:"已配置",observed_count:0,basis:"真实日志"}],
  impact:{status:"unavailable",current_version:version.configuration_version,previous_version:version.configuration_version,current:null,previous:null,cost_difference:null,latency_difference_ms:null,concentration_difference:null,basis:"只有一个真实版本"},
  rollback:{status:"unavailable",target_version:null,message:"只有一个真实版本"},
  evidence:[{occurred_at:"2026-08-05T02:00:00Z",request_id:"REQ-LIVE",decision_id:"DEC-LIVE",model:"model-live",channel_id:"channel-live",channel_source:"scheduler_decision",status:"SUCCESS",latency_ms:800,cost_amount:"0.01",currency:"CNY",configuration_version:version.configuration_version}],
  technical:{schema_version:"real_config_review_v2"},
};

function renderPage(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ConfigReviewPage/></QueryClientProvider>)}

describe("real configuration review",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("shows deduplicated real metrics, channel provenance and identifiers",async()=>{
    vi.mocked(api.configReview).mockResolvedValue(base);renderPage();
    expect(await screen.findByText("真实日志指标")).toBeInTheDocument();
    expect(screen.getByText("REQ-LIVE")).toBeInTheDocument();
    expect(screen.getByText(/scheduler_decision/)).toBeInTheDocument();
    expect(screen.getByText("2 / 1")).toBeInTheDocument();
  });
  it("does not invent conclusions when real logs are absent",async()=>{
    vi.mocked(api.configReview).mockResolvedValue({...base,status:"insufficient_data",empty_message:"暂无真实日志，无法完成评审。",data_source:{...base.data_source,sources:[],sample_count:0,raw_count:0,deduplicated_count:0,time_from:null,time_to:null,last_synced_at:null},metrics:{...base.metrics,sample_count:0,success_rate:null,p95_latency_ms:null,p99_latency_ms:null,total_cost:null,average_cost:null,cost_coverage:null,model_metrics:[]},risks:[],evidence:[]});renderPage();
    expect(await screen.findByText("暂无真实日志，无法完成评审")).toBeInTheDocument();
    expect(screen.queryByText("真实日志指标")).not.toBeInTheDocument();
  });
  it("polls every five seconds for new persisted calls",async()=>{
    vi.mocked(api.configReview).mockResolvedValueOnce(base).mockResolvedValue({...base,data_source:{...base.data_source,deduplicated_count:2,sample_count:2,sources:[{source:"realtime_execution",count:2}]},metrics:{...base.metrics,sample_count:2}});renderPage();
    expect(await screen.findByText("实时执行 1")).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByText("实时执行 2")).toBeInTheDocument(),{timeout:6500});
    expect(api.configReview).toHaveBeenCalledTimes(2);
  },8000);
});
