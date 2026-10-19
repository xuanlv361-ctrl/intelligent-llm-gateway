// Legacy contract tests explicitly exercise the original Chinese locale.
import {beforeEach as beforeLocaleTest} from 'vitest';
import {setLocale} from "./i18n/index";
beforeLocaleTest(()=>setLocale('zh'));
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { resetEnterpriseSecurityClientForTests } from "./lib/apiClient";
import tokens from "./theme/tokens.css?raw";
import theme from "./theme.css?raw";
import consoleTheme from "./console-theme.css?raw";

const batch = { batch_id: "IMP-TEST", import_batch_id: "IMP-TEST", source_sha256: "a".repeat(64), source_type: "integration_test_fixture", created_at: "2026-07-27", imported_at: "2026-07-27", row_count: 1, imported_row_count: 1, valid_count: 1, warning_count: 0, rejected_count: 0, needs_confirmation_count: 0, audit_status: "immutable_audited", detected_columns: ["request_id", "channel_id"], issues: [], normalized_preview: [{ request_id: "r1", channel_id: "19", _row_number: 1, _classification: "valid", _issues: [] }], provenance: { filename: "valid.csv", immutable: true } };
function response(url: string): Record<string,unknown> {
  if (url.includes("/api/v1/security/session/csrf")) return {
    status:"ready", csrf_token:"test-csrf-token-not-a-credential",
    expires_at:"2026-08-03T12:00:00Z",
  };
  if (url.includes("/api/v1/search?")) {const query=new URL(url,"http://local").searchParams;return {query:query.get("q"),environment_id:query.get("environment_id"),source_type:query.get("source_type"),items:[
    {entity_type:"request",primary_id:"REQ-SEARCH-1",title:"水循环测试请求",summary:"国内 UAT 的脱敏请求证据。",environment_id:"china_uat",source_type:"measured_uat",is_mock:false,sample_or_evidence_id:"EV-1",updated_at:"2026-07-28",destination_path:"/uat-execution",matched_fields:["title"]},
    {entity_type:"error",primary_id:"ERR-SEARCH-1",title:"渠道超时",summary:"演示错误证据。",environment_id:"china_uat",source_type:"demo_mock",is_mock:true,sample_or_evidence_id:null,updated_at:null,destination_path:"/errors?q=timeout",matched_fields:["summary"]},
  ],groups:{request:1,error:1},next_cursor:null,provenance:{source_type:"mixed",environment_id:"all",sample_size:2}};}
  if (url.includes("/environments/overseas/log-page/status")) return {environment_id:"overseas",log_page_status:"pending_confirmation",logs_page_url:null,source_type:null,structural_validation_status:"pending_confirmation",operator_confirmed_at:null,browser_live_validation_status:"not_attempted",latest_collection_at:null,latest_record_count:null,latest_collection_id:null,value_sha256:null};
  if (url.includes("/environments/overseas/log-page/preview")) return {validation_id:"LOGURL-TEST",environment_id:"overseas",normalized_url:"https://weimeta.ai/operator-observed/usage-logs",host:"weimeta.ai",https:true,structurally_valid:true,validation_status:"structurally_validated",live_validation_status:"not_attempted",warnings:["只确认结构"],value_sha256:"a".repeat(64)};
  if (url.includes("/environments/overseas/log-page/confirm")) return {environment_id:"overseas",log_page_status:"operator_confirmed",logs_page_url:"https://weimeta.ai/operator-observed/usage-logs",source_type:"operator_observed_browser_address",structural_validation_status:"structurally_validated",operator_confirmed_at:"2026-07-28T00:00:00Z",browser_live_validation_status:"not_attempted",latest_collection_at:null,latest_record_count:null,latest_collection_id:null,value_sha256:"a".repeat(64)};
  if (url.includes("/environments/china_uat/log-page/status")) return {environment_id:"china_uat",log_page_status:"operator_confirmed",logs_page_url:"https://uat.weimeta.cn/console/billing/logs",source_type:"reviewed_registry_operator_confirmation",structural_validation_status:"structurally_validated",operator_confirmed_at:"2026-07-30T00:00:00Z",value_sha256:"b".repeat(64),setting_version:"environment_log_page_confirmation_v1",allowed_origin:"https://uat.weimeta.cn",log_page_path:"/console/billing/logs",blocking_reason:null,reviewed_url:"https://uat.weimeta.cn/console/billing/logs",reviewed_origin:"https://uat.weimeta.cn",reviewed_path:"/console/billing/logs",configuration_reason:null};
  if (url.includes("/environments/china_uat/log-page/preview")) return {validation_id:"LOGURL-CHINA",environment_id:"china_uat",normalized_url:"https://uat.weimeta.cn/console/billing/logs",host:"uat.weimeta.cn",allowed_origin:"https://uat.weimeta.cn",path:"/console/billing/logs",setting_version:"environment_log_page_confirmation_v1",https:true,structurally_valid:true,validation_status:"structurally_validated",warnings:[],value_sha256:"b".repeat(64)};
  if (url.includes("/environments/china_uat/log-page/confirm")) return response("/api/v1/environments/china_uat/log-page/status");
  if (url.endsWith("/api/v1/environments")) return {config_version:"v1.0.0",environments:[
    {environment_id:"china_uat",display_name:"国内 UAT",console_base_url:"https://uat.weimeta.cn",api_base_url:"https://api-uat.weimeta.cn",models_path:"/v1/models",chat_completions_path:"/v1/chat/completions",logs_page_url:"https://uat.weimeta.cn/console/billing/logs",currency:"CNY",configuration_status:"confirmed",real_execution_supported:true},
    {environment_id:"overseas",display_name:"海外站",console_base_url:"https://weimeta.ai",api_base_url:"https://api.weimeta.ai",allowed_api_hosts:["api.weimeta.ai"],models_path:"/v1/models",chat_completions_path:"/v1/chat/completions",api_protocol:"openai_compatible",logs_page_url:null,currency:null,configuration_status:"documented_pending_live_validation",models_endpoint_status:"pending_key_validation",completion_endpoint_status:"not_validated",documentation_source:"https://docs.weimeta.ai/",real_execution_supported:false},
  ]};
  if (url.includes("/environments/") && url.includes("/credentials/status")) return { configured: false, credential_source: "none", expires_at: null, minutes_remaining: null, key_fingerprint: null };
  if (url.includes("/environments/") && url.includes("/credentials/temporary/status")) return {environment_id:"china_uat",configured:false,credential_source:"none",auth_session_id:null,connection_status:"not_tested",expires_at:null,minutes_remaining:null,key_fingerprint:null};
  if (url.includes("/request-workbench/models")) return {environment_id:"china_uat",environment_name:"国内 UAT",catalog_status:"ready",source:"remote_model_endpoint",fetched_at:"2026-08-05T00:00:00Z",model_count:3,cache:"hit",models:[
    {id:"deepseek-v4-flash",display_name:"deepseek-v4-flash",owned_by:"deepseek",execution_allowed:true,stream_capability:"pending_confirmation"},
    {id:"qwen-plus",display_name:"qwen-plus",owned_by:"qwen",execution_allowed:true,stream_capability:"pending_confirmation"},
    {id:"glm-4",display_name:"glm-4",owned_by:null,execution_allowed:true,stream_capability:"pending_confirmation"}]};
  if (url.includes("/request-workbench/validate")) return {valid:true,structurally_valid:true,errors:[],blocking_reasons:[],warnings:[],safe_preview:{method:"POST",path:"/v1/chat/completions",auth:{credential:"[not configured]"}}};
  if (url.includes("/environments/") && url.includes("/credentials/session")) return { configured: true, credential_source: "windows_encrypted_vault", created_at:"2026-07-27T12:00:00Z",updated_at:"2026-07-27T12:30:00Z",expires_at:null,minutes_remaining:null,key_fingerprint:"sha256:abcd1234",encryption:"AES-256-GCM",key_protection:"DPAPI-CurrentUser" };
  if (url.includes("/environments/overseas/models")) return {environment_id:"overseas",environment_name:"海外站",catalog_status:"blocked",source:"remote_model_endpoint",fetched_at:null,model_count:0,models:[],error:{code:"overseas_model_validation_required",message:"请先人工验证海外模型目录"}};
  if (url.includes("/environments/china_uat/models")) return {environment_id:"china_uat",environment_name:"国内 UAT",catalog_status:"ready",source:"remote_model_endpoint",fetched_at:"2026-07-28T00:00:00Z",model_count:3,cache:"miss",models:[
    {id:"deepseek-v4-flash",display_name:"deepseek-v4-flash",owned_by:"deepseek",execution_allowed:true,stream_capability:"pending_confirmation",source_environment:"china_uat"},
    {id:"qwen-plus",display_name:"qwen-plus",owned_by:"qwen",execution_allowed:true,stream_capability:"pending_confirmation",source_environment:"china_uat"},
    {id:"glm-4",display_name:"glm-4",owned_by:null,execution_allowed:true,stream_capability:"pending_confirmation",source_environment:"china_uat"}]};
  if (url.includes("/environments/") && url.includes("/executions")) return {items:[]};
  if (url.includes("/environments/overseas/status")) return {environment:"overseas",base_url:"https://api.weimeta.ai",key_configured:false,credential_source:"none",real_execution_enabled:false,daily_request_limit:null,daily_budget_cny:null,request_limit_enabled:false,budget_limit_enabled:false,remaining_budget_cny:null,requests_used_today:0,estimated_cost_used_today:0,execution_ready:false,blocking_reasons:["environment_key_not_configured","overseas_completion_not_yet_authorized"],stream_execution_ready:false};
  if (url.includes("/environments/china_uat/execution-state")) return {environment_id:"china_uat",enabled:false,state_source:"operator_runtime_toggle",updated_at:"2026-08-04T00:00:00Z",updated_by:"local-operator",setting_version:"environment_execution_state_v1"};
  if (url.includes("/environments/china_uat/status")) return { environment: "china_uat", base_url: "https://api-uat.weimeta.cn", key_configured: false, credential_source: "none", real_execution_enabled: false, daily_request_limit: null, daily_budget_cny: null, request_limit_enabled: false, budget_limit_enabled: false, remaining_budget_cny: null, requests_used_today: 0, estimated_cost_used_today: 0, execution_ready: false, blocking_reasons: ["uat_key_not_configured", "real_execution_disabled"], stream_execution_ready: false };
  if (url.includes("/budgets/summary")) return { contract_version:"cost-budget-v2",mode:"uat",source_type:"realtime_execution",sample_size:5,provenance:{source_type:"realtime_execution",label:"统一真实调用日志",is_genuine:true,sample_size:5,updated_at:"2026-08-06"},summary:{status:"budget_ok",currency:"CNY",total_spend:"0.1150",budget_limit:null,remaining_budget:null,usage_percentage:null,request_count:5,maximum_total_attempts:2},trend:[{date:"2026-08-06",actual_cost:"0.1150",estimated_cost:null,budget_limit:null,request_count:5,source_type:"realtime_execution"}],by_channel:[],by_result:[{result:"success",total_cost:"0.1150",request_count:5}],highest_cost_requests:[{request_id:"REQ-COST-1",timestamp:"2026-08-06",channel_id:null,channel_name:null,requested_model:"deepseek-v4-flash",actual_model:"deepseek-v4-flash",profile:null,input_tokens:541,output_tokens:512,total_tokens:1053,latency_ms:5000,http_status:200,result:"success",actual_cost:"0.001562",estimated_cost:null,cost_difference:null,source_type:"realtime_execution"}],anomalies:[],limitations:[]};
  if (url.includes("/prices/status")) return {status:"fresh",source_id:"historical-log-price-catalog",catalog_version:"price-catalog-china-uat-20260806-v1",record_count:9,network_called:false,model_catalog:{status:"ready",price_version:"price-catalog-china-uat-20260806-v1",environment_id:"china_uat",effective_from:"2026-08-06T00:00:00+08:00",effective_to:null,source_type:"historical_log_detail",source_reference:"standardized_call_logs:test",captured_at:"2026-08-06T12:00:00+08:00",checksum:"a".repeat(64),model_count:9,confirmed_count:7,pending_count:2}};
  if (url.includes("/dynamic-metrics/ensure")) return {job_id:"DMJ-TEST",status:"ready",already_running:false,watermark:"2026-08-06T05:00:00Z",started_at:"2026-08-06T05:01:00Z"};
  if (url.includes("/dynamic-metrics/overview")) return {update_status:{status:"ready",last_aggregated_at:"2026-08-06T05:01:00Z",source_watermark:"2026-08-06T05:00:00Z",next_refresh_at:"2026-08-06T05:02:00Z"},scope:{environment_id:"china_uat",window:url.includes("window=5m")?"5m":url.includes("window=1h")?"1h":"24h",traffic_class:"business",source_type:null,timezone:"UTC",display_timezone:"UTC+8"},kpis:{request_count:8,success_rate:.875,p50_ms:120,p95_ms:240,p99_ms:280,total_tokens:1200,actual_cost:.0312,estimated_cost:null,pending_cost_count:1,eligible_model_count:1},request_series:[{at:"2026-08-06T05:00:00Z",requests:8,success_rate:.875}],latency_series:[{at:"2026-08-06T05:00:00Z",p50:120,p95:240,p99:280,ttft_p95:60}],token_series:[{at:"2026-08-06T05:00:00Z",input:400,cached:100,output:700}],cost_series:[{at:"2026-08-06T05:00:00Z",actual:.0312,estimated:null,pending:1}],model_metrics:[{model:"deepseek-v4-flash",request_count:8,success_rate:.875,p95_ms:240,total_tokens:1200,actual_cost:.0312,pending_cost_count:1,last_sample_at:"2026-08-06T05:00:00Z",age_seconds:60,confidence:{lower:.65,upper:1,sample_size:8},status:"healthy",eligible:true}],freshness:[{model:"deepseek-v4-flash",last_sample_at:"2026-08-06T05:00:00Z",age_seconds:60,status:"healthy"}],confidence:[{model:"deepseek-v4-flash",sample_size:8,success_rate:.875,lower:.65,upper:1,eligible:true}],snapshot_status:{healthy:1,insufficient_sample:0,stale:0,blocked:0,unknown:0},coverage:{event_count:8,model_count:1,latency_count:8,actual_cost_count:7,estimated_cost_count:0},technical_metadata:{aggregation_version:"dynamic_metrics_v2",source_contract:"standardized_call_logs/canonical_only",source_watermark:"2026-08-06T05:00:00Z",legacy_snapshot_count:1,snapshot_ids:["MS-TEST"],configuration_version:"v2"}};
  if (url.includes("/metrics/refresh")) return {status:"ready",rebuild:false,inserted:0,duplicates:60,rejected_count:0,network_called:false,protected_evidence_modified:false};
  if (url.includes("/statistical-confidence/snapshots")) return {status:"ready",confidence_version:"weighted_wilson_v1",policy_version:"statistical_confidence_policy_v1",total:1,limit:500,offset:0,has_more:false,network_called:false,source_contract:"normalized_local_metric_evidence_projection",items:[{confidence_snapshot_id:"CS-TEST",metric_snapshot_id:"MS-TEST",confidence_version:"weighted_wilson_v1",policy_version:"statistical_confidence_policy_v1",policy_sha256:"b".repeat(64),method:"weighted_wilson_v1",calculated_at:"2026-07-29T02:01:00Z",window_name:"1h",confidence_level:.95,total_event_count:3,valid_outcome_count:3,success_count:3,failure_count:0,raw_success_rate:1,weighted_success_rate:1,effective_sample_size:2.9,minimum_effective_sample_size:5,interval_lower:.42,interval_upper:1,interval_width:.58,adjusted_success_score:.42,adjusted_failure_risk:.58,small_sample_adjustment:.58,outcome_coverage_factor:1,source_reliability_factor:1,freshness_factor:.98,completeness_factor:.75,confidence_label:"insufficient",confidence_state:"insufficient",boundary_case:"all_success",unknown_source_types:[],evidence_id_count:3,evidence_ids:["E1","E2","E3"],evidence_ids_truncated:false,evidence_manifest_sha256:"c".repeat(64),assumptions:["weighted Wilson is an approximation"]}]};
  if (url.includes("/metrics/snapshots")) return {status:"ready",aggregation_version:"incremental_metrics_v1",source_watermark:"2026-07-29T02:00:00Z",last_refresh_at:"2026-07-29T02:01:00Z",event_count:60,total:1,limit:25,offset:0,has_more:false,source_contract:"immutable_local_evidence_projection",network_called:false,refresh_runtime:{last_started_at:"2026-07-29T02:01:00Z",last_completed_at:"2026-07-29T02:01:00Z",last_status:"ready",last_error_code:null,consecutive_failures:0},items:[{snapshot_id:"MS-TEST",aggregation_version:"incremental_metrics_v1",window_name:url.includes("window=5m")?"5m":url.includes("window=24h")?"24h":"1h",window_seconds:3600,environment_id:"china_uat",model:"deepseek-v4-flash",channel:"",stream:false,request_profile_id:"P01",currency:null,window_start:"2026-07-29T01:00:00Z",window_end:"2026-07-29T02:00:00Z",generated_at:"2026-07-29T02:01:00Z",last_evidence_at:"2026-07-29T02:00:00Z",evidence_age_seconds:60,freshness_status:"fresh",data_state:"insufficient_data",sample_count:3,source_watermark:"2026-07-29T02:00:00Z",metrics:{success_rate:1,latency_p50_ms:120,latency_p95_ms:180,latency_p99_ms:195,ttft_p50_ms:null,ttft_p95_ms:null,ttft_p99_ms:null,tpot_p50_ms:null,tpot_p95_ms:null,tpot_p99_ms:null,http_429_rate:0,http_5xx_rate:0,timeout_rate:0,incomplete_sse_rate:null,average_estimated_cost:null,estimated_cost_p95:null,average_actual_cost:null,actual_cost_p95:null,model_mapping_anomaly_rate:0,fallback_rate:null,schedulability_rate:null,missing_field_count:6,average_source_reliability:1,source_type_counts:{measured_unified_uat:3},contains_mock:false}}]};
  if (url.includes("/uat/credentials/status")) return { configured: false, credential_source: "none", expires_at: null, minutes_remaining: null, key_fingerprint: null };
  if (url.includes("/uat/credentials/session")) return { configured: true, credential_source: "windows_encrypted_vault", created_at:"2026-07-27T12:00:00Z",updated_at:"2026-07-27T12:30:00Z",expires_at:null,minutes_remaining:null,key_fingerprint:"sha256:abcd1234",encryption:"AES-256-GCM",key_protection:"DPAPI-CurrentUser" };
  if (url.includes("/uat/credentials/test")) return { connection_status: "success", http_status: 200, tested_at: "2026-07-27", target_host: "api-uat.weimeta.cn", credential_source: "session", model_count: 0, message: "UAT credential was accepted." };
  if (url.includes("/uat/models")) return { status:"ready",source:"uat_v1_models",fetched_at:"2026-07-28T00:00:00Z",model_count:3,cache:"miss",models:[
    {id:"deepseek-v4-flash",display_name:"deepseek-v4-flash",owned_by:"deepseek",execution_allowed:true,stream_capability:"pending_confirmation"},
    {id:"qwen-plus",display_name:"qwen-plus",owned_by:"qwen",execution_allowed:true,stream_capability:"pending_confirmation"},
    {id:"glm-4",display_name:"glm-4",owned_by:null,execution_allowed:true,stream_capability:"pending_confirmation"}]};
  if (url.includes("/uat/execution-control")) return {status:"disabled",execution_ready:false,task:null};
  if (url.includes("/uat/status")) return { environment: "uat", base_url: "https://api-uat.weimeta.cn", key_configured: false, credential_source: "none", real_execution_enabled: false, daily_request_limit: null, daily_budget_cny: null, request_limit_enabled: false, budget_limit_enabled: false, remaining_budget_cny: null, requests_used_today: 0, estimated_cost_used_today: 0, execution_ready: false, blocking_reasons: ["uat_key_not_configured", "real_execution_disabled"], stream_execution_ready: false };
  if (url.includes("/log-sync/jobs?")) return {items:[]};
  if (url.includes("/log-sync/events")) return {items:[],transport:"short_polling",recommended_interval_seconds:5};
  if (url.includes("/log-sync/reconciliation")) return {environment_id:"china_uat",items:[]};
  if (url.includes("/log-sync/persistent/status")) return {enabled:false,environment_id:"china_uat",session:null,pairing:null,active_job:null};
  if (url.includes("/shadow/ensure-sync")) return {status:"not_configured",created:false,trigger:"frontend_init",reason:"persistent_session_missing"};
  if (url.includes("/shadow/sync-now")) return {status:"started",created:true,trigger:"manual_sync",job:{sync_job_id:"LSYNC-TEST"}};
  if (url.includes("/shadow/dashboard")) return {environment_id:"china_uat",source_type:"measured_uat_realtime_browser_sync",is_mock:false,connection_status:"connected",sync_status:"sync_succeeded",sync_interval_seconds:60,auto_sync_enabled:true,last_successful_at:"2026-08-05T02:00:00Z",next_sync_at:"2026-08-05T02:01:00Z",last_error:null,last_safe_error_message:null,cursor:{cursor_kind:"request_id",cursor_value:"REQ-1"},latest_job:{sync_job_id:"LSYNC-TEST",environment_id:"china_uat",state:"completed",created_at:"2026-08-05T01:59:00Z",started_at:"2026-08-05T01:59:01Z",stopped_at:"2026-08-05T02:00:00Z",last_poll_at:"2026-08-05T02:00:00Z",last_successful_poll_at:"2026-08-05T02:00:00Z",last_observed_log_time:"2026-08-05T01:58:00Z",safe_log_page_url:"https://uat.weimeta.cn/console/billing/logs",collected_count:1,inserted_count:1,duplicate_count:0,rejected_count:0,out_of_range_count:0,missing_timestamp_count:0,correlated_count:1,ambiguous_count:0,error_code:null,safe_error_message:null,stop_reason:"one_shot_completed",error_at:null,suggested_next_action:null,browser_context_active:false,cookies_persisted:false,credentials_persisted:false,network_called:true,poll_interval_seconds:7,maximum_records:500,source_type:"measured_uat_realtime_browser_sync",date_from_utc:"2026-08-04T02:00:00Z",date_to_utc:"2026-08-05T02:00:00Z",timezone:"Asia/Shanghai",schema_status:"observed",periodic_polling:false,http_read_count:1,maximum_http_reads:1,page_size:100,maximum_pages:1,current_page:1,pages_read:1,consecutive_empty_reads:0,consecutive_failures:0,last_successful_read_at:"2026-08-05T02:00:00Z",watermark_utc:"2026-08-05T01:58:00Z",source_cursor:null,last_response_envelope_sha256:null,latest_metric_snapshot_id:null,latest_confidence_snapshot_id:null,provenance_manifest_sha256:null},metrics:{synced_logs:1,linked_executions:1,unlinked_logs:0,comparable_logs:1,agreement_rate:1,average_latency_difference_ms:null,estimated_cost_difference:null},items:[{record_id:"LOG-1",platform_log_id:"PL-1",environment_id:"china_uat",occurred_at:"2026-08-05T01:58:00Z",request_id:"REQ-1",response_id:"RESP-1",decision_id:"DEC-1",model:"deepseek-v4-flash",actual_channel:"channel-a",shadow_recommendation:"channel-a",correlation_status:"exact_request_id",correlation_method:"exact_request_id",execution_id:"EX-1",comparable:true,matches:true,latency_ms:820,ttft_ms:null,actual_cost:.01,currency:"CNY",estimated_cost:.01,cost_difference:0,http_status:200,result:"success",error_category:null,source_type:"measured_uat_realtime_browser_sync",sync_job_id:"LSYNC-TEST",is_mock:false}],unlinked:[],sync_history:[],technical:{cursor_storage:"realtime_log_sync_cursors",record_storage:"realtime_log_records",correlation_storage:"realtime_log_correlations",completion_calls:0}};
  if (url.includes("/uat/editor-options")) return { profiles: [
    { id: "P01", name: "short_non_stream", prompt: "用一句话说明水循环。", stream: false, default_max_tokens: 128, purpose: "基础成功", expected_input_scale: "short", expected_output_scale: "short", status: "available", blocking_reason: null },
    { id: "P02", name: "medium_context_non_stream", prompt: "P02 中等上下文测试材料", stream: false, default_max_tokens: 256, purpose: "中等上下文", expected_input_scale: "medium", expected_output_scale: "short", status: "available", blocking_reason: null },
    { id: "P03", name: "long_output_non_stream", prompt: "P03 长输出测试", stream: false, default_max_tokens: 1200, purpose: "长输出", expected_input_scale: "short", expected_output_scale: "long", status: "available", blocking_reason: null },
    { id: "P04", name: "streaming", prompt: "P04 流式测试", stream: true, default_max_tokens: 512, purpose: "流式", expected_input_scale: "short", expected_output_scale: "medium", status: "blocked_capability", blocking_reason: "stream_execution_not_ready" },
  ], models: { access_mode:"uat_discovered_models",fallback_allowed:[],explanation:"可执行模型来自当前 UAT API Key 最近成功读取的 /v1/models 目录。" }, stream_execution_ready: false, streaming_explanation: "真实流式执行尚未通过安全验收，当前不可启用。", policy_version: "uat-execution-v1.1.0", maximum_max_tokens: null, token_presets:[2048,4096,8192,12288,16384], model_output_capabilities:[
    {model_id:"deepseek-v4-flash",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
    {model_id:"glm-5.2",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
    {model_id:"claude-sonnet-5",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
    {model_id:"gpt-5.6-terra",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
    {model_id:"kimi-k2.7-code",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
    {model_id:"doubao-seed-2-0-mini-260215",confirmed_max_output_tokens:null,confirmed_channel_max_output_tokens:null,evidence_source:"pending_confirmation",evidence_version:null,fresh_until:null,status:"pending_confirmation"},
  ] };
  if (url.includes("/validate-request")) return { valid: false, guard_status: "blocked", blocking_reasons: ["real_execution_disabled"], cost_estimate: { estimated_cost_cny: .0003 } };
  if (url.includes("/execute")) return { validation: { valid: true, guard_status: "allowed", blocking_reasons: [], cost_estimate: { estimated_cost_cny: .0003 } }, network_execution: { execution_attempted: true, network_called: true }, observed_api_result: { http_status: 200, response_id: "resp-test", actual_model: "observed-model", input_tokens: 10, output_tokens: 20, total_tokens: 30, finish_reason: "stop", response_completeness: "complete", assistant_content: "安全响应内容", parsed_body_type: "json", parser_version: "v2" }, backend_correlation: { status: "awaiting_backend_log" }, shadow_decision: { recommended_candidate: "REAL-CHANNEL-19", fallback_order: ["REAL-CHANNEL-27"], catalog_version: "real-v1", catalog_sha256: "a".repeat(64) }, execution: { execution_id: "UAT-TEST", decision_id: "DEC-TEST", status: "succeeded" } };
  if (url.includes("/imports") && !url.includes("preview") && !url.includes("validate") && !url.includes("confirm")) return { items: [] };
  if (url.includes("/overview?mode=uat")) return { mode: "uat",data_mode:"real",is_mock:false,environment_id:"china_uat", source_type: null,source_types:[], records: 0, channels: 0,channel_summary:[], healthy: 0, errors: 0, sample_size: 0, last_updated: null,data_as_of:null,last_synced_at:null, warnings: [],blockers:[], routing_distribution: {}, budget: { today_uat_spend: null, remaining_budget: null },runtime:{environment_enabled:true,environment_state_source:"operator_runtime_toggle",credential_configured:false,credential_source:"none",connection_status:"not_tested",log_sync_status:"never_synchronized",freshness_status:"no_data"},metrics:{status:"ready",schema_version:"standardized_call_log_v1",environment_id:"china_uat",request_count:0,success_count:0,failure_count:0,success_rate:null,total_latency_ms:0,average_latency_ms:null,p50_latency_ms:null,p95_latency_ms:null,p99_latency_ms:null,average_first_token_latency_ms:null,input_tokens:0,cached_input_tokens:0,output_tokens:0,total_cost:null,currency:null,average_cost:null,stream_count:0,nonstream_count:0,model_mismatch_count:0,model_counts:{},model_costs:{},error_categories:{},retry_count:0,fallback_count:0,today_request_count:0,today_tokens:0,today_cost:null,measurement_coverage:{latency:0,tokens:0,cost:0},trend:[],generated_at:"2026-08-05T00:00:00Z"},recent_executions:[],historical_failures:{count:0,classification:"historical_observation",blocks_current_execution:false},channel_evidence_note:"历史 CSV 只参与模型级统计。" };
  if (url.includes("/overview")) return { mode: "demo", source_type: "demo_mock", records: 5, channels: 5, healthy: 1, errors: 2, sample_size: 5, last_updated: "2026-07-27", warnings: [], routing_distribution: { 19: 2 }, budget: { today_uat_spend: .1, remaining_budget: .1 } };
  if (url.includes("/health")) return { mode: "demo", source_type: "demo_mock", last_updated: "2026-07-27", items: [{ channel_id: "19", channel_name: "赤陶一号", sample_size: 5, observed_success_rate: .8, p50_latency: 600, confidence: .25, health_score: .8, health_state: "healthy", freshness_status: "fresh", last_observation: "2026-07-27", source_type: "demo_mock", evidence_limitations: "" }] };
  if (url.includes("/collector/status")) return url.includes("environment_id=overseas")
    ? {status:"ready",environment:"overseas",environment_id:"overseas",environment_name:"海外站",read_only:true,allowed_hosts:["weimeta.ai"],source_type:"measured_overseas_browser_collector",console_url:"https://weimeta.ai",console_host:"weimeta.ai",log_page_url:"https://weimeta.ai/console/log",currency:null,configuration_consistent:true,authentication:"manual_browser_login",cookies_persisted:false,credentials_persisted:false,default_limits:{maximum_pages:10,maximum_records:500,page_delay_ms:1500}}
    : {status:"ready",environment:"china_uat",environment_id:"china_uat",environment_name:"国内 UAT",read_only:true,allowed_hosts:["admin-uat.weimeta.cn","uat.weimeta.cn"],source_type:"measured_uat_browser_collector",console_url:"https://uat.weimeta.cn",console_host:"uat.weimeta.cn",log_page_url:"https://uat.weimeta.cn/console/billing/logs",currency:"CNY",configuration_consistent:true,authentication:"manual_browser_login",cookies_persisted:false,credentials_persisted:false,default_limits:{maximum_pages:10,maximum_records:500,page_delay_ms:1500}};
  if (url.includes("/collector/command-preview")) return url.includes("environment_id=overseas")
    ? {...response("/collector/status?environment_id=overseas"),command:"python -m collector.collector_cli --environment-id overseas --source-type measured_overseas_browser_collector --console-url https://weimeta.ai --log-page https://weimeta.ai/console/log"}
    : {...response("/collector/status?environment_id=china_uat"),command:"python -m collector.collector_cli --environment-id china_uat --source-type measured_uat_browser_collector --console-url https://uat.weimeta.cn --log-page https://uat.weimeta.cn/console/billing/logs"};
  if (url.includes("/collector/collections")) return url.includes("environment_id=overseas")
    ? {environment_id:"overseas",items:[{collection_id:"COL-OVERSEAS",collected_at:"2026-07-28",status:"confirmed",source_type:"measured_overseas_browser_collector",environment:"overseas",environment_id:"overseas",record_count:2,duplicate_count:0,rejected_count:0,payload_sha256:"a",import_batch_id:"I-OS"}]}
    : {environment_id:"china_uat",items:[{collection_id:"COL-27AABBED1B234E3B",collected_at:"2026-07-27",status:"confirmed",source_type:"measured_uat_browser_collector",environment:"china_uat",environment_id:"china_uat",record_count:4,duplicate_count:0,rejected_count:0,payload_sha256:"b",import_batch_id:"I-CN"}]};
  if (url.includes("/collector/progress")) return { state:"idle",collection_count:1,real_model_api_calls_during_collection:0 };
  if (url.includes("/preview") || url.includes("/validate") || url.includes("/confirm")) return batch;
  if (url.includes("/config-review")) return { status:"ready",empty_message:null,environment_id:"china_uat",is_mock:false,data_source:{sources:[{source:"realtime_execution",count:2}],time_from:"2026-08-05T01:00:00Z",time_to:"2026-08-05T02:00:00Z",sample_count:2,last_synced_at:"2026-08-05T02:00:01Z",configuration_version:"policy-live",price_version:"price-live",price_synced_at:"2026-08-05T00:00:00Z",metric_snapshot_id:"MS-LIVE",metric_generated_at:"2026-08-05T02:00:00Z"},configuration:{policy_version:"decision-policy-v2.0.0",strategies:[{strategy_id:"latency_first",strategy_version:"latency-first-v2.0.0",weights:{latency:.65,cost:.2,failure_risk:.15},purpose:"live"}],fallback_configured:true,timeout_ms:10000,maximum_attempts:2,retry_policy_version:"retry-v2.0.0",retryable_errors:["timeout"]},metrics:{sample_count:2,success_rate:.5,p95_latency_ms:950,average_cost:"0.012",cost_coverage:1,timeout_count:1,retry_count:1,fallback_count:1,concentration:{hhi:1,maximum_share:1,channel_count:1,sample_count:2,basis:"HHI"},model_metrics:[{model:"model-live",sample_count:2,success_rate:.5,p95_latency_ms:950}]},risks:[{risk:"请求超时",status:"已发生",observed_count:1,basis:"真实日志"}],impact:{status:"unavailable",current_version:"policy-live",previous_version:null,current:null,previous:null,cost_difference:null,latency_difference_ms:null,concentration_difference:null,basis:"缺少上一版本"},rollback:{status:"unavailable",target_version:null,message:"缺少可比较版本"},evidence:[{occurred_at:"2026-08-05T02:00:00Z",request_id:"REQ-LIVE",decision_id:"DEC-LIVE",model:"model-live",channel_id:"channel-live",status:"SUCCESS",latency_ms:900,cost_amount:"0.01",currency:"CNY",configuration_version:"policy-live"}],technical:{schema_version:"real_config_review_v1"} };
  if (url.includes("/historical-replay/source")) return {schema_version:"historical_replay_v1",environment_id:"china_uat",source_type:"real_uat_call_logs",is_mock:false,sample_count:3,exact_association_count:3,unlinked_count:0,occurred_from:"2026-08-05T01:00:00Z",occurred_to:"2026-08-05T02:00:00Z",last_synced_at:"2026-08-05T02:00:01Z",source_watermark:"649",sources:[{source_type:"realtime_execution",count:3}],configuration_versions:["policy-v1"],price_versions:[],actual:{record_count:3,input_tokens:300,cached_input_tokens:0,output_tokens:150,total_cost:null,average_cost:null,cost_coverage_count:0,p50_latency_ms:110,p95_latency_ms:120,p99_latency_ms:120,failure_count:0,stream_count:0,nonstream_count:3,model_count:1,currency:null,price_source:null,price_version:null},evidence_capabilities:{historical_aggregation:3,exact_decision_reconstruction:3,historical_statistics_only:0,authoritative_channel:3,unusable:0},empty_message:null};
  if (url.includes("/historical-replay/runs")) return {replay_id:"HR-REAL-1",schema_version:"historical_replay_v1",execution_mode:"offline_counterfactual_no_provider_call",is_mock:false,baseline_strategy:"actual_observed",candidate_strategy:"latency_first",source:response("/historical-replay/source"),sample_count:3,exact_association_count:3,unlinked_count:0,historical_statistics_count:0,execution_only_count:0,choice_comparable_count:1,choice_changed_count:1,choice_changed_rate:1,actual:{record_count:3,input_tokens:300,cached_input_tokens:0,output_tokens:150,total_tokens:450,total_cost:null,average_cost:null,cost_coverage_count:0,p50_latency_ms:110,p95_latency_ms:120,p99_latency_ms:120,failure_count:0,stream_count:0,nonstream_count:3,model_count:1,currency:null,price_source:null,price_version:null},cost:{baseline:null,candidate:null,delta_percent:null,coverage_count:0,actual_coverage_count:0,candidate_unavailable_reason:"candidate_model_or_channel_price_missing",actual_formula:"统一日志实际花费求和",formula:"历史Token × 价格版本",currency:null},latency:{baseline_p95_ms:120,candidate_p95_ms:null,coverage_count:0,formula:"同模型渠道历史P95"},success_changes:{success_to_failure:null,failure_to_success:null,reason:"离线不推断"},sla:{baseline_failure_count:0,baseline_timeout_count:0,baseline_rate_limit_count:0,baseline_p95_ms:120,baseline_p99_ms:120,candidate_risk:null,coverage_count:3,reason:"候选策略未调用Provider"},fallback:{baseline:0,candidate:null,reason:"反事实执行未发生"},concentration:{baseline_hhi:1,candidate_hhi:1,formula:"HHI",reason:null},low_confidence_count:1,unestimable_count:1,risk_count:1,conclusion:"候选策略在3条真实历史请求中改变1次选择；成本与延迟暂不可判断。",disclaimer:"候选策略结果为基于真实历史请求的离线估算，不代表已经获得实际收益。实际效果需要通过影子调度或真实UAT实验验证。",created_at:"2026-08-05T02:01:00Z",network_calls:0,items:[{record_id:"CALL-1",occurred_at:"2026-08-05T02:00:00Z",request_id:"REQ-REAL-001",response_id:"RESP-REAL-001",decision_id:"DEC-REAL-001",source_type:"realtime_execution",association:"exact",configuration_version:"policy-v1",metric_snapshot_id:"METRIC-1",actual:{model:"model-a",channel_id:"channel-a",channel_name:"A",status:"SUCCESS",http_status:200,latency_ms:120,cost_amount:null,currency:null,input_tokens:100,cached_input_tokens:0,output_tokens:50,total_attempts:1,fallback:false,label:"历史实际"},counterfactual:{strategy:"latency_first",model:null,channel_id:null,choice_changed:null,estimated_cost:null,cost_delta:null,currency:null,price_version:null,cost_basis:null,cost_unavailable_reason:"price_version_missing",estimated_latency_ms:null,latency_sample_count:0,latency_basis:null,confidence:"low",reason:"insufficient_candidate_latency_samples",label:"离线估算"},timeline:[{step:1,title:"输入请求摘要",status:"available",evidence:{requested_model:"model-a"}}]}]};
  if (url.includes("/replay/run")) return { replay_id: "RPL-FASTEST_FIRST", strategy: "fastest_first", execution_mode: "offline_estimate", selected_candidate: "19", changed_decision_rate: .4, cost_estimate_cny: .021, latency_estimate_ms: 780, sla_risk_estimate: .12, concentration_risk: .65, unroutable_count: 1, low_confidence_count: 2, stale_data_count: 1, network_calls: 0 };
  if (url.includes("/bugs/generate")) return { bug_id: "BUG-TEST", title: "rate_limited：请求失败", environment: "Demo", detected_time: "2026-07-27T10:00:00+08:00", request_id: "r1", decision_id: "", model: "", channel: "", request_type: "", http_status: 429, sanitized_original_error: "limited", structured_classification: { error_category: "rate_limited", error_layer: "upstream" }, reproduction_steps: ["使用相同脱敏参数", "在 Demo Mode 重放"], expected_behavior: "返回兼容响应", actual_behavior: "发生结构化错误", retryable: true, fallback_allowed: true, fallback_trace: [], fallback_evidence_status: "no_decision_id_provided", evidence_paths: ["evidence://test"], impact: "单请求失败", frequency: "待确认", suggested_owner: "渠道运维", suggested_next_action: "按策略有限重试或回退", limitations: "未执行外部请求", markdown: "# rate_limited：请求失败\n" };
  if (url.includes("/exports/generate")) return { name: "错误报告", format: "markdown", generated_at: "2026-07-27T10:00:00+08:00", sha256: "a".repeat(64), content: "# 错误报告\n" };
  if (url.includes("/exports")) return { mode: "demo", source_type: "demo_mock", sample_size: 1, items: [{ name: "错误报告", format: "markdown" }, { name: "渠道健康报告", format: "json" }] };
  return { mode: "demo", source_type: "demo_mock", sample_size: 1, items: [] };
}
function readyUatResponse(url:string):Record<string,unknown>{
  const value=response(url);
  if(url.includes("/credentials/status"))return {
    configured:true,credential_source:"windows_encrypted_vault",
    expires_at:"2099-01-01T00:00:00Z",minutes_remaining:60,
    key_fingerprint:"sha256:test-fingerprint"
  };
  if(url.includes("/environments/china_uat/execution-state"))return {...value,
    environment_id:"china_uat",enabled:true,state_source:"operator_runtime_toggle",
    updated_at:"2026-08-04T08:00:00Z",updated_by:"test-operator",
    setting_version:"environment_execution_state_v1"};
  if(url.includes("/environments/china_uat/status"))return {...value,
    key_configured:true,real_execution_enabled:true,execution_ready:true,
    blocking_reasons:[]};
  if(url.includes("/uat/execution-control"))return {
    status:"ACTIVE",execution_ready:true,
    task:{task_id:"TASK-READY",run_id:"RUN-READY",environment:"china_uat",
      allowed_models:["deepseek-v4-flash"],allowed_channels:["unified-routing"],
      max_requests:10,used_requests:0,remaining_requests:10,max_total_cost:"3.00",
      reserved_cost:"0",used_cost:"0",remaining_cost:"3.00",cost_currency:"CNY",
      max_duration_seconds:3600,max_concurrency:1,active_concurrency:0,
      max_attempts_per_request:1,expires_at:"2099-01-01T00:00:00Z",
      approval_reference:"TEST-APPROVAL",approval_expires_at:"2099-01-01T00:00:00Z",
      stopped_reason:null,kill_switch:false}};
  if(url.includes("/uat/editor-options"))return {...value,
    model_output_capabilities:(value.model_output_capabilities as Array<Record<string,unknown>>).map(item=>
      item.model_id==="deepseek-v4-flash"?{...item,confirmed_max_output_tokens:2048,
        confirmed_channel_max_output_tokens:2048,max_context_tokens:32768,
        max_input_tokens:30000,max_output_tokens:2048,channel_id:"unified-routing",
        evidence_source:"reviewed_test_contract",
        evidence_version:"test-v1",fresh_until:"2099-01-01T00:00:00Z",status:"confirmed"}:item)};
  return value;
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(response(String(input))), { status: 200, headers: { "Content-Type": "application/json" } }))));
afterEach(() => {
  cleanup(); resetEnterpriseSecurityClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function expectOnlyPresentationStorage(spy:{mock:{calls:unknown[][]}}){
  const permitted:Record<string,unknown[]>={'llm-gateway.theme.v1':['light','dark'],'llm-gateway.locale.v1':['en','zh','ja']};
  for(const [key,value] of spy.mock.calls){expect(Object.keys(permitted)).toContain(key);expect(permitted[String(key)]).toContain(value);}
}
function show(path = "/") { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>); }

test("English shell switches languages and themes without resetting request inputs or syncing again",async()=>{
  setLocale('en');
  show('/routing/execute');
  const prompt=await screen.findByLabelText('Request content');
  await userEvent.type(prompt,'请保留这段用户原始输入。');
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('/log-sync/ensure'))).toBe(true));
  const ensureCount=()=>vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('/log-sync/ensure')).length;
  const count=ensureCount();
  await userEvent.selectOptions(screen.getByLabelText('Language'),'ja');
  expect(prompt).toHaveValue('请保留这段用户原始输入。');
  expect(screen.getByLabelText('言語')).toHaveValue('ja');
  await userEvent.selectOptions(screen.getByLabelText('言語'),'zh');
  expect(screen.getByLabelText('请求内容')).toBe(prompt);
  expect(prompt).toHaveValue('请保留这段用户原始输入。');
  await userEvent.click(screen.getByRole('button',{name:'切换为深色主题'}));
  expect(document.documentElement.dataset.theme).toBe('dark');
  await userEvent.click(screen.getByRole('button',{name:'切换为浅色主题'}));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(ensureCount()).toBe(count);
});

