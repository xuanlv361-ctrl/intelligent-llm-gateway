// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {UatWorkbenchPage} from "./UatWorkbenchPage";
import {api,UatWorkbenchResult} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,environmentStatus:vi.fn(),environmentExecutionState:vi.fn(),
    environmentCredentialStatus:vi.fn(),temporaryCredentialStatus:vi.fn(),
    setTemporaryCredential:vi.fn(),restoreTemporaryCredentialFromVault:vi.fn(),clearTemporaryCredential:vi.fn(),testTemporaryCredential:vi.fn(),
    executeWorkbenchRequest:vi.fn(),streamWorkbenchRequest:vi.fn()}};
});

const saved={environment_id:"china_uat",configured:true,credential_source:"temporary_session" as const,
  auth_session_id:"safe-session",connection_status:"not_tested" as const,expires_at:null,minutes_remaining:null,key_fingerprint:"safe-fingerprint"};
const success:UatWorkbenchResult={execution_status:"success",request_id:"REQ-LIVE-1",decision_id:"DEC-LIVE-1",
  response_id:"RESP-LIVE-1",requested_model:"model-a",actual_model:"model-a",channel_id:"unified-routing",
  provider:"provider-a",http_status:200,method:"POST",path:"/v1/chat/completions",response_headers:{"content-type":"application/json"},
  response_body:JSON.stringify({id:"RESP-LIVE-1",model:"model-a",choices:[{message:{content:"真实回答"}}],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}}),
  response_body_truncated:false,total_latency_ms:1800,first_token_latency_ms:320,input_tokens:4,output_tokens:2,total_tokens:6,
  cost_amount:"0.0021",currency:"CNY",network_called:true,attempts:1,retry_used:false,fallback_used:false,error:null,created_at:"2026-08-05T12:00:00Z"};

function show(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<MemoryRouter><QueryClientProvider client={client}><UatWorkbenchPage mode="uat" environment="china_uat" onEnvironmentChange={vi.fn()}/></QueryClientProvider></MemoryRouter>);
}

async function fillRequired(user:ReturnType<typeof userEvent.setup>,specified=true){
  await screen.findByText("国内 UAT 已开启");
  await user.type(screen.getByLabelText("完整 UAT URL"),"https://api-uat.weimeta.cn/v1/chat/completions");
  await user.type(screen.getByLabelText("API Key"),"test-only-key-not-real");
  if(specified){await user.selectOptions(screen.getByLabelText("模型选择方式"),"specified");await user.type(screen.getByLabelText("搜索或输入模型 ID"),"model-a")}
  await user.type(screen.getByLabelText("请求内容"),"解释幂等性");
}

