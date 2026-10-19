// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import "@testing-library/jest-dom/vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach,describe,expect,test,vi} from "vitest";
import HistoricalReplayPage from "./HistoricalReplayPage";
import {api,HistoricalReplayResult,HistoricalReplaySource} from "../services/api";

const source:HistoricalReplaySource={schema_version:"historical_replay_v1",environment_id:"china_uat",source_type:"real_uat_call_logs",is_mock:false,sample_count:3,exact_association_count:3,unlinked_count:0,occurred_from:"2026-08-05T01:00:00Z",occurred_to:"2026-08-05T02:00:00Z",last_synced_at:"2026-08-05T02:00:01Z",source_watermark:"649",sources:[{source_type:"realtime_execution",count:3}],configuration_versions:["policy-v1"],price_versions:["price-v1"],actual:{record_count:3,input_tokens:300,cached_input_tokens:0,output_tokens:150,total_cost:"0.30",average_cost:"0.10",cost_coverage_count:3,p50_latency_ms:110,p95_latency_ms:120,p99_latency_ms:120,failure_count:0,stream_count:0,nonstream_count:3,model_count:1,currency:"CNY",price_source:null,price_version:null},evidence_capabilities:{historical_aggregation:3,exact_decision_reconstruction:3,historical_statistics_only:0,authoritative_channel:3,unusable:0},empty_message:null};
const item={record_id:"CALL-1",occurred_at:"2026-08-05T02:00:00Z",request_id:"REQ-REAL-001",response_id:"RESP-REAL-001",decision_id:"DEC-REAL-001",source_type:"realtime_execution",association:"exact" as const,configuration_version:"policy-v1",metric_snapshot_id:"METRIC-1",actual:{model:"model-a",channel_id:"channel-a",channel_name:"A",status:"SUCCESS",http_status:200,latency_ms:120,cost_amount:"0.10",currency:"CNY",input_tokens:100,cached_input_tokens:0,output_tokens:50,total_attempts:1,fallback:false,label:"历史实际"},counterfactual:{strategy:"latency_first",model:"model-a",channel_id:"channel-b",choice_changed:true,estimated_cost:null,cost_delta:null,currency:"CNY",price_version:null,cost_basis:null,cost_unavailable_reason:"price_version_missing",estimated_latency_ms:null,latency_sample_count:1,latency_basis:null,confidence:"low" as const,reason:"insufficient_candidate_latency_samples",label:"离线估算"},timeline:[{step:1,title:"输入请求摘要",status:"available",evidence:{requested_model:"model-a"}}]};
const result:HistoricalReplayResult={replay_id:"HR-1",schema_version:"historical_replay_v1",execution_mode:"offline_counterfactual_no_provider_call",is_mock:false,baseline_strategy:"actual_observed",candidate_strategy:"latency_first",source,sample_count:3,exact_association_count:3,unlinked_count:0,historical_statistics_count:0,execution_only_count:0,choice_comparable_count:1,choice_changed_count:1,choice_changed_rate:1,actual:{...source.actual,total_tokens:450},cost:{baseline:"0.30",candidate:null,delta_percent:null,coverage_count:0,actual_coverage_count:3,candidate_unavailable_reason:"candidate_model_or_channel_price_missing",actual_formula:"统一日志实际花费求和",formula:"历史Token × 价格版本",currency:"CNY"},latency:{baseline_p95_ms:120,candidate_p95_ms:null,coverage_count:0,formula:"同模型渠道历史P95"},success_changes:{success_to_failure:null,failure_to_success:null,reason:"离线不推断"},sla:{baseline_failure_count:0,baseline_timeout_count:0,baseline_rate_limit_count:0,baseline_p95_ms:120,baseline_p99_ms:120,candidate_risk:null,coverage_count:3,reason:"候选策略未调用Provider"},fallback:{baseline:0,candidate:null,reason:"反事实执行未发生"},concentration:{baseline_hhi:1,candidate_hhi:1,formula:"HHI",reason:null},low_confidence_count:1,unestimable_count:1,risk_count:1,conclusion:"候选策略在3条真实历史请求中改变1次选择；成本与延迟暂不可判断。",disclaimer:"候选策略结果为基于真实历史请求的离线估算，不代表已经获得实际收益。实际效果需要通过影子调度或真实UAT实验验证。",created_at:"2026-08-05T02:01:00Z",network_calls:0,items:[item]};

