// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {AgentSkillManagementPage} from "./AgentSkillManagementPage";
import {ApiError,api,type ManagedSkillCatalog,type ManagedSkillHost,type ManagedSkillItem} from "../services/api";

vi.mock("../services/api",async()=>{
  const actual=await vi.importActual<typeof import("../services/api")>("../services/api");
  return {...actual,api:{...actual.api,managedSkills:vi.fn(),managedSkillAudits:vi.fn(),managedSkillHosts:vi.fn(),
    managedSkillHostCapabilities:vi.fn(),managedSkillHostInstallations:vi.fn(),managedSkillHostInvocations:vi.fn(),
    managedSkillInvocations:vi.fn(),invokeManagedSkill:vi.fn(),managedSkillAction:vi.fn(),managedSkillLifecycle:vi.fn(),createManagedSkillHost:vi.fn(),
    updateManagedSkillHost:vi.fn(),setManagedSkillHostCredential:vi.fn(),revokeManagedSkillHostCredential:vi.fn(),
    testManagedSkillHost:vi.fn(),setManagedSkillHostEnabled:vi.fn(),installManagedSkillOnHost:vi.fn(),
    uninstallManagedSkillFromHost:vi.fn(),invokeManagedSkillHost:vi.fn()}};
});

const draft:ManagedSkillItem={skill_id:"frontend-developer-toml",display_name:"Frontend Developer",description:"",
  source_type:"codex_agent_toml",version:"0.1.0",version_status:"draft",installation_status:"not_installed",
  installed_version:null,requested_permissions:["read","local_compute"],page_ids:[],binding:"instruction_only",input_schema:{properties:{}},last_invoked_at:null};
const enabled:ManagedSkillItem={...draft,skill_id:"frontend-design",display_name:"Frontend Design",version:"0.2.0",
  source_type:"github_skill_md",version_status:"published",installation_status:"enabled",installed_version:"0.2.0"};
const host:ManagedSkillHost={host_id:"host-1",host_name:"国内测试宿主",host_type:"remote_agent",base_url:"https://agent.example.cn",
  environment:"china_uat",protocol:"formal_agent_skill",protocol_version:"1.0",auth_type:"bearer_token",
  credential_fingerprint:"sha256:ABCD",status:"connected",enabled:true,capabilities:["invoke"],installed_skill_count:0,
  last_tested_at:"2026-08-06T01:00:00Z",last_test_result:null,last_invoked_at:null,created_at:"2026-08-06T00:00:00Z",updated_at:"2026-08-06T01:00:00Z"};
const catalog=(items:ManagedSkillItem[]):ManagedSkillCatalog=>({items,registered_count:items.length,
  published_count:items.filter(item=>item.version_status==="published").length,installed_count:items.filter(item=>item.installation_status!=="not_installed").length,
  enabled_count:items.filter(item=>item.installation_status==="enabled").length,pending_count:items.filter(item=>item.version_status!=="published").length,
  audit_count:0,last_synced_at:"2026-08-06T01:00:00Z"});

function renderPage(items=[draft,enabled],hostItems:ManagedSkillHost[]=[]){
  vi.mocked(api.managedSkills).mockResolvedValue(catalog(items));
  vi.mocked(api.managedSkillHosts).mockResolvedValue({items:hostItems,external_host_status:hostItems.length?"connected":"not_configured"});
  vi.mocked(api.managedSkillAudits).mockResolvedValue({items:[]});
  vi.mocked(api.managedSkillHostCapabilities).mockResolvedValue({items:[]});
  vi.mocked(api.managedSkillHostInstallations).mockResolvedValue({items:[]});
  vi.mocked(api.managedSkillHostInvocations).mockResolvedValue({items:[]});
  vi.mocked(api.managedSkillInvocations).mockResolvedValue({items:[]});
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><AgentSkillManagementPage/></QueryClientProvider>);
}

