import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {RoutingRunsPage} from "./ConsolePages";
import {api} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,callLogs:vi.fn(),callLogAnalytics:vi.fn(),
    uatExecutionControl:vi.fn(),environmentModels:vi.fn(),environmentStatus:vi.fn()}};
});

function show(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<MemoryRouter><QueryClientProvider client={client}><RoutingRunsPage environment="china_uat"/></QueryClientProvider></MemoryRouter>);
}

describe("RoutingRunsPage standardized call ledger",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.mocked(api.uatExecutionControl).mockResolvedValue({status:"STOPPED",task:null} as never);
    vi.mocked(api.environmentModels).mockResolvedValue({models:[]} as never);
    vi.mocked(api.environmentStatus).mockResolvedValue({remaining_budget_cny:3} as never);
    vi.mocked(api.callLogs).mockResolvedValue({status:"ready",schema_version:"standardized_call_log_v1",
      total:2,historical_count:1,next_cursor:2,updated_at:"2026-08-05T01:00:00Z",items:[
        {cursor_id:2,record_id:"CALL-2",occurred_at:"2026-08-05T01:00:00Z",request_id:"REQ-2",
          response_id:"RESP-2",decision_id:"DEC-2",environment_id:"china_uat",requested_model:"model-a",
          actual_model:"model-a",provider:"provider",channel_id:"channel-a",channel_name:"Channel A",
          endpoint_type:"openai_compatible",stream:true,request_status:"SUCCESS",http_status:200,
          error_code:null,error_category:null,retryable:false,attempt_number:1,total_attempts:1,
          total_latency_ms:900,first_token_latency_ms:110,input_tokens:10,cached_input_tokens:2,
          output_tokens:20,cost_amount:"0.03",currency:"CNY",configuration_version:"v1",
          metric_snapshot_id:"MS-1",source_type:"realtime_execution",evidence_scope:"channel_eligible",
          is_historical:false,created_at:"2026-08-05T01:00:00Z",updated_at:"2026-08-05T01:00:01Z"},
        {cursor_id:1,record_id:"HIST-1",occurred_at:"2026-07-29T02:00:00Z",request_id:null,
          response_id:null,decision_id:null,environment_id:"china_uat",requested_model:"model-b",
          actual_model:"model-b",provider:null,channel_id:null,channel_name:null,endpoint_type:null,
          stream:false,request_status:"SUCCESS",http_status:null,error_code:null,error_category:null,
          retryable:false,attempt_number:1,total_attempts:1,total_latency_ms:2000,
          first_token_latency_ms:null,input_tokens:5,cached_input_tokens:0,output_tokens:8,
          cost_amount:"0.01",currency:"CNY",configuration_version:null,metric_snapshot_id:null,
          source_type:"historical_uat_csv",evidence_scope:"model_usage_only",is_historical:true,
          created_at:"2026-08-05T01:00:00Z",updated_at:"2026-08-05T01:00:00Z"}
      ]});
    vi.mocked(api.callLogAnalytics).mockResolvedValue({status:"ready",schema_version:"standardized_call_log_v1",
      environment_id:"china_uat",request_count:2,success_count:2,failure_count:0,success_rate:1,
      total_latency_ms:2900,average_latency_ms:1450,p50_latency_ms:1450,p95_latency_ms:1945,
      p99_latency_ms:1989,average_first_token_latency_ms:110,input_tokens:15,cached_input_tokens:2,
      output_tokens:28,total_cost:"0.04",currency:"CNY",average_cost:"0.02",stream_count:1,
      nonstream_count:1,model_mismatch_count:0,model_counts:{"model-a":1,"model-b":1},
      model_costs:{"model-a":"0.03","model-b":"0.01"},error_categories:{},retry_count:0,
      fallback_count:0,today_request_count:1,today_tokens:32,today_cost:"0.03",trend:[],
      generated_at:"2026-08-05T01:00:02Z"});
  });

  it("renders historical and realtime records without fabricated identifiers",async()=>{
    show();
    expect(await screen.findByText("REQ-2")).toBeInTheDocument();
    expect(screen.getAllByText("历史 UAT").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("实时执行").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("历史数据未提供").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("首字 110 ms")).toBeInTheDocument();
    expect(screen.getAllByText("CNY ¥0.03").length).toBeGreaterThanOrEqual(1);
  });

  it("refresh button performs new list and analytics requests",async()=>{
    const user=userEvent.setup();show();
    await screen.findByText("REQ-2");
    const listCalls=vi.mocked(api.callLogs).mock.calls.length;
    const analyticsCalls=vi.mocked(api.callLogAnalytics).mock.calls.length;
    await user.click(screen.getByRole("button",{name:"刷新"}));
    expect(vi.mocked(api.callLogs).mock.calls.length).toBeGreaterThan(listCalls);
    expect(vi.mocked(api.callLogAnalytics).mock.calls.length).toBeGreaterThan(analyticsCalls);
  });

  it("keeps existing records visible when incremental refresh is interrupted",async()=>{
    const user=userEvent.setup();show();
    expect(await screen.findByText("REQ-2")).toBeInTheDocument();
    vi.mocked(api.callLogs).mockRejectedValue(new Error("temporary disconnect"));
    await user.click(screen.getByRole("button",{name:"刷新"}));
    expect((await screen.findAllByText("实时更新暂时中断")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("REQ-2")).toBeInTheDocument();
  });
});