function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<MemoryRouter><QueryClientProvider client={client}><HistoricalReplayPage/></QueryClientProvider></MemoryRouter>)}

describe("HistoricalReplayPage",()=>{
  afterEach(()=>vi.restoreAllMocks());
  test("uses real source, runs replay, and drills into a real request",async()=>{
    vi.spyOn(api,"historicalReplaySource").mockResolvedValue(source);
    vi.spyOn(api,"runHistoricalReplay").mockResolvedValue(result);
    show();
    expect(await screen.findByText("真实 UAT 日志 · 国内 UAT")).toBeInTheDocument();
    expect(screen.getByRole("region",{name:"历史实际数据"})).toBeInTheDocument();
    expect(screen.getByText("CNY ¥0.30")).toBeInTheDocument();
    expect(screen.getByText("policy-v1")).toBeInTheDocument();
    expect(screen.getByText("price-v1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"运行历史回放"}));
    expect(await screen.findByText("REQ-REAL-001")).toBeInTheDocument();
    expect(screen.getAllByLabelText("模型").length).toBeGreaterThan(1);
    expect(screen.getAllByLabelText("渠道").length).toBeGreaterThan(1);
    expect(screen.getAllByText("SLA 风险").length).toBeGreaterThan(1);
    expect(screen.getAllByText("不可计算").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("REQ-REAL-001"));
    expect(await screen.findByRole("dialog",{name:"请求回放详情"})).toBeInTheDocument();
    expect(screen.getByText("DEC-REAL-001")).toBeInTheDocument();
    expect(screen.getByText("技术详情（默认折叠）")).toBeInTheDocument();
  });
  test("shows the exact empty state and never falls back to demo",async()=>{
    vi.spyOn(api,"historicalReplaySource").mockResolvedValue({...source,sample_count:0,exact_association_count:0,empty_message:"当前没有可用于回放的真实UAT日志。"});
    const run=vi.spyOn(api,"runHistoricalReplay");
    show();
    expect(await screen.findByText("当前没有可用于回放的真实UAT日志。")).toBeInTheDocument();
    expect(screen.queryByText("演示数据")).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"运行历史回放"})).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  });
  test("keeps observed statistics valid when candidate strategy is not comparable",async()=>{
    const historicalSource={...source,sample_count:646,exact_association_count:0,unlinked_count:646,
      sources:[{source_type:"historical_uat_csv",count:646}],price_versions:[],
      actual:{...source.actual,record_count:646,input_tokens:9453,output_tokens:68318,total_cost:"13.256422",average_cost:"0.0205525929",cost_coverage_count:645,p95_latency_ms:24000,p99_latency_ms:43600,failure_count:1,stream_count:15,nonstream_count:631,model_count:9,price_source:"historical_log_detail",price_version:"unversioned_historical_snapshot"},
      evidence_capabilities:{historical_aggregation:646,exact_decision_reconstruction:0,historical_statistics_only:646,authoritative_channel:0,unusable:0}};
    vi.spyOn(api,"historicalReplaySource").mockResolvedValue(historicalSource);
    vi.spyOn(api,"runHistoricalReplay").mockResolvedValue({...result,source:historicalSource,sample_count:646,
      exact_association_count:0,unlinked_count:646,historical_statistics_count:646,choice_comparable_count:0,
      choice_changed_count:0,choice_changed_rate:null,actual:{...result.actual,...historicalSource.actual,total_tokens:77771},
      cost:{...result.cost,baseline:"13.256422",candidate:null,actual_coverage_count:645,
        candidate_unavailable_reason:"historical_request_content_missing"},items:[]});
    show();
    expect(await screen.findByText("CNY ¥13.256422")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"运行历史回放"}));
    expect(await screen.findByText("候选策略尚未产生可比较决策。")).toBeInTheDocument();
    expect(screen.getByText("历史实际 Token、费用和延迟统计仍然有效。")).toBeInTheDocument();
    expect(screen.queryByText(/\{\s*"/)).not.toBeInTheDocument();
  });
});