describe("agent-style UAT request page",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.mocked(api.environmentStatus).mockResolvedValue({base_url:"https://api-uat.weimeta.cn"} as never);
    vi.mocked(api.environmentExecutionState).mockResolvedValue({environment_id:"china_uat",enabled:true} as never);
    vi.mocked(api.environmentCredentialStatus).mockResolvedValue({configured:false,credential_source:"none",expires_at:null,minutes_remaining:null,key_fingerprint:null});
    vi.mocked(api.temporaryCredentialStatus).mockResolvedValue({environment_id:"china_uat",configured:false,credential_source:"none",auth_session_id:null,connection_status:"not_tested",expires_at:null,minutes_remaining:null,key_fingerprint:null});
    vi.mocked(api.setTemporaryCredential).mockResolvedValue(saved as never);
    vi.mocked(api.restoreTemporaryCredentialFromVault).mockResolvedValue(saved as never);
    vi.mocked(api.clearTemporaryCredential).mockResolvedValue({configured:false} as never);
    vi.mocked(api.executeWorkbenchRequest).mockResolvedValue(success);
    vi.mocked(api.streamWorkbenchRequest).mockResolvedValue(undefined);
  });

  it("shows the compact workflow and hides the JSON workbench by default",async()=>{
    show();
    expect(await screen.findByLabelText("完整 UAT URL")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type","password");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("autocomplete","new-password");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("data-1p-ignore","true");
    expect(screen.getByLabelText("HTTP Method")).toBeVisible();
    expect(screen.getByLabelText("模型选择方式")).toBeVisible();
    expect(screen.getByLabelText("请求内容")).toBeVisible();
    expect(screen.getByText("输入任务，系统将使用所选模型或自动调度完成请求。")).toBeVisible();
    for(const removed of ["Params","Headers","Body","Auth 与环境","保存草稿","候选预览","受控任务"])expect(screen.queryByText(removed,{exact:true})).not.toBeInTheDocument();
    expect(screen.queryByText('"messages"')).not.toBeInTheDocument();
  });

  it("keeps the API key out of browser storage and allows showing, hiding, and clearing",async()=>{
    const storageSpy=vi.spyOn(Storage.prototype,"setItem");show();const user=userEvent.setup();
    const input=await screen.findByLabelText("API Key");await user.type(input,"test-only-key-not-real");
    await user.click(screen.getByRole("button",{name:"显示"}));expect(input).toHaveAttribute("type","text");
    await user.click(screen.getByRole("button",{name:"隐藏"}));expect(input).toHaveAttribute("type","password");
    expect(storageSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button",{name:"清除"}));expect(input).toHaveValue("");
    expect(api.clearTemporaryCredential).toHaveBeenCalledWith("china_uat");storageSpy.mockRestore();
  });

  it("loads the real model catalog only with the current key",async()=>{
    vi.mocked(api.testTemporaryCredential).mockResolvedValue({environment_id:"china_uat",auth_session_id:"safe-session",connection_status:"success",http_status:200,tested_at:"2026-08-05T12:00:00Z",target_host:"api-uat.weimeta.cn",credential_source:"temporary_session",model_count:2,models:[{id:"model-a",display_name:"Model A",owned_by:"Provider A",execution_allowed:true,stream_capability:"pending_confirmation"},{id:"model-b",display_name:"Model B",owned_by:"Provider B",execution_allowed:true,stream_capability:"pending_confirmation"}],message:"ok"});
    show();const user=userEvent.setup();await user.type(await screen.findByLabelText("API Key"),"test-only-key-not-real");
    await user.click(screen.getByRole("button",{name:"刷新真实模型目录"}));
    expect(await screen.findByText(/真实目录 2 个/)).toBeVisible();
    expect(api.testTemporaryCredential).toHaveBeenCalledWith("china_uat","safe-session",expect.any(Object));
    expect(document.body.textContent).not.toContain("test-only-key-not-real");
  });

  it("explicitly reuses an encrypted backend credential without exposing it to the page",async()=>{
    vi.mocked(api.environmentCredentialStatus).mockResolvedValue({configured:true,credential_source:"windows_encrypted_vault",expires_at:null,minutes_remaining:null,key_fingerprint:"sha256:safe"});
    vi.mocked(api.testTemporaryCredential).mockResolvedValue({environment_id:"china_uat",auth_session_id:"safe-session",connection_status:"success",http_status:200,tested_at:"2026-08-05T12:00:00Z",target_host:"api-uat.weimeta.cn",credential_source:"temporary_session",model_count:153,models:[],message:"ok"});
    show();const user=userEvent.setup();
    await user.click(await screen.findByRole("button",{name:"使用已保存的后端凭据"}));
    expect(api.restoreTemporaryCredentialFromVault).toHaveBeenCalledWith("china_uat");
    expect(api.testTemporaryCredential).toHaveBeenCalledWith("china_uat","safe-session",expect.any(Object));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(await screen.findByText(/真实目录 153 个/)).toBeVisible();
    expect(document.body.textContent).not.toContain("sha256:safe");
  });

  it("automatically constructs the chat body and sends without preflight approval",async()=>{
    show();const user=userEvent.setup();await fillRequired(user,true);
    expect(screen.getByRole("button",{name:"发送请求"})).toBeEnabled();await user.click(screen.getByRole("button",{name:"发送请求"}));
    await waitFor(()=>expect(api.executeWorkbenchRequest).toHaveBeenCalled());
    const request=vi.mocked(api.executeWorkbenchRequest).mock.calls[0][1];
    expect(request.model).toBe("model-a");expect(request.model_selection_mode).toBe("specified");expect(request.body.type).toBe("json");
    expect(request.body.value).toMatchObject({model:"model-a",messages:[{role:"user",content:"解释幂等性"}],stream:false});
    expect(await screen.findByText("真实回答")).toBeVisible();expect(screen.getByText(/状态 200/)).toHaveTextContent("6 Token");
    await user.click(screen.getByText("查看执行详情"));expect(screen.getByText("REQ-LIVE-1")).toBeVisible();expect(screen.getByText("DEC-LIVE-1")).toBeVisible();
  });

  it("sends stream=true and exposes stop while the request is pending",async()=>{
    let resolveStream!:()=>void;
    vi.mocked(api.streamWorkbenchRequest).mockImplementation((_environment,_request,onEvent)=>new Promise(resolve=>{
      onEvent({type:"delta",content:"实时"});
      onEvent({type:"delta",content:"回答"});
      onEvent({type:"result",result:{...success,first_token_latency_ms:120}});
      resolveStream=resolve;
    }));
    show();const user=userEvent.setup();await fillRequired(user,true);await user.click(screen.getByLabelText("流式"));
    await user.click(screen.getByRole("button",{name:"发送请求"}));
    expect(await screen.findByRole("button",{name:"停止生成"})).toBeVisible();
    expect(await screen.findByText("实时回答")).toBeVisible();
    await waitFor(()=>expect(api.streamWorkbenchRequest).toHaveBeenCalledWith("china_uat",expect.objectContaining({stream:true,body:expect.objectContaining({value:expect.objectContaining({stream:true})})}),expect.any(Function),expect.any(AbortSignal)));
    resolveStream();expect(await screen.findByText(/状态 200/)).toBeVisible();
  });

  it("aborts streaming on explicit stop and preserves received text",async()=>{
    vi.mocked(api.streamWorkbenchRequest).mockImplementation((_environment,_request,onEvent,signal)=>new Promise((_resolve,reject)=>{
      onEvent({type:"delta",content:"已经收到的内容"});
      signal.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});
    }));
    show();const user=userEvent.setup();await fillRequired(user,true);await user.click(screen.getByLabelText("流式"));
    await user.click(screen.getByRole("button",{name:"发送请求"}));
    expect(await screen.findByText("已经收到的内容")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"停止生成"}));
    await waitFor(()=>expect(screen.getByText("已经收到的内容").closest("article")).toHaveTextContent("已经收到的内容"));
    expect((await screen.findAllByText("用户已停止")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/请求未完成/)).not.toBeInTheDocument();
  });

  it("allows editing advanced query parameters and safe headers",async()=>{
    show();const user=userEvent.setup();await fillRequired(user,true);
    await user.click(screen.getByText("高级设置"));
    await user.clear(screen.getByLabelText("查询参数"));
    await user.click(screen.getByLabelText("查询参数"));
    await user.paste(JSON.stringify([{name:"region",value:"cn",enabled:true}]));
    await user.clear(screen.getByLabelText("自定义 Headers"));
    await user.click(screen.getByLabelText("自定义 Headers"));
    await user.paste(JSON.stringify([{name:"Accept-Language",value:"zh-CN",enabled:true}]));
    await user.click(screen.getByRole("button",{name:"发送请求"}));
    await waitFor(()=>expect(api.executeWorkbenchRequest).toHaveBeenCalledWith("china_uat",expect.objectContaining({
      query_params:[{name:"region",value:"cn",enabled:true}],headers:[{name:"Accept-Language",value:"zh-CN",enabled:true}],
    }),expect.any(AbortSignal)));
  });

  it("supports automatic scheduling without a preselected model",async()=>{
    show();const user=userEvent.setup();await fillRequired(user,false);await user.click(screen.getByRole("button",{name:"发送请求"}));
    await waitFor(()=>expect(api.executeWorkbenchRequest).toHaveBeenCalledWith("china_uat",expect.objectContaining({model:null,model_selection_mode:"automatic",routing_policy:"latency_first"}),expect.any(AbortSignal)));
  });

  it("allows a GET catalog request with empty natural-language content and no body",async()=>{
    const getResult={...success,method:"GET",path:"/v1/models",decision_id:null,requested_model:null,actual_model:null,response_body:'{"data":[]}',total_tokens:null};
    vi.mocked(api.executeWorkbenchRequest).mockResolvedValue(getResult);
    show();const user=userEvent.setup();await screen.findByText("国内 UAT 已开启");
    await user.selectOptions(screen.getByLabelText("HTTP Method"),"GET");await user.type(screen.getByLabelText("完整 UAT URL"),"https://api-uat.weimeta.cn/v1/models");await user.type(screen.getByLabelText("API Key"),"test-only-key-not-real");
    await user.click(screen.getByRole("button",{name:"发送请求"}));
    await waitFor(()=>expect(api.executeWorkbenchRequest).toHaveBeenCalledWith("china_uat",expect.objectContaining({method:"GET",body:{type:"none",value:null}}),expect.any(AbortSignal)));
  });

  it("rejects non-UAT URLs and unknown write adapters before credential submission",async()=>{
    show();const user=userEvent.setup();await screen.findByText("国内 UAT 已开启");
    await user.type(screen.getByLabelText("API Key"),"test-only-key-not-real");
    await user.type(screen.getByLabelText("完整 UAT URL"),"https://example.com/v1/models");expect(screen.getByText("URL 必须属于国内 UAT 环境。")).toBeVisible();
    expect(screen.getByRole("button",{name:"发送请求"})).toBeDisabled();expect(api.setTemporaryCredential).not.toHaveBeenCalled();
  });

  it("keeps capability_pending as a warning instead of a blocker",async()=>{
    show();const user=userEvent.setup();await fillRequired(user,true);
    expect(screen.getByText(/普通文本请求仍会通过真实 UAT 调用验证/)).toBeVisible();
    expect(screen.getByRole("button",{name:"发送请求"})).toBeEnabled();
  });

  it("renders friendly authentication failures and preserves execution details",async()=>{
    vi.mocked(api.executeWorkbenchRequest).mockResolvedValue({...success,execution_status:"failed",http_status:401,error:{category:"user_authentication_error"}});
    show();const user=userEvent.setup();await fillRequired(user,true);await user.click(screen.getByRole("button",{name:"发送请求"}));
    expect(await screen.findByText(/请求失败：401 鉴权失败/)).toBeVisible();
    const summary=screen.getByText("查看执行详情");await user.click(summary);
    const details=summary.closest("details")!;expect(within(details).getByText("REQ-LIVE-1")).toBeVisible();
  });
});