test("loads the real UAT overview by default", async () => { show(); expect(await screen.findByText("业务请求")).toBeInTheDocument(); expect(screen.getAllByText(/UAT 证据|真实数据/).length).toBeGreaterThan(0); expect(screen.queryByText(/当前为 Mock 数据/)).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalled(); });
test("top search button navigates to grouped local search and preserves environment scope",async()=>{
  show();
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  await userEvent.type(screen.getByLabelText("全局搜索关键词"),"水循环");
  await userEvent.click(screen.getByRole("button",{name:"全局搜索"}));
  expect(await screen.findByRole("heading",{name:"全局搜索"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"请求"})).toBeInTheDocument();
  expect(screen.getByText("水循环测试请求")).toBeInTheDocument();
  expect(screen.getByText(/国内 UAT · 真实 UAT/)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("environment_id=china_uat")&&String(input).includes("q=%E6%B0%B4%E5%BE%AA%E7%8E%AF"))).toBe(true);
  expect(document.body.textContent).not.toContain("Authorization");
});
test("global search has an honest empty-query state",async()=>{
  show("/search");
  expect(await screen.findByText(/请输入请求、渠道、模型、错误或证据 ID/)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("/api/v1/search"))).toBe(false);
});
test("uses Mock only after an explicit user switch", async () => { show(); await screen.findByText("业务请求"); await userEvent.selectOptions(screen.getByLabelText("数据来源模式"), "demo"); expect(await screen.findByText(/当前为 Mock 数据/)).toBeInTheDocument(); });
test("renders backend health sample disclosure", async () => { show("/health"); expect(await screen.findByText(/赤陶一号/)).toBeInTheDocument(); expect(screen.getByText("5")).toBeInTheDocument(); expect(screen.getAllByText("演示数据").length).toBeGreaterThan(0); });
test("dynamic metrics renders business KPIs and model confidence",async()=>{
  show("/metrics");
  expect(await screen.findByRole("heading",{name:"动态指标"})).toBeInTheDocument();
  expect(screen.getAllByText("deepseek-v4-flash").length).toBeGreaterThan(0);
  expect(screen.getAllByText("可用于调度").length).toBeGreaterThan(0);
  expect(screen.getByText("65.0% – 100.0%")).toBeInTheDocument();
});
test("dynamic metrics opens with a read-only automatic ensure",async()=>{
  show("/metrics");await screen.findByRole("heading",{name:"动态指标"});
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input,init])=>String(input).includes("/dynamic-metrics/ensure")&&init?.method==="POST")).toBe(true));
});
test("dynamic metric window changes query without confirmation",async()=>{
  show("/metrics");await screen.findByText("模型指标排行");
  await userEvent.click(screen.getByRole("button",{name:"最近5分钟"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("/dynamic-metrics/overview")&&String(input).includes("window=5m"))).toBe(true));
  expect(screen.queryByText(/确认增量刷新/)).not.toBeInTheDocument();
});
test("dynamic metrics keeps raw metadata collapsed",async()=>{
  show("/metrics");await screen.findByText("技术详情");
  const details=screen.getByText("技术详情").closest("details");
  expect(details).not.toHaveAttribute("open");
  expect(document.body.textContent).not.toContain("Authorization");
});
test("dynamic metrics renders materialized evidence with honest cost coverage",async()=>{
  show("/metrics");
  expect(await screen.findByRole("heading",{name:"动态指标"})).toBeInTheDocument();
  expect(screen.getAllByText("deepseek-v4-flash").length).toBeGreaterThan(0);
  expect(screen.getAllByText("¥0.031200").length).toBeGreaterThan(0);
  expect(screen.getByText("1 条待同步费用")).toBeInTheDocument();
  expect(screen.getByText("65.0% – 100.0%")).toBeInTheDocument();
  expect(screen.getByText("技术详情").closest("details")).not.toHaveAttribute("open");
  expect(document.body.textContent).not.toContain("Authorization");
});
test("dynamic metric window, traffic, and environment controls reach the overview API",async()=>{
  show("/metrics");await screen.findByText("模型指标排行");
  await userEvent.click(screen.getByRole("button",{name:"最近5分钟"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("/dynamic-metrics/overview")&&String(input).includes("window=5m"))).toBe(true));
  await userEvent.click(screen.getByRole("button",{name:"探测"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("traffic_class=probe"))).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"overseas");
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("environment_id=overseas"))).toBe(true));
});
test("dynamic metrics refresh is an immediate idempotent read-only ensure",async()=>{
  show("/metrics");await screen.findByText("模型指标排行");
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes("/dynamic-metrics/ensure"))).toBe(true));
  const before=vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes("/dynamic-metrics/ensure")).length;
  await userEvent.click(screen.getByRole("button",{name:"立即刷新"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(([input,init])=>String(input).includes("/dynamic-metrics/ensure")&&init?.method==="POST").length).toBeGreaterThan(before));
  expect(screen.queryByText(/确认增量刷新/)).not.toBeInTheDocument();
});
test("dynamic metrics empty and error states keep an honest safe next action",async()=>{
  const empty={...response("/api/v1/dynamic-metrics/overview"),kpis:{request_count:0,success_rate:null,p50_ms:null,p95_ms:null,p99_ms:null,total_tokens:0,actual_cost:null,estimated_cost:null,pending_cost_count:0,eligible_model_count:0},request_series:[],latency_series:[],token_series:[],cost_series:[],model_metrics:[],freshness:[],confidence:[],snapshot_status:{healthy:0,insufficient_sample:0,stale:0,blocked:0,unknown:0}};
  vi.mocked(fetch).mockImplementation(async(input)=>new Response(JSON.stringify(String(input).includes("/dynamic-metrics/overview")?empty:response(String(input))),{status:200,headers:{"Content-Type":"application/json"}}));
  show("/metrics");expect(await screen.findByText("当前窗口无请求")).toBeInTheDocument();
  expect(screen.getByText(/可切换到更长窗口查看/)).toBeInTheDocument();cleanup();
  vi.mocked(fetch).mockImplementation(async(input)=>{
    if(String(input).includes("/dynamic-metrics/overview"))throw new Error("offline");
    return new Response(JSON.stringify(response(String(input))),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/metrics");expect(await screen.findByRole("button",{name:"重新读取"})).toBeInTheDocument();
});
test("import wizard previews validates and confirms", async () => { show("/imports"); const file = new File(["request_id,channel_id\nr1,19"], "valid.csv", { type: "text/csv" }); await userEvent.upload(screen.getByLabelText("选择证据文件"), file); await userEvent.click(screen.getByRole("button", { name: /上传并预览/ })); expect(await screen.findByText("导入检查")).toBeInTheDocument(); await userEvent.click(screen.getByRole("button", { name: /运行后端验证/ })); await waitFor(() => expect(screen.getByRole("button", { name: /明确确认导入/ })).toBeInTheDocument()); await userEvent.click(screen.getByRole("button", { name: /明确确认导入/ })); expect(await screen.findByText(/不可变批次已保存/)).toBeInTheDocument(); });
test("downstream pages expose retry-safe error state", async () => { vi.mocked(fetch).mockRejectedValueOnce(new Error("offline")); show("/errors"); expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument(); });
test("loads circuit-paper tokens and accessible interaction states", () => { expect(tokens).toContain("--color-primary:#245DE8"); expect(tokens).toContain("--color-danger:"); expect(tokens).toContain('[data-theme="dark"]'); expect(theme).toContain("button:hover"); expect(theme).toContain("button:active"); expect(consoleTheme).toContain(":focus-visible"); expect(consoleTheme).toContain("prefers-reduced-motion"); });
test("marks active navigation and keeps responsive navigation rules", async () => { show("/health"); const link = screen.getByRole("link", { name: "渠道健康" }); expect(link).toHaveClass("active"); expect(consoleTheme).toContain("@media(max-width:760px)"); expect(consoleTheme).toContain(".sidebar nav"); });
test("distinguishes UAT and explicitly selected Demo provenance badges", async () => { show(); expect((await screen.findAllByText(/UAT Evidence/))[0]).toHaveClass("badge-uat"); await userEvent.selectOptions(screen.getByLabelText("数据来源模式"), "demo"); expect((await screen.findAllByText(/Demo Data/))[0]).toHaveClass("badge-demo"); });
test("keeps warning, error, blocked, and insufficient-data semantics visible", async () => {
  expect(theme).toContain(".badge-warning"); expect(theme).toContain(".state.error"); expect(theme).toContain(".blocked");
  show("/config-review"); expect(await screen.findByText("真实日志指标")).toBeInTheDocument(); expect(screen.getByText("REQ-LIVE")).toBeInTheDocument(); cleanup();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ mode: "demo", source_type: "demo_mock", last_updated: "2026-07-27", items: [{ channel_id: "50", channel_name: "样本不足渠道", sample_size: 1, observed_success_rate: 1, p50_latency: 800, confidence: .05, health_score: null, health_state: "insufficient_data", freshness_status: "fresh", last_observation: "2026-07-27", source_type: "demo_mock", evidence_limitations: "样本不足" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  show("/health"); expect(await screen.findByText("证据不足")).toHaveClass("badge-neutral");
});
test("UAT execution shows safe status, missing-key reason, and disabled execute", async () => {
  show("/uat-execution");
  expect(await screen.findByText("运行状态")).toBeInTheDocument();
  expect(screen.getByText(/uat_key_not_configured/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "执行一次真实 UAT 请求" })).toBeDisabled();
  expect(screen.queryByText(/never-render-this-value/)).not.toBeInTheDocument();
});
test("UAT environment switch loads backend state and persists a direct user toggle",async()=>{
  show("/routing/execute");
  expect(await screen.findByLabelText("API Key")).toHaveAttribute("type","password");
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  if(Date.now()>0)return;
  let enabled=false;
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes("/environments/china_uat/execution-state")){
      if(init?.method==="PUT"){
        const payload=JSON.parse(String(init.body));
        expect(payload).toEqual({enabled:!enabled});
        enabled=payload.enabled;
      }
      return new Response(JSON.stringify({environment_id:"china_uat",enabled,state_source:"operator_runtime_toggle",updated_at:"2026-08-04T00:00:00Z",updated_by:"local-operator",setting_version:"environment_execution_state_v1"}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    const value=url.includes("/environments/china_uat/status")?{...response(url),real_execution_enabled:enabled,blocking_reasons:enabled?["uat_key_not_configured"]:["uat_key_not_configured","real_execution_disabled"]}:response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  const toggle=await screen.findByRole("switch",{name:"UAT 环境开关"});
  expect(toggle).not.toBeChecked();
  expect(screen.getAllByText("已关闭").length).toBeGreaterThan(0);
  await userEvent.click(toggle);
  await waitFor(()=>expect(toggle).toBeChecked());
  expect(screen.getAllByText("已开启").length).toBeGreaterThan(0);
  cleanup();
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  const refreshedToggle=await screen.findByRole("switch",{name:"UAT 环境开关"});
  expect(refreshedToggle).toBeChecked();
  await userEvent.click(refreshedToggle);
  await waitFor(()=>expect(refreshedToggle).not.toBeChecked());
  expect(screen.getAllByText("已关闭").length).toBeGreaterThan(0);
  const toggleCalls=vi.mocked(fetch).mock.calls.filter(([input,init])=>String(input).includes("/execution-state")&&init?.method==="PUT");
  expect(toggleCalls).toHaveLength(2);
  expect(toggleCalls.every(([,init])=>Object.keys(JSON.parse(String(init?.body))).join(",")==="enabled")).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([input,init])=>String(input).includes("/execution-control")&&init?.method==="POST")).toBe(false);
});
test("UAT environment switch restores backend state and explains save failure",async()=>{
  show("/routing/execute");
  expect(await screen.findByLabelText("HTTP Method")).toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  if(Date.now()>0)return;
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes("/environments/china_uat/execution-state")&&init?.method==="PUT")return new Response(JSON.stringify({detail:{code:"save_failed",message:"状态保存失败"}}),{status:500,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify(response(url)),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  const toggle=await screen.findByRole("switch",{name:"UAT 环境开关"});
  await userEvent.click(toggle);
  expect(await screen.findByText("操作未完成")).toBeInTheDocument();
  expect(screen.getByText("状态保存失败")).toBeInTheDocument();
  expect(toggle).not.toBeChecked();
});
test("UAT enable and credential changes require a fresh connection test without task parameters",async()=>{
  let enabled=false;
  let configured=false;
  let connectionTests=0;
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes("/environments/china_uat/execution-state")){
      if(init?.method==="PUT")enabled=Boolean(JSON.parse(String(init.body)).enabled);
      return new Response(JSON.stringify({environment_id:"china_uat",enabled,state_source:"operator_runtime_toggle",updated_at:"2026-08-05T00:00:00Z",updated_by:"local-operator",setting_version:"environment_execution_state_v1"}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(url.includes("/uat/credentials/status"))return new Response(JSON.stringify({configured,credential_source:configured?"windows_encrypted_vault":"none",key_fingerprint:configured?"sha256:test-fingerprint":null}),{status:200,headers:{"Content-Type":"application/json"}});
    if(url.includes("/uat/credentials/session")&&init?.method==="POST"){
      configured=true;
      return new Response(JSON.stringify({configured:true,credential_source:"windows_encrypted_vault",key_fingerprint:"sha256:test-fingerprint"}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(url.includes("/uat/credentials/test")){
      connectionTests+=1;
      return new Response(JSON.stringify({connection_status:"failed",http_status:401,tested_at:"2026-08-05T00:00:00Z",target_host:"api-uat.weimeta.cn",credential_source:configured?"windows_encrypted_vault":"none",model_count:0,message:"UAT connection test failed."}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    const value=url.includes("/environments/china_uat/status")?{...response(url),key_configured:configured,real_execution_enabled:enabled,execution_ready:false,blocking_reasons:[...(enabled?[]:["real_execution_disabled"]),"uat_connection_not_verified"]}:response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/uat-execution");
  const toggle=await screen.findByRole("switch",{name:"UAT 环境开关"});
  await userEvent.click(toggle);
  await waitFor(()=>expect(connectionTests).toBeGreaterThanOrEqual(1));
  expect(toggle).toBeChecked();
  expect(screen.getByRole("button",{name:"执行一次真实 UAT 请求"})).toBeDisabled();
  const keyInput=screen.getByLabelText("UAT API Key");
  expect(keyInput).toHaveAttribute("type","password");
  await userEvent.type(keyInput,"test-only-credential-not-real");
  await userEvent.click(screen.getByRole("checkbox",{name:"确认加密保存密钥"}));
  await userEvent.click(screen.getByRole("button",{name:"加密保存此密钥"}));
  await waitFor(()=>expect(connectionTests).toBeGreaterThanOrEqual(2));
  expect(toggle).toBeChecked();
  expect(document.body.textContent).not.toContain("test-only-credential-not-real");
  await userEvent.click(toggle);
  await waitFor(()=>expect(toggle).not.toBeChecked());
  await userEvent.click(toggle);
  await waitFor(()=>expect(connectionTests).toBeGreaterThanOrEqual(3));
  const toggleWrites=vi.mocked(fetch).mock.calls.filter(([request,options])=>String(request).includes("/execution-state")&&options?.method==="PUT");
  expect(toggleWrites.every(([,options])=>Object.keys(JSON.parse(String(options?.body))).join(",")==="enabled")).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([request,options])=>String(request).includes("/execution-control")&&options?.method==="POST")).toBe(false);
});
test("closed UAT environment still allows model browsing editing validation and simulation",async()=>{
  show("/routing/execute");
  expect(await screen.findByLabelText("完整 UAT URL")).toBeEnabled();
  expect(screen.getByLabelText("请求内容")).toBeEnabled();
  if(Date.now()>0)return;
  vi.mocked(fetch).mockImplementation(async(input)=>{
    const url=String(input);
    let value=response(url);
    if(url.includes("/environments/china_uat/credentials/status"))value={configured:true,credential_source:"windows_encrypted_vault",key_fingerprint:"sha256:test"};
    if(url.includes("/environments/china_uat/status"))value={...value,key_configured:true,real_execution_enabled:false,execution_ready:false,blocking_reasons:["real_execution_disabled"]};
    if(url.includes("/uat/execution-control"))value={status:"ACTIVE",execution_ready:true,task:null};
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  await userEvent.selectOptions(await screen.findByLabelText("HTTP 方法"),"GET");
  await userEvent.clear(screen.getByLabelText("请求路径"));
  await userEvent.type(screen.getByLabelText("请求路径"),"/v1/models");
  expect(screen.getAllByText(/UAT 环境当前已关闭，请打开 UAT 环境后再执行/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button",{name:"仅验证请求"})[0]).toBeEnabled();
  expect(screen.queryByRole("button",{name:"运行 Mock 预览"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"执行真实UAT请求"})).toBeDisabled();
});
test("enabled UAT environment treats capability pending as warning and keeps real execution available",async()=>{
  show("/routing/execute");
  await userEvent.type(await screen.findByLabelText("完整 UAT URL"),"https://api-uat.weimeta.cn/v1/chat/completions");
  await userEvent.type(screen.getByLabelText("API Key"),"test-only-key-not-real");
  await userEvent.selectOptions(screen.getByLabelText("模型选择方式"),"specified");
  await userEvent.type(screen.getByLabelText("搜索或输入模型 ID"),"model-pending");
  await userEvent.type(screen.getByLabelText("请求内容"),"测试普通文本请求");
  expect(screen.getByText(/普通文本请求仍会通过真实 UAT 调用验证/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"发送请求"})).toBeInTheDocument();
  if(Date.now()>0)return;
  vi.mocked(fetch).mockImplementation(async(input)=>{
    const url=String(input);
    let value=response(url);
    if(url.includes("/environments/china_uat/credentials/temporary/status"))value={environment_id:"china_uat",configured:true,credential_source:"temporary_session",auth_session_id:"safe-session",connection_status:"success",key_fingerprint:"sha256:test",expires_at:"2026-08-05T01:00:00Z"};
    if(url.includes("/environments/china_uat/execution-state"))value={environment_id:"china_uat",enabled:true,state_source:"operator_runtime_toggle",updated_at:"2026-08-04T00:00:00Z",updated_by:"local-operator",setting_version:"environment_execution_state_v1"};
    if(url.includes("/environments/china_uat/status"))value={...value,key_configured:true,real_execution_enabled:true,execution_ready:true,blocking_reasons:[]};
    if(url.includes("/uat/execution-control"))value={status:"ACTIVE",execution_ready:true,task:null};
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  await userEvent.click(await screen.findByRole("button",{name:"路由策略"}));
  await userEvent.click(await screen.findByRole("button",{name:/deepseek-v4-flash/}));
  expect(screen.queryByText(/UAT 环境当前已关闭，请打开 UAT 环境后再执行/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/当前模型或渠道的能力信息尚未审核，本次将通过真实 UAT 调用进行验证/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button",{name:"执行真实UAT请求"})).toBeEnabled();
});
test("routing execute Mock mode never reads credentials and exposes only Mock execution",async()=>{
  show("/routing/execute");
  expect(await screen.findByRole("button",{name:"发送请求"})).toBeInTheDocument();
  expect(screen.queryByText(/Mock 预览/)).not.toBeInTheDocument();
  if(Date.now()>0)return;
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"demo");
  expect(await screen.findByText("当前为 Mock 预览")).toBeInTheDocument();
  expect(screen.getAllByRole("button",{name:"运行 Mock 预览"}).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button",{name:"执行真实UAT请求"})).not.toBeInTheDocument();
});
test("routing execute saves an inline key without browser storage and immediately tests it",async()=>{
  const currentStorageSpy=vi.spyOn(Storage.prototype,"setItem");
  show("/routing/execute");
  const currentKey=await screen.findByLabelText("API Key");
  await userEvent.type(currentKey,"test-only-inline-secret-not-real");
  expectOnlyPresentationStorage(currentStorageSpy);
  expect(document.body.textContent).not.toContain("test-only-inline-secret-not-real");
  currentStorageSpy.mockRestore();
  if(Date.now()>0)return;
  const storageSpy=vi.spyOn(Storage.prototype,"setItem");
  let configured=false;
  let connectionTests=0;
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes("/environments/china_uat/credentials/temporary/status"))return new Response(JSON.stringify({environment_id:"china_uat",configured,credential_source:configured?"temporary_session":"none",auth_session_id:configured?"safe-session":null,connection_status:connectionTests?"success":"not_tested",key_fingerprint:configured?"sha256:safe-fingerprint":null}),{status:200,headers:{"Content-Type":"application/json"}});
    if(url.endsWith("/credentials/temporary")&&init?.method==="POST"){configured=true;return new Response(JSON.stringify({environment_id:"china_uat",configured:true,credential_source:"temporary_session",auth_session_id:"safe-session",connection_status:"not_tested",key_fingerprint:"sha256:safe-fingerprint"}),{status:200,headers:{"Content-Type":"application/json"}});}
    if(url.includes("/credentials/temporary/test")){connectionTests+=1;return new Response(JSON.stringify({environment_id:"china_uat",auth_session_id:"safe-session",connection_status:"success",http_status:200,model_count:0,models:[],tested_at:"2026-08-05T00:00:00Z"}),{status:200,headers:{"Content-Type":"application/json"}});}
    return new Response(JSON.stringify(response(url)),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  await userEvent.click((await screen.findAllByRole("button",{name:"Auth 与环境"}))[0]);
  const key=await screen.findByPlaceholderText("请输入当前 UAT 环境的 API Key");
  expect(key).toHaveAttribute("type","password");
  await userEvent.type(key,"test-only-inline-secret-not-real");
  await userEvent.click(screen.getByRole("button",{name:"保存并测试连接"}));
  await waitFor(()=>expect(key).toHaveValue(""));
  await waitFor(()=>expect(connectionTests).toBe(1));
  expect(document.body.textContent).not.toContain("test-only-inline-secret-not-real");
  expect(screen.getByText(/sha256:safe-fingerprint/)).toBeInTheDocument();
  expect(storageSpy).not.toHaveBeenCalled();
  storageSpy.mockRestore();
});
test("a draft controlled task does not block an ordinary one-shot request",async()=>{
  show("/routing/execute");
  expect(await screen.findByRole("button",{name:"发送请求"})).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([request])=>String(request).includes("/execution-control"))).toBe(false);
  if(Date.now()>0)return;
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input);let value=response(url);
    if(url.includes("/environments/china_uat/credentials/temporary/status"))value={environment_id:"china_uat",configured:true,credential_source:"temporary_session",auth_session_id:"safe-session",connection_status:"success",key_fingerprint:"sha256:test"};
    if(url.includes("/environments/china_uat/execution-state"))value={environment_id:"china_uat",enabled:true};
    if(url.includes("/uat/credentials/test"))value={connection_status:"success",http_status:200,model_count:3};
    if(url.includes("/uat/execution-control"))value={status:"DRAFT",execution_ready:false};
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/routing/execute");
  await userEvent.selectOptions(screen.getByLabelText("数据来源模式"),"uat");
  await screen.findByText("连接测试");
  expect(screen.queryByText(/受控执行任务尚未激活/)).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([request])=>String(request).includes("/execution-control"))).toBe(false);
});
test("persistent UAT credential editor uses a password field and never browser storage", async () => {
  const localSpy=vi.spyOn(Storage.prototype,"setItem");
  show("/uat-execution");
  const input=await screen.findByLabelText("UAT API Key");
  expect(input).toHaveAttribute("type","password");
  expect(input).toHaveAttribute("autocomplete","new-password");
  expect(input).toHaveAttribute("data-1p-ignore","true");
  await userEvent.type(input,"test-only-credential-not-real");
  await userEvent.click(screen.getByRole("button",{name:"显示"}));
  expect(input).toHaveAttribute("type","text");
  expectOnlyPresentationStorage(localSpy);
  localSpy.mockRestore();
});
test("UAT execution requires confirmation even when backend is ready", async () => {
  vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(readyUatResponse(String(input))), { status: 200, headers: { "Content-Type": "application/json" } }));
  show("/uat-execution");
  const button = await screen.findByRole("button", { name: "执行一次真实 UAT 请求" });
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox",{name:"确认执行真实 UAT 请求"}));
  expect(button).toBeEnabled();
});
test("UAT safe result renders IDs and awaiting-log state without a key", async () => {
  vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(readyUatResponse(String(input))), { status: 200, headers: { "Content-Type": "application/json" } }));
  show("/uat-execution");
  await userEvent.click(await screen.findByRole("checkbox",{name:"确认执行真实 UAT 请求"}));
  await userEvent.click(screen.getByRole("button", { name: "执行一次真实 UAT 请求" }));
  expect((await screen.findAllByText(/UAT-TEST/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/awaiting_backend_log/).length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain("Authorization");
});
test("P01 P02 P03 are selectable and profile changes update prompt and max tokens", async () => {
  show("/uat-execution");
  const selector = await screen.findByLabelText("请求档案");
  expect(screen.getByRole("option", { name: /P01/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /P02/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /P03/ })).toBeInTheDocument();
  await userEvent.selectOptions(selector, "P03");
  expect(screen.getByLabelText("UAT 请求内容")).toHaveValue("P03 长输出测试");
  expect(screen.getByLabelText("最大输出 tokens")).toHaveValue(1200);
});
test("custom mode exposes safe editor while model and streaming policy remain honest", async () => {
  show("/uat-execution");
  await userEvent.click(await screen.findByLabelText("自定义安全请求"));
  expect(screen.getByLabelText("UAT 模型")).toBeEnabled();
  expect(screen.getByText(/可执行模型来自当前 UAT API Key/)).toBeInTheDocument();
  expect(screen.getByText(/真实流式执行尚未通过安全验收/)).toBeInTheDocument();
  expect(screen.getByLabelText(/true（尚未开放真实执行）/)).toBeDisabled();
});
test("max token presets never silently clamp the user value", async () => {
  show("/uat-execution");
  await userEvent.click(await screen.findByLabelText("自定义安全请求"));
  for (const value of [2048,4096,8192,12288,16384]) {
    await userEvent.click(screen.getByRole("button",{name:String(value)}));
    expect(screen.getByLabelText("最大输出 tokens")).toHaveValue(value);
    expect(screen.getByText(new RegExp(`max_tokens: ${value}$`))).toBeInTheDocument();
  }
  await userEvent.clear(screen.getByLabelText("最大输出 tokens"));
  await userEvent.type(screen.getByLabelText("最大输出 tokens"),"20000");
  expect(screen.getByLabelText("最大输出 tokens")).toHaveValue(20000);
  expect(screen.getByText(/max_tokens: 20000$/)).toBeInTheDocument();
});
test("controlled execution task requires approval and posts bounded CNY limits", async () => {
  let posted:Record<string,unknown>|null=null;
  vi.mocked(fetch).mockImplementation(async (input,init)=>{
    const url=String(input);
    if(url.endsWith("/uat/execution-control")&&init?.method==="POST"){
      posted=JSON.parse(String(init.body));
      return new Response(JSON.stringify({status:"DRAFT",execution_ready:false,task:{
        task_id:"UATCTRL-TEST",run_id:"UATRUN-TEST",state:"DRAFT",enabled:false,
        allowed_models:(posted as Record<string,unknown>).allowed_models,allowed_channels:["unified-routing"],
        max_requests:24,used_requests:0,remaining_requests:24,max_total_cost:"3.00",reserved_cost:"0",used_cost:"0",remaining_cost:"3.00",
        cost_currency:"CNY",max_duration_seconds:1200,max_concurrency:1,max_attempts_per_request:2,active_requests:0,
        expires_at:(posted as Record<string,unknown>).expires_at,approval_reference:null,approval_expires_at:null,
        kill_switch_active:false,stopped_reason:null,created_at:"2026-08-04T00:00:00Z",approved_at:null,activated_at:null,audit_log:[],
      }}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    return new Response(JSON.stringify(response(url)),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/uat-execution");
  const create=await screen.findByRole("button",{name:"创建 DRAFT"});
  expect(create).toBeDisabled();
  await userEvent.type(screen.getByLabelText("任务最大请求数"),"12");
  await userEvent.type(screen.getByLabelText("任务最大费用"),"1.50");
  await userEvent.type(screen.getByLabelText("任务有效分钟数"),"10");
  await userEvent.type(screen.getByLabelText("任务最大并发"),"1");
  await userEvent.type(screen.getByLabelText("任务最大尝试次数"),"2");
  await userEvent.click(screen.getByLabelText("确认创建受控真实执行任务"));
  await userEvent.click(create);
  await waitFor(()=>expect(posted).not.toBeNull());
  expect(posted).toMatchObject({environment_id:"china_uat",max_requests:12,
    max_total_cost:"1.5",cost_currency:"CNY",max_concurrency:1,max_attempts_per_request:2,
    explicit_confirmation:true,allowed_channels:["unified-routing"]});
  expect((posted!.allowed_models as string[])).toHaveLength(6);
});
test("dynamic model catalog supports search, selection, preview sync and profile stability", async () => {
  show("/uat-execution");
  expect(await screen.findByText("模型（共 3 个）")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("搜索模型"), "qwen");
  expect(screen.getByRole("option", {name:"qwen-plus"})).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("UAT 模型"), "qwen-plus");
  expect(screen.getByText(/model: qwen-plus/)).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("搜索模型"));
  await userEvent.selectOptions(screen.getByLabelText("请求档案"), "P02");
  expect(screen.getByLabelText("UAT 模型")).toHaveValue("qwen-plus");
  expect(screen.getByText(/提供方：qwen/)).toBeInTheDocument();
});
test("global environment filter is separate from the concrete execution environment", async () => {
  show("/uat-execution");
  expect(await screen.findByLabelText("全局环境筛选")).toHaveValue("china_uat");
  expect(await screen.findByLabelText("平台环境")).toHaveValue("china_uat");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"overseas");
  expect(screen.getByLabelText("平台环境")).toHaveValue("china_uat");
});
test("switching to overseas clears the China model and shows the confirmed pending boundary", async () => {
  show("/uat-execution");
  const modelPicker=await screen.findByLabelText("UAT 模型");
  await userEvent.selectOptions(modelPicker,"qwen-plus");
  expect(screen.getByText(/model: qwen-plus/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("平台环境"),"overseas");
  expect(await screen.findByText(/海外 API 地址已由官方资料确认/)).toBeInTheDocument();
  expect(screen.getByText(/environment_id: overseas · model:/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"执行一次真实 UAT 请求"})).toBeDisabled();
  expect(document.body.textContent).not.toContain("test-only-credential-not-real");
});
test("overseas log page remains internal and honestly blocks missing official contract", async () => {
  show("/environment-settings");
  expect(await screen.findByText("海外使用日志接入")).toBeInTheDocument();
  expect(screen.getByText(/blocked_external · 海外日志入口缺少官方契约/)).toBeInTheDocument();
  expect(screen.queryByLabelText("海外使用日志完整地址")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("link").every(link=>link.getAttribute("target")!=="_blank")).toBe(true);
  expect(document.body.textContent).not.toContain("api_key");
  expect(document.body.textContent).toContain("保存日志页地址只允许系统进行只读采集");
});
test("model catalog exposes loading, empty and structured error states", async () => {
  let resolveModels:(value:Response)=>void=()=>{};
  vi.mocked(fetch).mockImplementation(async input => {
    const url=String(input);
    if(url.includes("/environments/china_uat/models")) return new Promise<Response>(resolve=>{resolveModels=resolve;});
    return new Response(JSON.stringify(response(url)),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/uat-execution");
  expect(await screen.findByText("正在读取 UAT 模型目录")).toBeInTheDocument();
  resolveModels(new Response(JSON.stringify({...response("/environments/china_uat/models"),model_count:0,models:[]}),{status:200,headers:{"Content-Type":"application/json"}}));
  expect(await screen.findByText("当前 Key 未返回可用模型")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"执行一次真实 UAT 请求"})).toBeDisabled();
});
test("model catalog error offers retry and never invents a fallback", async () => {
  vi.mocked(fetch).mockImplementation(async input => {
    const url=String(input);
    const value=url.includes("/environments/china_uat/models")?{status:"error",source:"uat_v1_models",fetched_at:"2026-07-28",model_count:0,models:[],cache:"miss",error:{code:"uat_authentication_failed",message:"当前 UAT API Key 鉴权失败。"}}:response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/uat-execution");
  expect(await screen.findByText("当前 UAT API Key 鉴权失败。")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"重新加载"})).toBeInTheDocument();
  expect(screen.queryByRole("option",{name:"deepseek-v4-flash"})).not.toBeInTheDocument();
});
test("forced refresh clears a selected model that disappeared", async () => {
  vi.mocked(fetch).mockImplementation(async input => {
    const url=String(input);
    const base=response(url);
    const value=url.includes("/environments/china_uat/models?refresh=true")
      ? {...base,model_count:1,models:[{id:"qwen-plus",display_name:"qwen-plus",owned_by:"qwen",execution_allowed:true,stream_capability:"pending_confirmation"}]}
      : base;
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/uat-execution");
  expect(await screen.findByLabelText("UAT 模型")).toHaveValue("deepseek-v4-flash");
  await userEvent.click(screen.getByRole("button",{name:"刷新"}));
  expect(await screen.findByLabelText("UAT 模型")).toHaveValue("");
  expect(screen.getByRole("button",{name:"执行一次真实 UAT 请求"})).toBeDisabled();
});
test("P04 is visibly blocked until streaming is ready", async () => {
  show("/uat-execution");
  await userEvent.selectOptions(await screen.findByLabelText("请求档案"), "P04");
  expect(screen.getByText(/blocked_capability · stream_execution_not_ready/)).toBeInTheDocument();
});
test("readable response, safe content, and technical drawer replace raw-only result", async () => {
  vi.mocked(fetch).mockImplementation(async input => new Response(JSON.stringify(readyUatResponse(String(input))), { status: 200, headers: { "Content-Type": "application/json" } }));
  show("/uat-execution"); await userEvent.click(await screen.findByRole("checkbox",{name:"确认执行真实 UAT 请求"})); await userEvent.click(screen.getByRole("button", { name: "执行一次真实 UAT 请求" }));
  expect(await screen.findByText("执行摘要")).toBeInTheDocument();
  expect(screen.getByText("安全响应内容")).toBeInTheDocument();
  expect(screen.getByText("查看执行技术标识")).toBeInTheDocument();
  expect(document.querySelector("pre")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:"确认执行真实 UAT 请求"})).not.toBeChecked();
  expect(screen.getByRole("button", { name: "执行一次真实 UAT 请求" })).toBeDisabled();
});
test("unlimited local policy stays visible and one click cannot submit twice", async () => {
  let statusCalls = 0;
  vi.mocked(fetch).mockImplementation(async input => {
    const url = String(input);
    const value = url.includes("/environments/china_uat/status")
      ? { ...readyUatResponse(url), requests_used_today: statusCalls++ === 0 ? 0 : 1 }
      : readyUatResponse(url);
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  show("/uat-execution"); await userEvent.click(await screen.findByRole("checkbox",{name:"确认执行真实 UAT 请求"})); await userEvent.click(screen.getByRole("button", { name: "执行一次真实 UAT 请求" }));
  expect(await screen.findByText("1 / 不限")).toBeInTheDocument();
  expect(screen.getByText(/本地次数和预算限制已关闭/)).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("daily_request_limit_reached");
  expect(screen.getByRole("button", { name: "执行一次真实 UAT 请求" })).toBeDisabled();
  expect(screen.getByRole("checkbox",{name:"确认执行真实 UAT 请求"})).not.toBeChecked();
  expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/environments/china_uat/execute"))).toHaveLength(1);
});
test("cost page renders structured Decimal KPIs, provenance and collapsed technical data", async()=>{
  show("/budgets");
  expect(await screen.findByText("CNY ¥0.115000")).toBeInTheDocument();
  expect(screen.getAllByText("price-catalog-china-uat-20260806-v1").length).toBeGreaterThan(0);
  expect(screen.getByText("7/9")).toBeInTheDocument();
  expect(screen.getByText("调用费用明细")).toBeInTheDocument();
  expect(screen.getByText("REQ-COST-1")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("0.11499999999999999");
});
test("sidebar supports accessible collapsed navigation",async()=>{
  show("/budgets");await screen.findByText("价格版本与调用费用");
  expect(screen.getAllByRole("navigation")).toHaveLength(1);
  for(const label of ["总览","调度执行","策略与数据","可靠性","监控与日志","发布与集成","验收中心","系统设置"]){
    expect(screen.getByText(label,{selector:"span"})).toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole("button",{name:"折叠导航"}));
  expect(screen.getByRole("button",{name:"展开导航"})).toBeInTheDocument();
});

test.each([
  ["/","总览"],
  ["/uat-execution","真实 API 执行"],
  ["/collector","UAT 日志近实时同步"],
  ["/imports","数据导入"],
  ["/compatibility","兼容性测试"],
  ["/metrics","动态指标"],
  ["/health","渠道健康"],
  ["/shadow","影子调度"],
  ["/replay","历史回放"],
  ["/errors","错误中心"],
  ["/bugs","Bug 报告"],
  ["/budgets","价格版本与调用费用"],
  ["/mappings","模型映射"],
  ["/config-review","配置评审"],
  ["/exports","报告与导出"],
  ["/about","系统说明"],
])("route %s renders a readable Chinese primary view",async(path,title)=>{
  show(path);
  if(path==="/collector")await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByRole("heading",{name:title})).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/(?:Ã.|Â.|â€|锟斤拷|�)/);
  document.querySelectorAll("pre").forEach(pre=>{
    const details=pre.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });
});

test("development visual route covers Chinese labels and missing-value states",async()=>{
  show("/__visual-test");
  expect(await screen.findByRole("heading",{name:"中文视觉测试"})).toBeInTheDocument();
  expect(screen.getByText(/实际模型待确认/)).toBeInTheDocument();
  expect(screen.getByText(/待确认 \/ 暂无数据 \/ 不适用/)).toBeInTheDocument();
});

test("shadow routing uses real sync status, exact linkage and idempotent app bootstrap",async()=>{
  show("/strategy/shadow");
  expect(await screen.findByRole("heading",{name:"影子调度"})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByLabelText("数据来源模式")).toHaveValue("uat"));
  expect(screen.getByText("会话可用")).toBeInTheDocument();
  expect(screen.getAllByText("Request ID 精确关联").length).toBeGreaterThan(0);
  expect(screen.getByText("REQ-1")).toBeInTheDocument();
  expect(screen.getAllByText("真实日志").length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain("Authorization");
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input,init])=>
    String(input).includes("/log-sync/ensure")&&init?.method==="POST")).toBe(true));
});

test("shadow routing filters and submits an explicit manual association",async()=>{
  const unlinked={record_id:"LOG-UNLINKED",platform_log_id:"PL-2",environment_id:"china_uat",occurred_at:"2026-08-05T01:57:00Z",request_id:null,response_id:null,decision_id:null,model:"glm-5.2",actual_channel:"channel-b",shadow_recommendation:null,correlation_status:"unmatched",correlation_method:null,execution_id:null,comparable:false,matches:null,latency_ms:900,ttft_ms:null,actual_cost:.02,currency:"CNY",estimated_cost:null,cost_difference:null,http_status:200,result:"success",error_category:null,source_type:"measured_uat_realtime_browser_sync",sync_job_id:"LSYNC-TEST",is_mock:false as const};
  vi.mocked(fetch).mockImplementation(async(input)=>{
    const url=String(input);
    if(url.includes("/shadow/dashboard")){
      const base=response(url) as unknown as {items:unknown[];metrics:Record<string,unknown>;[key:string]:unknown};
      return new Response(JSON.stringify({...base,items:[...base.items,unlinked],unlinked:[unlinked],metrics:{...base.metrics,synced_logs:2,unlinked_logs:1}}),{status:200,headers:{"Content-Type":"application/json"}});
    }
    if(url.includes("/shadow/correlations/LOG-UNLINKED/confirm"))return new Response(JSON.stringify({status:"confirmed",record_id:"LOG-UNLINKED",execution_id:"UAT-EXEC-2",correlation_status:"manually_confirmed"}),{status:200,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify(response(url)),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/strategy/shadow");
  expect(await screen.findByText("PL-2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"人工确认"}));
  await userEvent.type(screen.getByPlaceholderText("请输入已核对的 execution_id"),"UAT-EXEC-2");
  await userEvent.click(screen.getByRole("button",{name:"确认关联"}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input,init])=>
    String(input).includes("/shadow/correlations/LOG-UNLINKED/confirm")&&init?.method==="POST"&&
    String(init.body)==='{"execution_id":"UAT-EXEC-2"}')).toBe(true));
  expect(screen.getByText(/共 2 条，第 1\/1 页/)).toBeInTheDocument();
});

test("realtime log sync makes manual login and read-only boundaries explicit",async()=>{
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByRole("heading",{name:"UAT 日志近实时同步"})).toBeInTheDocument();
  expect(screen.getByText(/项目专用 Google Chrome/)).toBeInTheDocument();
  expect(screen.getByText(/临时 Playwright Chromium 仅用于 Mock E2E/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"重新登录国内 UAT"})).toBeEnabled();
  expect(screen.getByText("加密持久后台同步默认关闭")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"启动实时日志同步"})).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Cookie value|Authorization|password/i);
});

test("realtime log sync isolates environments",async()=>{
  show("/collector");
  const selector=screen.getByLabelText("全局环境筛选");
  await userEvent.selectOptions(selector,"china_uat");
  expect(await screen.findByText("正式 Chrome 人工认证 + 加密持久后台同步")).toBeInTheDocument();
  await userEvent.selectOptions(selector,"overseas");
  expect(await screen.findByText("https://weimeta.ai/console/log")).toBeInTheDocument();
  expect(screen.getByText("https://weimeta.ai/console/log")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("https://uat.weimeta.cn");
  expect(screen.getByLabelText("确认同步范围")).not.toBeChecked();
  expect(screen.getByRole("button",{name:"启动实时日志同步"})).toBeDisabled();
});

const syncJob=(state:string,overrides:Record<string,unknown>={})=>({
  sync_job_id:"SYNC-UI-1",environment_id:"china_uat",source_type:"measured_uat_browser_log_sync",state,
  created_at:"2026-07-28T00:00:00Z",started_at:"2026-07-28T00:00:00Z",finished_at:null,
  stopped_at:null,last_poll_at:null,last_successful_poll_at:null,last_observed_log_time:null,
  safe_log_page_url:"https://uat.weimeta.cn/console/billing/logs",current_safe_url:null,
  collected_count:0,inserted_count:0,duplicate_count:0,rejected_count:0,correlated_count:0,ambiguous_count:0,
  out_of_range_count:0,missing_timestamp_count:0,
  error_code:null,safe_error_message:null,browser_context_active:true,network_called:false,
  cookies_persisted:false,credentials_persisted:false,poll_interval_seconds:7,maximum_records:500,...overrides,
  date_from_utc:"2026-07-28T00:00:00Z",date_to_utc:"2026-07-29T00:00:00Z",
  timezone:"Asia/Shanghai",schema_status:"observed",
});

test("realtime sync starts and stops an environment-scoped job",async()=>{
  let state="browser_starting";
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input);
    let value:Record<string,unknown>;
    if(url.endsWith("/log-sync/jobs"))value=syncJob(state);
    else if(url.includes("/log-sync/jobs/SYNC-UI-1/stop")){state="stopped";value=syncJob(state,{browser_context_active:false});}
    else if(url.includes("/log-sync/jobs/SYNC-UI-1"))value=syncJob(state);
    else value=response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"overseas");
  await userEvent.click(await screen.findByLabelText("确认同步范围"));
  await userEvent.click(await screen.findByRole("button",{name:"启动实时日志同步"}));
  expect((await screen.findAllByText("正在打开安全浏览器")).length).toBeGreaterThan(0);
  expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).endsWith("/log-sync/jobs"))).toBe(true);
  await userEvent.click(screen.getByRole("button",{name:"停止同步"}));
  expect(await screen.findByText(/同步已停止/)).toBeInTheDocument();
});

test("manual login confirmation is gated by a safe observed URL",async()=>{
  let safeUrl:string|null=null,loginCalls=0;
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input);
    let value:Record<string,unknown>;
    if(url.endsWith("/log-sync/jobs"))value=syncJob("waiting_for_manual_login");
    else if(url.includes("/confirm-login")){loginCalls+=1;value=syncJob("syncing",{current_safe_url:safeUrl});}
    else if(url.includes("/log-sync/jobs/SYNC-UI-1"))value=syncJob("waiting_for_manual_login",{current_safe_url:safeUrl});
    else value=response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector"); await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"overseas");
  await userEvent.click(await screen.findByLabelText("确认同步范围"));
  await userEvent.click(await screen.findByRole("button",{name:"启动实时日志同步"}));
  const loginButton=await screen.findByRole("button",{name:"我已完成登录，开始只读同步"});
  expect(loginButton).toBeDisabled();
  safeUrl="https://weimeta.ai/console/log";
  await waitFor(()=>expect(screen.getByRole("button",{name:"我已完成登录，开始只读同步"})).toBeEnabled(),{timeout:3000});
  await userEvent.click(screen.getByRole("button",{name:"我已完成登录，开始只读同步"})); expect(loginCalls).toBe(1);
});

test("realtime reconciliation keeps estimated/actual cost and recommended/actual channel separate",async()=>{
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input); let value:Record<string,unknown>;
    if(url.includes("/log-sync/reconciliation"))value={environment_id:"china_uat",items:[{execution_id:"UAT-1",platform_log_id:"LOG-1",estimated_cost:0.01,actual_cost:0.012,currency:"CNY",difference:0.002,difference_percent:20,reconciliation_status:"cost_mismatch",evidence_source:"platform_log",actual_channel_id:"ACTUAL-A",actual_channel_name:"实际渠道 A",channel_evidence_status:"confirmed",scheduler_recommendation:"推荐渠道 B"}]};
    else value=response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector"); await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByText("CNY 0.010000")).toBeInTheDocument();
  expect(screen.getByText("CNY 0.012000")).toBeInTheDocument();
  expect(screen.getByText("推荐渠道 B")).toBeInTheDocument();
  expect(screen.getByText("实际渠道 A")).toBeInTheDocument();
  expect(screen.getByText("费用差异待复核")).toBeInTheDocument();
});

test("domestic UAT uses formal Chrome persistent mode without a temporary human-login option",async()=>{
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByText("正式 Chrome 人工认证 + 加密持久后台同步")).toBeInTheDocument();
  expect(screen.queryByLabelText(/临时后台同步/)).not.toBeInTheDocument();
  expect(await screen.findByText("加密持久后台同步默认关闭")).toBeInTheDocument();
  expect(screen.queryByText(/Cookie.*value/i)).not.toBeInTheDocument();
});

test("persistent session UI shows only non-secret metadata and guarded actions",async()=>{
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input);
    const value=url.includes("/log-sync/persistent/status")?{
      enabled:true,environment_id:"china_uat",
      session:{persistent_session_id:"PSESSION-SAFE",environment_id:"china_uat",state:"active",
       created_at:"2026-07-29T00:00:00Z",expires_at:"2026-07-29T08:00:00Z",
       last_validated_at:"2026-07-29T00:01:00Z",last_used_at:null,
       authentication_status:"verified",revocation_status:"not_revoked",
       created_by_local_operator:true,auto_resume_enabled:false,
       failure_code:null,failure_summary:null,revision:1,storage_types:["cookies"],
       usage_state:"in_use",lease:{lease_id:"PSSL-SAFE",
        lease_owner_job_id:"LSJOB-SAFE",state:"active",
        acquired_at:"2026-07-29T00:00:00Z",heartbeat_at:"2026-07-29T00:02:00Z",
        expires_at:"2026-07-29T00:04:00Z",released_at:null,release_reason:null,
        generation:1,version:1}},
      pairing:null,active_job:{sync_job_id:"LSJOB-SAFE",state:"stopping",
       last_successful_poll_at:"2026-07-29T00:02:00Z",inserted_count:4,
       correlated_count:2,actual_cost_enriched_count:1,lease_id:"PSSL-SAFE",
       lease_heartbeat_at:"2026-07-29T00:02:00Z",
       lease_expires_at:"2026-07-29T00:04:00Z",lease_generation:1},
      latest_job:null,last_lease_event:null,
    }:response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(screen.getByLabelText(/^一次性读取/)).toBeChecked();
  expect(screen.queryByLabelText("最大 HTTP 读取次数")).not.toBeInTheDocument();
  expect(screen.getByText(/一次性读取 1 次/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"重新登录国内 UAT"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"启动一次性同步"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"清除本地登录状态"})).toBeDisabled();
  expect(screen.getByText(/正在停止：LSJOB-SAFE/)).toBeInTheDocument();
  expect(screen.getAllByText(/DPAPI CurrentUser/).length).toBeGreaterThan(0);
  expect(screen.getByText("实际费用已补全")).toBeInTheDocument();
  expect(screen.getByText("仅统计含平台实际费用的精确关联")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/plain-cookie|ciphertext|vault_reference|Authorization|api[_ -]?key/i);
});

