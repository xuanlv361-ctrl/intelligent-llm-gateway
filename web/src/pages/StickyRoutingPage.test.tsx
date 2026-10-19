// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import StickyRoutingPage from "./StickyRoutingPage";
import {api} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{
    ...actual.api,
    stickyStatus:vi.fn(),
    stickyBindings:vi.fn(),
    stickyMetrics:vi.fn(),
    invalidateStickyBinding:vi.fn(),
  }};
});

const binding={
  sticky_binding_id:"STB-1",safe_route_key_fingerprint:"abcdef0123456789",
  environment_id:"china_uat",requested_model:"model-a",selected_channel:"19",
  state:"ACTIVE" as const,policy_version:"sticky-routing-policy-v1",
  configuration_version:"sticky-routing-config-v1",
  created_at:"2026-07-30T00:00:00Z",expires_at:"2026-07-30T00:15:00Z",
  maximum_expires_at:"2026-07-30T01:00:00Z",last_used_at:"2026-07-30T00:00:00Z",
  remaining_seconds:900,hit_count:3,invalidation_reason:null,
  interruption_reason:null,originating_decision_id:"D-1",latest_decision_id:"D-2",
  metric_snapshot_id:"MET-1",confidence_snapshot_id:"CONF-1",
  evidence_ids:["EV-1"],is_mock:true,evidence_source:"local_mock_evidence",
  capability_scope:{stream:false},
};
const status={
  status:"ready" as const,blocked_reason:null,enabled:true,operational:true,
  policy_version:"sticky-routing-policy-v1",
  configuration_version:"sticky-routing-config-v1",ttl_seconds:900,
  maximum_total_duration_seconds:3600,route_key_derivation_version:"hmac-sha256-v1",
  capability_scope_version:"sticky-capability-scope-v1",
  required_gate_order:["security_authorization","capability","environment","budget",
    "health","statistical_confidence","freshness","circuit_breaker"],
  state_counts:{ACTIVE:1},schema_version:1,network_called:false as const,
};
const metrics={status:"ready",environment_id:null,outcomes:{HIT:3,MISS:1},
  hit_rate:.75,interruption_reasons:[],network_called:false as const};

function renderPage(environment:"all"|"china_uat"|"overseas"="all"){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  const view=render(<QueryClientProvider client={client}>
    <StickyRoutingPage environment={environment}/>
  </QueryClientProvider>);
  return {client,...view};
}

describe("StickyRoutingPage",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(api.stickyStatus).mockResolvedValue(status);
    vi.mocked(api.stickyBindings).mockResolvedValue({
      status:"ready",total:1,limit:25,offset:0,has_more:false,items:[binding],
    });
    vi.mocked(api.stickyMetrics).mockResolvedValue(metrics);
  });

  it("renders loading then binding, TTL, evidence and Mock status",async()=>{
    renderPage();
    expect(screen.getByText("正在读取持久化粘性路由")).toBeInTheDocument();
    expect(await screen.findByText("model-a")).toBeInTheDocument();
    expect(screen.getAllByText("15 分 0 秒")).toHaveLength(2);
    expect(screen.getByText(/MET-1/)).toBeInTheDocument();
    expect(screen.getByText(/Mock \/ 本地/)).toBeInTheDocument();
    expect(screen.queryByText("PRIVATE-AFFINITY")).not.toBeInTheDocument();
  });

  it("shows blocked and empty states without fabricated bindings",async()=>{
    vi.mocked(api.stickyStatus).mockResolvedValue({
      ...status,status:"blocked",enabled:false,operational:false,
      blocked_reason:"sticky_policy_disabled",state_counts:{},
    });
    vi.mocked(api.stickyBindings).mockResolvedValue({
      status:"ready",total:0,limit:25,offset:0,has_more:false,items:[],
    });
    renderPage();
    expect(await screen.findByText(/策略默认关闭/)).toBeInTheDocument();
    expect(screen.getByText("当前没有可展示的粘性绑定")).toBeInTheDocument();
  });

  it("shows error and allows retry",async()=>{
    vi.mocked(api.stickyBindings).mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("粘性路由读取失败");
    fireEvent.click(screen.getByText("重新读取"));
    await waitFor(()=>expect(api.stickyBindings).toHaveBeenCalledTimes(2));
  });

  it("requires the exact Chinese confirmation before invalidation",async()=>{
    vi.mocked(api.invalidateStickyBinding).mockResolvedValue({
      status:"ready",binding:{...binding,state:"INVALIDATED"},idempotent_replay:false,
    });
    renderPage();
    await screen.findByText("model-a");
    fireEvent.click(screen.getByText("查看"));
    fireEvent.click(screen.getByText("使绑定失效"));
    const confirmButton=screen.getByText("确认失效");
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("粘性绑定失效确认文本"),
      {target:{value:"我确认使此粘性路由绑定失效"}});
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(()=>expect(api.invalidateStickyBinding).toHaveBeenCalledWith(
      "STB-1","china_uat","operator_confirmed_invalidation",expect.any(String)));
  });

  it("applies state, model and channel filters",async()=>{
    renderPage();
    await screen.findByText("model-a");
    fireEvent.change(screen.getByLabelText("绑定状态筛选"),{target:{value:"ACTIVE"}});
    fireEvent.change(screen.getByLabelText("绑定模型筛选"),{target:{value:"model-a"}});
    fireEvent.change(screen.getByLabelText("绑定渠道筛选"),{target:{value:"19"}});
    await waitFor(()=>expect(api.stickyBindings).toHaveBeenLastCalledWith(
      expect.objectContaining({state:"ACTIVE",model:"model-a",channel:"19"}),expect.anything()));
  });

  it("reuses the same idempotency key after a lost mutation response",async()=>{
    vi.mocked(api.invalidateStickyBinding)
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({
        status:"ready",binding:{...binding,state:"INVALIDATED"},
        idempotent_replay:true,
      });
    renderPage();
    await screen.findByText("model-a");
    fireEvent.click(screen.getByText("查看"));
    fireEvent.click(screen.getByText("使绑定失效"));
    fireEvent.change(screen.getByLabelText("粘性绑定失效确认文本"),
      {target:{value:"我确认使此粘性路由绑定失效"}});
    fireEvent.click(screen.getByText("确认失效"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText("确认失效"));
    await waitFor(()=>expect(api.invalidateStickyBinding).toHaveBeenCalledTimes(2));
    const first=vi.mocked(api.invalidateStickyBinding).mock.calls[0][3];
    const second=vi.mocked(api.invalidateStickyBinding).mock.calls[1][3];
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("clears the selected binding and confirmation when environment changes",async()=>{
    const {client,rerender}=renderPage("china_uat");
    await screen.findByText("model-a");
    fireEvent.click(screen.getByText("查看"));
    fireEvent.click(screen.getByText("使绑定失效"));
    expect(screen.getByLabelText("粘性绑定失效确认文本")).toBeInTheDocument();
    rerender(<QueryClientProvider client={client}>
      <StickyRoutingPage environment="overseas"/>
    </QueryClientProvider>);
    await waitFor(()=>expect(
      screen.queryByLabelText("粘性绑定详情")).not.toBeInTheDocument());
  });
});
