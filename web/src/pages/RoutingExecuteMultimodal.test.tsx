// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {RoutingExecutePage} from "./ConsolePages";
import {api} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,environmentStatus:vi.fn(),environmentCredentialStatus:vi.fn(),
    environmentModels:vi.fn(),uatEditorOptions:vi.fn(),uatExecutionControl:vi.fn(),
    environmentExecutionState:vi.fn(),setEnvironmentExecutionState:vi.fn(),testCredential:vi.fn(),
    temporaryCredentialStatus:vi.fn(),workbenchModels:vi.fn(),validateWorkbenchRequest:vi.fn(),
    executeWorkbenchRequest:vi.fn(),validateEnvironmentRequest:vi.fn(),executeEnvironmentRequest:vi.fn(),validateMultimodal:vi.fn()}};
});

function show(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<MemoryRouter><QueryClientProvider client={client}><RoutingExecutePage mode="uat" environment="china_uat" onEnvironmentChange={vi.fn()}/></QueryClientProvider></MemoryRouter>);
}

describe("RoutingExecutePage simplified agent contract",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.mocked(api.environmentStatus).mockResolvedValue({key_configured:true,execution_ready:false,blocking_reasons:[]} as never);
    vi.mocked(api.environmentCredentialStatus).mockResolvedValue({status:"ready",configured:true,credential_source:"windows_encrypted_vault"} as never);
    vi.mocked(api.testCredential).mockResolvedValue({connection_status:"success"} as never);
    vi.mocked(api.environmentModels).mockResolvedValue({status:"ready",source:"uat_v1_models",fetched_at:"2026-08-04T00:00:00Z",model_count:1,models:[{id:"model-a",display_name:"Model A",owned_by:"Provider",execution_allowed:true,stream_capability:"pending_confirmation"}]} as never);
    vi.mocked(api.uatEditorOptions).mockResolvedValue({stream_execution_ready:false,model_output_capabilities:[]} as never);
    vi.mocked(api.uatExecutionControl).mockResolvedValue({status:"ACTIVE"} as never);
    vi.mocked(api.environmentExecutionState).mockResolvedValue({environment_id:"china_uat",enabled:true} as never);
    vi.mocked(api.temporaryCredentialStatus).mockResolvedValue({configured:true,credential_source:"temporary_session",auth_session_id:"session-hash",connection_status:"success",expires_at:"2026-08-05T12:00:00Z",minutes_remaining:30,key_fingerprint:"sha256:test"} as never);
    vi.mocked(api.workbenchModels).mockResolvedValue({status:"ready",source:"remote_model_endpoint",fetched_at:"2026-08-04T00:00:00Z",model_count:1,models:[{id:"model-a",display_name:"Model A",owned_by:"Provider",execution_allowed:true,stream_capability:"pending_confirmation"}]} as never);
  });

  it("keeps multimodal/body editors outside the simplified natural-language workflow",async()=>{
    const user=userEvent.setup();show();
    expect(await screen.findByRole("heading",{name:"发起调度"})).toBeVisible();
    expect(screen.queryByRole("button",{name:"form-data"})).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/图片文件/)).not.toBeInTheDocument();
    expect(screen.queryByText("Body",{exact:true})).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("完整 UAT URL"),"https://api-uat.weimeta.cn/v1/chat/completions");
    expect(screen.getByText(/普通文本请求仍会通过真实 UAT 调用验证/)).toBeVisible();
  });
});