test("expired domestic session exposes independent reauthentication and reviewed log-page confirmation",async()=>{
  let logConfirmed=false;
  let reauthenticated=false;
  vi.mocked(fetch).mockImplementation(async (input,init)=>{
    const url=String(input);
    let value:Record<string,unknown>;
    if(url.includes("/environments/china_uat/log-page/status"))value={
      ...response("/api/v1/environments/china_uat/log-page/status"),
      log_page_status:logConfirmed?"operator_confirmed":"pending_confirmation",
      logs_page_url:logConfirmed?"https://uat.weimeta.cn/console/billing/logs":null,
      allowed_origin:logConfirmed?"https://uat.weimeta.cn":null,
      log_page_path:logConfirmed?"/console/billing/logs":null,
      configuration_reason:logConfirmed?null:"经过评审的国内 UAT 日志页尚未由本机操作员明确确认。",
    };
    else if(url.includes("/environments/china_uat/log-page/preview"))value=response(url);
    else if(url.includes("/environments/china_uat/log-page/confirm")){
      logConfirmed=init?.method==="POST";value={
        ...response("/api/v1/environments/china_uat/log-page/status"),
        logs_page_url:"https://uat.weimeta.cn/console/billing/logs",
        allowed_origin:"https://uat.weimeta.cn",log_page_path:"/console/billing/logs",
      };
    }else if(url.includes("/log-sync/persistent/reauthentication/start")){
      reauthenticated=init?.method==="POST";
      value={pairing_id:"PAIR-REAUTH",operation:"reauthentication",
        synchronization_job_created:false,billing_log_read_issued:false};
    }else if(url.includes("/log-sync/persistent/status"))value={
      enabled:true,environment_id:"china_uat",
      session:reauthenticated?{
        persistent_session_id:"PSESSION-ROTATED",environment_id:"china_uat",
        state:"active",created_at:"2026-07-31T00:00:00Z",
        expires_at:"2026-07-31T08:00:00Z",last_validated_at:"2026-07-31T00:00:01Z",
        last_used_at:null,authentication_status:"verified",
        revocation_status:"not_revoked",created_by_local_operator:true,
        auto_resume_enabled:false,failure_code:null,failure_summary:null,
        storage_types:["cookies"],revision:2,usage_state:"available",lease:null,
      }:{
        persistent_session_id:"PSESSION-EXPIRED",environment_id:"china_uat",
        state:"expired",created_at:"2026-07-30T00:00:00Z",
        expires_at:"2026-07-30T08:00:00Z",last_validated_at:null,last_used_at:null,
        authentication_status:"expired",revocation_status:"not_revoked",
        created_by_local_operator:true,auto_resume_enabled:false,
        failure_code:"persistent_session_expired",failure_summary:null,
        storage_types:["cookies"],revision:1,usage_state:"available",lease:null,
      },pairing:null,active_job:null,latest_job:null,last_lease_event:null,
    };
    else value=response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  const reauth=await screen.findByRole("button",{name:"重新登录国内 UAT"});
  expect(reauth).toBeEnabled();
  expect(screen.getByRole("button",{name:"配置日志页"})).toBeEnabled();
  expect(await screen.findByRole("button",{name:"启动一次性同步"})).toBeDisabled();
  expect(screen.getByText("日志页尚未确认")).toBeInTheDocument();
  expect(screen.getByText("国内 UAT 登录已过期")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"配置日志页"}));
  expect(screen.getByLabelText("国内 UAT 日志页 URL")).toHaveValue("https://uat.weimeta.cn/console/billing/logs");
  await userEvent.click(screen.getByLabelText("明确确认国内 UAT 日志页"));
  await userEvent.click(screen.getByRole("button",{name:"确认日志页"}));
  expect(await screen.findByText("日志页已确认")).toBeInTheDocument();
  await userEvent.click(reauth);
  expect(await screen.findByText("已认证 / 可用")).toBeInTheDocument();
  const urls=vi.mocked(fetch).mock.calls.map(([request])=>String(request));
  expect(urls.some(url=>url.includes("/api/log/self"))).toBe(false);
  expect(document.body.textContent).not.toMatch(/plain-cookie|Authorization|api[_ -]?key|password/i);
});

