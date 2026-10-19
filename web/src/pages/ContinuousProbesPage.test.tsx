// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {api} from "../services/api";
import {ContinuousProbeDetailPage,ContinuousProbeListPage} from "./ContinuousProbesPage";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,probes:vi.fn(),createProbe:vi.fn(),probe:vi.fn(),probeAction:vi.fn(),
    cloneProbe:vi.fn(),probeMetrics:vi.fn(),probeEvents:vi.fn(),probeRequests:vi.fn(),environmentModels:vi.fn()}};
});

const client=()=>new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const renderAt=(path:string,element:React.ReactNode)=>render(<QueryClientProvider client={client()}><MemoryRouter initialEntries={[path]}><Routes><Route path="/reliability/probes" element={element}/><Route path="/reliability/probes/:probeRunId" element={element}/></Routes></MemoryRouter></QueryClientProvider>);

const run={probe_run_id:"PRB-REAL-001",name:"五分钟国内UAT模型探测",status:"RUNNING",environment_id:"china_uat",
  started_at:"2026-08-07T01:00:00Z",planned_duration_seconds:300,model_ids:["kimi-k3"],configuration:{duration_seconds:300,
    interval_seconds:5,max_concurrency:1,timeout_seconds:30,max_tokens:16,stream:false,model_ids:["kimi-k3"]},
  summary:{request_count:12,success_count:11,failure_count:1,natural_success_rate:1,comprehensive_success_rate:11/12,
    p50_ms:800,p95_ms:1800,p99_ms:2300,actual_provider_cost:null,estimated_versioned_price:"0.003",pending_provider_sync:12}} as const;

describe("continuous probe control room",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(api.probes).mockResolvedValue({status:"ready",items:[run],total:1} as never);
    vi.mocked(api.probe).mockResolvedValue(run as never);
    vi.mocked(api.probeMetrics).mockResolvedValue({probe_run_id:run.probe_run_id,summary:run.summary,request_series:[],latency_series:[],error_distribution:[],model_metrics:[],token_cost_series:[]} as never);
    vi.mocked(api.probeEvents).mockResolvedValue({items:[{event_id:"EV-1",event_type:"circuit_opened",source_type:"uat_fault_injection",created_at:"2026-08-07T01:01:00Z"}],total:1} as never);
    vi.mocked(api.probeRequests).mockResolvedValue({items:[],total:0});
    vi.mocked(api.environmentModels).mockResolvedValue({source:"live",fetched_at:"2026-08-07T01:00:00Z",model_count:1,models:[{id:"kimi-k3",display_name:"Kimi K3",owned_by:"Moonshot",execution_allowed:true,stream_capability:"pending_confirmation"}]} as never);
  });

  it("opens the list rather than an implicit latest run",async()=>{
    renderAt("/reliability/probes",<ContinuousProbeListPage/>);
    expect(await screen.findByRole("heading",{name:"持续探测"})).toBeInTheDocument();
    expect((await screen.findAllByText("五分钟国内UAT模型探测")).length).toBeGreaterThan(0);
    expect(api.probes).toHaveBeenCalled();
  });

  it("reads the exact run id from the detail route and translates events",async()=>{
    renderAt("/reliability/probes/PRB-REAL-001",<ContinuousProbeDetailPage/>);
    expect(await screen.findByText("五分钟国内UAT模型探测")).toBeInTheDocument();
    expect(api.probe).toHaveBeenCalledWith("PRB-REAL-001",expect.anything());
    expect((await screen.findAllByText("熔断已开启")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("UAT受控故障注入").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自然成功率").length).toBeGreaterThan(0);
    expect(screen.getAllByText("综合成功率").length).toBeGreaterThan(0);
  });

  it("creates a task without asking the user for a run id or API key",async()=>{
    vi.mocked(api.createProbe).mockResolvedValue({...run,probe_run_id:"PRB-SERVER-GENERATED"} as never);
    renderAt("/reliability/probes",<ContinuousProbeListPage/>);
    fireEvent.click(await screen.findByRole("button",{name:"新建探测任务"}));
    expect(screen.queryByLabelText(/运行 ID/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("使用后端安全会话")).toBeDisabled();
    fireEvent.click(await screen.findByText("Kimi K3"));
    fireEvent.click(screen.getByRole("button",{name:"开始探测"}));
    await waitFor(()=>expect(api.createProbe).toHaveBeenCalledWith(expect.objectContaining({environment_id:"china_uat",models:["kimi-k3"]})));
  });

  it("keeps raw technical fields folded by default",async()=>{
    renderAt("/reliability/probes/PRB-REAL-001",<ContinuousProbeDetailPage/>);
    const summary=await screen.findByText("技术详情");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("circuit_opened")).not.toBeInTheDocument();
  });
});
