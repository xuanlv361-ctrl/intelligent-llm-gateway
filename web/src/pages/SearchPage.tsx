import {translate as uiText} from "../i18n/index";
import {useQuery} from "@tanstack/react-query";
import {Link,useSearchParams} from "react-router-dom";
import {api,DataMode,EnvironmentFilter,SearchItem} from "../services/api";
import {formatSourceType} from "../lib/presentation";

const ENTITY_LABELS:Record<string,string>={
  request:"请求",execution:"执行记录",decision:"决策",error:"错误",channel:"渠道",
  model:"模型",import:"导入证据",collection:"采集证据",report:"报告",cost:"成本记录",
};

function safeDestination(value:string){
  return value.startsWith("/")&&!value.startsWith("//")?value:null;
}

function PageHeader({description}:{description?:string}){
  return <header className="page-title">
    <p className="eyebrow">{uiText("LOCAL EVIDENCE SEARCH")}</p>
    <h1>{uiText("全局搜索")}</h1>
    {description&&<p>{uiText(description)}</p>}
  </header>;
}

export default function SearchPage({environment,mode}:{environment:EnvironmentFilter;mode:DataMode}){
  const [params,setParams]=useSearchParams();
  const query=(params.get("q")||"").trim();
  const cursor=params.get("cursor")||undefined;
  const sourceType=mode==="demo"?"demo_mock":undefined;
  const result=useQuery({
    queryKey:["global-search",query,environment,sourceType||"all",cursor||""],
    queryFn:({signal})=>api.search(query,environment,sourceType,50,cursor,signal),
    enabled:Boolean(query),
  });
  if(!query)return <section className="search-page"><PageHeader description={uiText("在顶部输入关键词，搜索当前环境与数据来源范围内的本地证据。")}/><div className="state empty">{uiText("请输入请求、渠道、模型、错误或证据 ID。")}</div></section>;
  if(result.isLoading)return <section className="search-page"><PageHeader/><div className="state loading" role="status">{uiText("正在搜索本地证据…")}</div></section>;
  if(result.error)return <section className="search-page"><PageHeader/><div className="state error" role="alert"><b>{uiText("全局搜索加载失败。")}</b><button onClick={()=>result.refetch()}>{uiText("重试")}</button></div></section>;
  const data=result.data!;
  const groups=data.items.reduce<Record<string,SearchItem[]>>((acc,item)=>{
    (acc[item.entity_type]??=[]).push(item);return acc;
  },{});
  return <section className="search-page">
    <PageHeader description={uiText("“{0}”在当前范围内匹配 {1} 条证据。", {"0": data.query, "1": data.items.length})}/>
    <div className="search-provenance">
      <span>{uiText("环境：")}{data.environment_id==="all"?uiText("全部环境"):data.environment_id==="china_uat"?uiText("国内 UAT"):uiText("海外站")}</span>
      <span>{uiText("数据来源：")}{formatSourceType(data.provenance?.source_type||data.source_type)}</span>
      <span>{uiText("仅展示脱敏摘要")}</span>
    </div>
    {data.items.length===0?<div className="state empty">{uiText("当前环境与数据来源范围内没有匹配证据。")}</div>:Object.entries(groups).map(([type,items])=>
      <section className="panel search-group" key={type}><header><h2>{ENTITY_LABELS[type]||type}</h2><span>{data.groups?.[type]??items.length} {uiText("条")}</span></header>
        <div className="search-results">{items.map(item=>{
          const destination=safeDestination(item.destination_path);
          return <article className="search-result" key={`${item.environment_id}:${item.entity_type}:${item.primary_id}`}>
            <div><span className={item.is_mock?"badge badge-demo":"badge badge-uat"}>{item.is_mock?uiText("演示数据"):uiText("真实证据")}</span><small>{item.environment_id==="china_uat"?uiText("国内 UAT"):item.environment_id==="overseas"?uiText("海外站"):item.environment_id} · {formatSourceType(item.source_type)}</small></div>
            <h3>{destination?<Link to={destination}>{item.title}</Link>:item.title}</h3>
            <p>{item.summary}</p><footer><code>{item.primary_id}</code>{item.sample_or_evidence_id&&<span>{uiText("证据：")}{item.sample_or_evidence_id}</span>}{item.updated_at&&<time>{item.updated_at}</time>}</footer>
          </article>;
        })}</div>
      </section>)}
    {data.next_cursor&&<button className="secondary" onClick={()=>{const next=new URLSearchParams(params);next.set("cursor",data.next_cursor!);setParams(next)}}>{uiText("下一页")}</button>}
  </section>;
}
