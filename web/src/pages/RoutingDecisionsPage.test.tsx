import {render,screen} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {api} from "../services/api";
import {RoutingDecisionDetailPage,RoutingDecisionsPage} from "./RoutingDecisionsPage";

vi.mock("../services/api",async()=>{const actual=await vi.importActual<typeof import("../services/api")>("../services/api");return {...actual,api:{...actual.api,routingDecision:vi.fn(),routingDecisions:vi.fn()}}});
const detail={decision_id:"DEC-LIVE",request_id:"REQ-LIVE",response_id:"RESP-LIVE",decision_type:"automatic_routing" as const,environment_id:"china_uat",method:"POST",path:"/v1/chat/completions",stream:false,created_at:"2026-08-05T10:00:00Z",policy_version:"latency_first",configuration_version:null,metric_snapshot_id:null,candidates:[{model_id:"kimi-k3",channel_id:null,score:9,capability_status:"pending_allowed_for_text",reason:"recent_live_success_evidence"}],exclusions:[],selected_model:"kimi-k3",selected_channel:null,selection_reason:"recent_live_success_evidence",confidence:"observed",catalog_candidate_count:1,execution_result:{status:"SUCCESS",http_status:200,request_id:"REQ-LIVE",response_id:"RESP-LIVE",model:"kimi-k3",channel_id:null,total_latency_ms:1600,first_token_latency_ms:null,input_tokens:88,output_tokens:384,cost_amount:null,currency:null,total_attempts:1,fallback:false},retry_history:[]};
const show=(path:string,element:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}><Routes><Route path="/routing/decisions/:decisionId" element={element}/><Route path="/observability/decisions" element={element}/></Routes></MemoryRouter></QueryClientProvider>);

describe("routing decision pages",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("opens a decision id directly and distinguishes channel absence",async()=>{vi.mocked(api.routingDecision).mockResolvedValue(detail);show("/routing/decisions/DEC-LIVE",<RoutingDecisionDetailPage/>);expect(await screen.findByText("REQ-LIVE")).toBeInTheDocument();expect(screen.getAllByText("待平台日志确认").length).toBeGreaterThan(0);expect(screen.getAllByText("自动调度").length).toBeGreaterThan(0)});
  it("lists online decisions separately from historical replay",async()=>{vi.mocked(api.routingDecisions).mockResolvedValue({status:"ready",items:[detail],total:1});show("/observability/decisions",<RoutingDecisionsPage/>);expect(await screen.findByText("决策日志")).toBeInTheDocument();expect(screen.getByText("前往历史回放")).toHaveAttribute("href","/observability/replay")});
});