describe("Agent Skill management UI",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("disables invocation for a draft Skill and explains the lifecycle gate",async()=>{
    renderPage();await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    expect(screen.getAllByRole("button",{name:"功能调用"}).at(-1)).toBeDisabled();
    expect(screen.getByText("当前版本仍为草稿，请先完成校验。")).toBeInTheDocument();
  });
  it("shows the persisted version in selector options",async()=>{
    renderPage();await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    const option=screen.getByRole("option",{name:/Frontend Developer · 0.1.0/});
    expect(option).toBeInTheDocument();
  });
  it("provides a shortcut from an unavailable Skill to release management",async()=>{
    renderPage();await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    await userEvent.click(screen.getByRole("button",{name:"前往发布与安装"}));
    expect(screen.getByRole("heading",{name:"发布与安装"})).toBeInTheDocument();
  });
  it("allows functional invocation and shows the business result with trace identifiers once",async()=>{
    vi.mocked(api.invokeManagedSkill).mockResolvedValue({invocation_id:"inv-1",audit_id:"audit-1",operator_id:"op",
      skill_id:"frontend-design",skill_version:"0.2.0",started_at:"",finished_at:"",permission_decision:"allow",
      execution_result:"success",data:{data_source:"domestic_uat_live_model_response",business_executed:true,content:"# 设计结果\n真实结果正文",execution_engine:"domestic_uat_chat_completions",model_id:"deepseek-v4-flash"},uncertainty:"none",network_called:true,write_performed:false});
    renderPage([enabled]);await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    const buttons=screen.getAllByRole("button",{name:"功能调用"});expect(buttons.at(-1)).toBeEnabled();await userEvent.click(buttons.at(-1)!);
    expect(await screen.findByText("真实结果正文")).toBeInTheDocument();expect(screen.getByText("inv-1")).toBeInTheDocument();expect(screen.getByText("audit-1")).toBeInTheDocument();
  });
  it("does not allow an instruction-only functional invocation without a user task",async()=>{
    renderPage([enabled]);await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    const task=screen.getByLabelText("用户任务");await userEvent.clear(task);
    expect(screen.getAllByRole("button",{name:"功能调用"}).at(-1)).toBeDisabled();
  });
  it("labels lifecycle validation separately from business success",async()=>{
    vi.mocked(api.invokeManagedSkill).mockResolvedValue({invocation_id:"inv-check",audit_id:"audit-check",operator_id:"op",
      skill_id:"frontend-design",skill_version:"0.2.0",started_at:"",finished_at:"",permission_decision:"allowed",
      execution_result:"conditions_validated",data:{business_executed:false,execution_steps:["校验生命周期","校验权限"]},uncertainty:"known",network_called:false,write_performed:false});
    renderPage([enabled]);await userEvent.click(await screen.findByRole("button",{name:"测试台"}));
    await userEvent.click(screen.getByRole("button",{name:"生命周期验证"}));await userEvent.click(screen.getByRole("button",{name:"验证调用条件"}));
    expect(await screen.findByText("生命周期验证通过")).toBeInTheDocument();expect(screen.queryByText("Skill调用成功")).not.toBeInTheDocument();
  });
  it("renders structured business Skills with a dedicated result component",async()=>{
    const decisionSkill={...enabled,skill_id:"explain-routing-decision",display_name:"解释调度决策",binding:"business_handler"};
    vi.mocked(api.invokeManagedSkill).mockResolvedValue({invocation_id:"inv-decision",audit_id:"audit-decision",operator_id:"op",
      skill_id:"explain-routing-decision",skill_version:"1.0.0",started_at:"",finished_at:"",permission_decision:"allowed",
      execution_result:"success",data:{timeline:["请求进入","候选评分","完成选择"],decision_id:"DEC-1",result_summary:"已还原决策"},uncertainty:"known",network_called:false,write_performed:false});
    renderPage([decisionSkill]);await userEvent.click(await screen.findByRole("button",{name:"测试台"}));await userEvent.click(screen.getAllByRole("button",{name:"功能调用"}).at(-1)!);
    expect(await screen.findByText("决策时间线")).toBeInTheDocument();expect(screen.getByText("候选评分")).toBeInTheDocument();
  });
  it("maps structured lifecycle errors to actionable Chinese and keeps technical details collapsed",async()=>{
    vi.mocked(api.invokeManagedSkill).mockRejectedValue(new ApiError({code:"skill_not_enabled",message:"raw",status:409,
      diagnosticId:"trace-1",details:{code:"skill_not_enabled",skill_id:"frontend-design",installation_status:"disabled"}}));
    renderPage([enabled]);await userEvent.click(await screen.findByRole("button",{name:"测试台"}));await userEvent.click(screen.getAllByRole("button",{name:"功能调用"}).at(-1)!);
    expect(await screen.findByText("当前 Skill 尚未启用，请完成安装并启用。")).toBeInTheDocument();
    const details=screen.getByText("技术详情").closest("details");expect(details).not.toHaveAttribute("open");
  });
  it("refreshes catalog after a lifecycle change",async()=>{
    vi.mocked(api.managedSkillAction).mockResolvedValue({status:"validated"});renderPage([draft]);
    await userEvent.click(await screen.findByRole("button",{name:"发布与安装"}));await userEvent.click(screen.getByRole("button",{name:"安全检查与校验"}));
    await waitFor(()=>expect(api.managedSkills).toHaveBeenCalledTimes(2));
  });
  it("shows the accurate external Host empty state without claiming connection",async()=>{
    renderPage();await userEvent.click(await screen.findByRole("button",{name:"宿主连接"}));
    expect(screen.getByText("尚未配置真实外部 Agent Host")).toBeInTheDocument();expect(screen.queryByText("已连接")).not.toBeInTheDocument();
  });
  it("opens a functional create Host form from the empty state",async()=>{
    renderPage();await userEvent.click(await screen.findByRole("button",{name:"宿主连接"}));
    await userEvent.click(screen.getAllByRole("button",{name:"新增宿主"})[0]);
    expect(screen.getByRole("dialog",{name:"新增宿主"})).toBeInTheDocument();expect(screen.getByLabelText(/Base URL/)).toBeInTheDocument();
  });
  it("creates a Host through the backend contract and refreshes persisted state",async()=>{
    vi.mocked(api.createManagedSkillHost).mockResolvedValue(host);renderPage();await userEvent.click(await screen.findByRole("button",{name:"宿主连接"}));
    await userEvent.click(screen.getAllByRole("button",{name:"新增宿主"})[0]);await userEvent.type(screen.getByLabelText("宿主名称"),"国内测试宿主");
    await userEvent.type(screen.getByLabelText(/Base URL/),"https://agent.example.cn");await userEvent.click(screen.getByRole("button",{name:"保存宿主"}));
    await waitFor(()=>expect(api.createManagedSkillHost).toHaveBeenCalledWith(expect.objectContaining({host_name:"国内测试宿主",base_url:"https://agent.example.cn"})));
  });
  it("disables repeated connection tests while a test is pending",async()=>{
    vi.mocked(api.testManagedSkillHost).mockImplementation(()=>new Promise(()=>{}));renderPage([enabled],[host]);
    await userEvent.click(await screen.findByRole("button",{name:"宿主连接"}));await userEvent.click(screen.getByRole("button",{name:"管理"}));
    await userEvent.click(screen.getByRole("button",{name:"测试连接"}));expect(screen.getByRole("button",{name:"正在测试…"})).toBeDisabled();
  });
  it("uses a password field and clears credentials after submission without rendering the secret",async()=>{
    vi.mocked(api.setManagedSkillHostCredential).mockResolvedValue({credential_fingerprint:"sha256:EFGH",status:"pending_test"});
    renderPage([enabled],[host]);await userEvent.click(await screen.findByRole("button",{name:"宿主连接"}));await userEvent.click(screen.getByRole("button",{name:"管理"}));
    const input=screen.getByLabelText("宿主凭据") as HTMLInputElement;expect(input.type).toBe("password");await userEvent.type(input,"very-private-secret");
    await userEvent.click(screen.getByRole("button",{name:"配置 / 轮换"}));await waitFor(()=>expect(input).toHaveValue(""));
    expect(screen.queryByText("very-private-secret")).not.toBeInTheDocument();
  });
  it("reports connected Host count and exposes persisted Host management",async()=>{
    renderPage([enabled],[host]);expect(await screen.findByText("Frontend Design")).toBeInTheDocument();
    const strip=screen.getByLabelText("Agent Skill 状态摘要");await waitFor(()=>expect(within(strip).getByText((_,node)=>node?.textContent==="已连接宿主 1")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button",{name:"宿主连接"}));expect(screen.getByText("国内测试宿主")).toBeInTheDocument();
  });
});