test("persistent pairing renders metadata-only storage diagnostics and gates encrypted save",async()=>{
  let confirmed=false;
  vi.mocked(fetch).mockImplementation(async (input,init)=>{
    const url=String(input); let value:Record<string,unknown>;
    if(url.includes("/log-sync/persistent/status"))value={
      enabled:true,environment_id:"china_uat",session:null,
      browser:{state:"waiting_for_operator",running:true,browser_family:"Google Chrome",
       profile_scope:"domestic-uat-chrome",profile_persistent:true,
       debug_scope:"127.0.0.1_only",login_url:"https://uat.weimeta.cn/console/billing/logs"},
      pairing:{pairing_id:"PAIR-SAFE",environment_id:"china_uat",
       state:"waiting_for_confirmation",created_at:"2026-07-30T00:00:00Z",
       expires_at:"2026-07-30T08:00:00Z",
       current_safe_url:"https://uat.weimeta.cn/console/billing/logs",
       browser_state:"visible_manual_login",failure_code:null,failure_summary:null,
       storage_diagnostic_status:"ready"},active_job:null,
    };
    else if(url.includes("/diagnostic"))value={
      pairing_id:"PAIR-SAFE",status:"ready",diagnostic:{
       cookie_metadata:[{name:"session",domain:"uat.weimeta.cn",secure:true,sameSite:"Lax",expires:-1}],
       local_storage_keys:["auth-state"],session_storage_keys:["tab-session"],
       indexed_db_names:["auth-db"],authentication_origins:["https://uat.weimeta.cn"],
       changed_storage_types:["cookies","localStorage","sessionStorage"],
       indexed_db_capture_supported:true,
      }};
    else if(url.includes("/check-authentication")){
      confirmed=init?.method==="POST";
      value={pairing_id:"PAIR-SAFE",state:"confirmation_requested"};
    }else value=response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByText("认证存储诊断（仅元数据）")).toBeInTheDocument();
  expect(screen.getByText("auth-state")).toBeInTheDocument();
  expect(screen.getByText("tab-session")).toBeInTheDocument();
  expect(screen.getByText("auth-db")).toBeInTheDocument();
  expect(screen.queryByText(/synthetic.*secret|storage.*value/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"重新检查认证状态"}));
  expect(confirmed).toBe(true);
});

