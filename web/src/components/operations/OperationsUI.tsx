import type {ReactNode} from "react";
import {labelEnum} from "../../lib/presentation";
import {getLocale,localeTags,translate as t,useLocale} from "../../i18n";

export function DataSourceBanner({genuine,label,sample,kind=genuine?"uat":"neutral"}:{genuine:boolean;label:string;sample:number;kind?:"demo"|"uat"|"neutral"}){
  useLocale();
  const explanation=kind==="demo"
    ?"当前页面使用演示数据，用于展示界面和分析流程，不代表真实 UAT 结果。"
    :kind==="uat"
      ?genuine
        ?"当前页面使用已确认的真实 UAT 证据；结论仅适用于所选范围和样本。"
        :"当前选择 UAT 证据，但所选范围尚无可用样本；不会回退为演示数据。"
      :"当前页面仅展示本地会话或离线分析状态，不代表真实 UAT 观测。";
  return <div className={`source-banner ${kind}`} role="note"><b>{t(label)}</b><span>{t(explanation)}</span><small>{t("样本 {0}",{0:sample.toLocaleString(localeTags[getLocale()])})}</small></div>
}
export function MetricCard({label,value,unit,context,source,state="neutral"}:{label:string;value:string;unit?:string;context:string;source:string;state?:string}){
  useLocale();
  return <article className={`ops-metric state-${state}`}><header>{t(label)}</header><div><strong>{value}</strong>{unit&&<span>{t(unit)}</span>}</div><p>{t(context)}</p><small>{t(source)}</small></article>
}
export function ChartCard({title,description,children}:{title:string;description:string;children:ReactNode}){
  useLocale();
  return <section className="chart-card"><header><div><h2>{t(title)}</h2><p>{t(description)}</p></div></header><div className="chart-body">{children}</div></section>
}
export function EmptyChart({children}:{children:ReactNode}){useLocale();return <div className="chart-empty"><b>{t("暂无可用图表")}</b><span>{typeof children==="string"?t(children):children}</span></div>}
const visibleValue=(value:unknown):ReactNode=>{
  if(value===null||value===undefined||value==="")return t("待确认");
  if(typeof value==="boolean")return t(value?"是":"否");
  // Technical values may be prompts, model output, IDs or protocol data: keep them raw.
  if(typeof value==="string")return value;
  if(typeof value==="number")return value.toLocaleString(localeTags[getLocale()]);
  if(Array.isArray(value)){
    if(!value.length)return t("暂无数据");
    if(value.every(item=>["string","number","boolean"].includes(typeof item)))return value.slice(0,20).map(String).join(getLocale()==="en"?", ":"、");
    return t("{0} 项结构化记录",{0:value.length.toLocaleString(localeTags[getLocale()])});
  }
  return t("结构化详情见下方");
};
function StructuredFields({data,depth=0}:{data:unknown;depth?:number}){
  if(!data||typeof data!=="object")return <p>{visibleValue(data)}</p>;
  const entries=Object.entries(data as Record<string,unknown>);
  if(!entries.length)return <p>{t("暂无数据")}</p>;
  return <dl className={`structured-fields depth-${depth}`}>{entries.map(([key,value])=>{
    const nested=Boolean(value&&typeof value==="object"&&!Array.isArray(value));
    const objectArray=Boolean(Array.isArray(value)&&value.some(item=>item&&typeof item==="object"));
    return <div key={key} className="structured-field">
      <dt>{labelEnum(key)}</dt><dd>{visibleValue(value)}</dd>
      {nested&&depth<2&&<StructuredFields data={value} depth={depth+1}/>}
      {objectArray&&depth<1&&Array.isArray(value)&&<div className="structured-list">{value.slice(0,10).map((item:unknown,index:number)=><StructuredFields key={index} data={item} depth={depth+1}/>)}</div>}
    </div>;
  })}</dl>
}
export function TechnicalDataDrawer({data}:{data:unknown}){
  useLocale();
  return <details className="technical-drawer"><summary>{t("查看结构化技术字段")}</summary><div className="technical-head"><p>{t("仅展示已脱敏的标签字段；完整原始载荷不会呈现在界面中。")}</p></div><StructuredFields data={data}/></details>
}
