// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {render,screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {api} from "../services/api";
import {LiveProbePage,StrategyEffectPage} from "./LiveAcceptancePages";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,latestStrategyEffect:vi.fn(),latestContinuousProbe:vi.fn()}};
});

const renderPage=(page:ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{page}</QueryClientProvider>);

describe("live UAT acceptance pages",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("separates provider actual cost from versioned estimates",async()=>{
    vi.mocked(api.latestStrategyEffect).mockResolvedValue({item:{strategy_effect_run_id:"SER-LIVE",status:"COMPLETED",completed_requests:90,planned_requests:90,price_version:"price-v1",summary:{strategies:{current_actual:{request_count:30,success_rate:1,p50_ms:100,p95_ms:200,p99_ms:300,actual_provider_cost:null,actual_cost_coverage:0,estimated_versioned_price:"0.12",estimated_cost_coverage:1,fallback_rate:0,assertion_pass_rate:1,selection_changes_from_baseline:0,metric_coverage:1,confidence:"high",model_distribution:{"model-a":30}}}}}} as never);
    renderPage(<StrategyEffectPage/>);
    expect(await screen.findByText(/SER-LIVE/)).toBeInTheDocument();
    expect(screen.getAllByText("待 Provider 日志同步").length).toBeGreaterThan(0);
    expect(screen.getByText("¥0.12")).toBeInTheDocument();
  });

  it("shows injected failures separately from live provider failures",async()=>{
    vi.mocked(api.latestContinuousProbe).mockResolvedValue({item:{probe_run_id:"PRB-LIVE",status:"COMPLETED",current_phase:3,current_interval_seconds:2.4,pause_count:1,circuit_open_count:1,recovery_count:1,summary:{duration_seconds:300,request_count:47,success_count:36,failure_count:11,success_rate:36/47,p95_ms:7000,p99_ms:26000,actual_provider_cost:null,estimated_versioned_price:"0.01",throttle_count:6,provider_live_failures:1,uat_injected_failures:10,residual_background_tasks:0},events:[]}} as never);
    renderPage(<LiveProbePage/>);
    expect(await screen.findByText(/PRB-LIVE/)).toBeInTheDocument();
    expect(screen.getByText("真实 Provider 失败")).toBeInTheDocument();
    expect(screen.getByText("UAT 注入失败")).toBeInTheDocument();
  });
});