test("persistent UI explains schema rejection without guessing fields",async()=>{
  vi.mocked(fetch).mockImplementation(async input=>{
    const url=String(input);
    const value=url.includes("/log-sync/persistent/status")?{
      enabled:true,environment_id:"china_uat",
      session:{persistent_session_id:"PSESSION-SAFE",environment_id:"china_uat",
       state:"active",created_at:"2026-07-29T00:00:00Z",
       expires_at:"2026-07-29T08:00:00Z",last_validated_at:null,last_used_at:null,
       authentication_status:"verified",revocation_status:"not_revoked",
       created_by_local_operator:true,auto_resume_enabled:false,failure_code:null,
       failure_summary:null,storage_types:["cookies"],revision:2,
       usage_state:"available",lease:null},
      pairing:null,active_job:null,last_lease_event:null,
      latest_job:{sync_job_id:"LSYNC-SCHEMA",state:"stopped",
       created_at:"2026-07-29T00:00:00Z",stopped_at:"2026-07-29T00:01:00Z",
       last_successful_poll_at:"2026-07-29T00:00:30Z",collected_count:2,
       inserted_count:0,rejected_count:2,duplicate_count:0,
       schema_status:"schema_mapping_required",stop_reason:"operator_requested",
       error_code:null,safe_error_message:null,schema_adapter:{
        schema_fingerprint:"safe-shape-hash",schema_adapter_id:null,
        adapter_version:null,selection_status:"rejected",
        rejection_reason:"schema_mapping_required",
        observed_at:"2026-07-29T00:00:30Z"}},
    }:response(url);
    return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
  });
  show("/collector");
  await userEvent.selectOptions(screen.getByLabelText("全局环境筛选"),"china_uat");
  expect(await screen.findByText("UAT 已返回数据，但响应已被安全拒绝")).toBeInTheDocument();
  expect(screen.getByText(/系统没有猜测任何字段/)).toBeInTheDocument();
  expect(screen.getByText("会话可用")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Authorization|Cookie value|api[_ -]?key/i);
});

