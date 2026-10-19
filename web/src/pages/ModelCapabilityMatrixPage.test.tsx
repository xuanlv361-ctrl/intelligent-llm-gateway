// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "../i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import ModelCapabilityMatrixPage from './ModelCapabilityMatrixPage';
import {api,CapabilityKey,ModelCapabilitiesOverview,ModelCapabilityCell,ModelMappingsResponse} from '../services/api';

vi.mock('../services/api',async()=>{
  const actual=await vi.importActual<typeof import('../services/api')>('../services/api');
  return {...actual,api:{...actual.api,modelCapabilitiesOverview:vi.fn(),modelCapabilityDetail:vi.fn(),modelMappings:vi.fn(),ensureModelCapabilities:vi.fn()}};
});

const cell=(status:ModelCapabilityCell['status'],sample=0):ModelCapabilityCell=>({status,evidence_count:sample,sample_count:sample,success_count:sample,failure_count:0,sources:sample?['realtime_execution']:[]});
const capabilities=Object.fromEntries((['text','image_understanding','image_generation','audio_input','audio_output','video_input','video_generation','streaming','tools'] as CapabilityKey[]).map(key=>[key,cell(key==='text'||key==='streaming'?'observed':'pending',key==='text'?12:key==='streaming'?5:0)])) as Record<CapabilityKey,ModelCapabilityCell>;
const overview:ModelCapabilitiesOverview={
  status:'ready',update_status:{status:'ready'},environment_id:'china_uat',catalog_status:'ready',catalog_model_count:153,
  call_evidence_model_count:9,confirmed_model_count:2,observed_model_count:7,pending_model_count:144,unsupported_model_count:0,
  mapping_count:11,recent_24h_calls:62,historical_log_count:646,realtime_log_count:219,evidence_count:104,last_sync_at:'2026-08-06T12:00:00Z',last_aggregated_at:'2026-08-06T12:01:00Z',
  models:[{model_id:'kimi-k3',display_name:'Kimi K3',provider:'Moonshot',endpoints:['/v1/chat/completions'],tags:['text'],context_limit:131072,pricing_type:'token',catalog_updated_at:'2026-08-06T11:00:00Z',capabilities,
    call_summary:{call_count:12,success_count:11,success_rate:11/12,stream_count:5,non_stream_count:7,p50_ms:1200,p95_ms:3500,input_tokens:880,output_tokens:430,actual_cost:.04,last_request_id:'REQ-REAL',last_called_at:'2026-08-06T11:55:00Z'},evidence_summary:{status:'observed',evidence_count:17,sources:['realtime_execution','historical_uat_csv'],last_verified_at:'2026-08-06T11:55:00Z'},limitations:['能力待审核'],technical_metadata:{evidence_version:'v1'}}],
  capability_coverage:[{capability:'text',confirmed:2,observed:7,pending:144,unsupported:0}],evidence_sources:[{source:'official_catalog',count:153},{source:'historical_uat_csv',count:646},{source:'realtime_execution',count:219}],technical_metadata:{aggregation_version:'cap-v2'}
};
const mappings:ModelMappingsResponse={status:'ready',items:[{requested_model:'kimi-k3',billed_model:'kimi-k3',actual_model:null,call_count:12,consistency_rate:null,mismatch_count:0,missing_actual_count:12,last_observed:'2026-08-06T11:55:00Z',evidence_level:'historical_observation',source:'historical_uat_csv'}],consistency_distribution:{missing_actual:12},technical_metadata:{version:'mapping-v2'}};

function renderPage(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><ModelCapabilityMatrixPage/></QueryClientProvider>)}

describe('模型能力与映射页面',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(api.modelCapabilitiesOverview).mockResolvedValue(overview);
    vi.mocked(api.modelCapabilityDetail).mockResolvedValue(overview.models[0]);
    vi.mocked(api.modelMappings).mockResolvedValue(mappings);
    vi.mocked(api.ensureModelCapabilities).mockResolvedValue({job_id:'CAP-JOB-1',status:'ready',already_running:false});
  });
  it('展示真实目录、日志与能力聚合数量',async()=>{
    renderPage();
    expect(await screen.findByRole('heading',{name:'模型能力与映射'})).toBeInTheDocument();
    expect(screen.getAllByText('153').length).toBeGreaterThan(0);
    expect(screen.getAllByText('646').length).toBeGreaterThan(0);
    expect(screen.getAllByText('219').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kimi K3').length).toBeGreaterThan(0);
  });
  it('页面打开自动ensure且不要求确认',async()=>{
    renderPage();
    await waitFor(()=>expect(api.ensureModelCapabilities).toHaveBeenCalledWith('china_uat'));
    expect(screen.queryByText(/确认增量|审批|预算/)).not.toBeInTheDocument();
  });
  it('切换模型映射后保留缺失的实际模型',async()=>{
    renderPage();
    await screen.findAllByText('Kimi K3');
    await userEvent.click(screen.getByRole('tab',{name:'模型映射'}));
    expect(await screen.findAllByText('实际模型待确认')).not.toHaveLength(0);
    expect(screen.getAllByText('历史观察').length).toBeGreaterThan(0);
  });
  it('技术详情默认折叠且主视图不展示内部契约',async()=>{
    renderPage();
    await screen.findAllByText('Kimi K3');
    const details=screen.getByText('技术详情').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('pre')).not.toBeVisible();
  });
  it('移动端语义使用模型卡片而不是压缩表格',async()=>{
    const {container}=renderPage();
    await screen.findAllByText('Kimi K3');
    expect(container.querySelector('.cap-mobile-cards article')).toBeInTheDocument();
    expect(container.querySelector('.cap-desktop-table table')).toBeInTheDocument();
  });
});