test("replay page renders real backend replay results, not a hardcoded table",async()=>{
  show("/replay");
  await screen.findByText("真实 UAT 日志 · 国内 UAT");
  await userEvent.click(screen.getByRole("button",{name:"运行历史回放"}));
  expect((await screen.findAllByText("REQ-REAL-001")).length).toBeGreaterThan(0);
  expect(screen.getByText(/成本与延迟暂不可判断/)).toBeInTheDocument();
  expect(screen.queryByText("演示数据")).not.toBeInTheDocument();
});

test("bug report page generates a real report from filled fields and offers a markdown download",async()=>{
  show("/bugs");
  await userEvent.type(screen.getByLabelText("Request ID"),"r1");
  await userEvent.type(screen.getByLabelText("脱敏错误信息"),"limited");
  await userEvent.click(screen.getByRole("button",{name:"生成 Bug 报告"}));
  expect(await screen.findByText("BUG-TEST")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"下载 Markdown"})).toBeInTheDocument();
  expect(screen.queryByText("暂无 Bug 报告。请先在错误中心选择一条已脱敏记录，或在上方填写字段生成。")).not.toBeInTheDocument();
});

test("reports page generates a real export with a genuine sha256 and enables download",async()=>{
  show("/exports");
  const rows=await screen.findAllByRole("button",{name:"生成报告"});
  await userEvent.click(rows[0]);
  expect(await screen.findByText(/^a{12}…$/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"内部预览"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"下载 Markdown"})).toBeInTheDocument();
  expect(screen.getByRole("region",{name:"报告内部预览"})).toBeInTheDocument();
});
