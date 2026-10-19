/* eslint-disable react-refresh/only-export-components */
import type {ReactNode} from "react";
import {getLocale,localeTags,translate as t,useLocale} from "../../i18n";

export type StatusTone="success"|"warning"|"danger"|"neutral"|"info";

export function PageHeader({title,description,actions}:{title:string;description:string;actions?:ReactNode}){
  useLocale();
  return <header className="console-page-header"><div><p className="console-eyebrow">{t("INTELLIGENT ROUTING")}</p><h1>{t(title)}</h1><p>{t(description)}</p></div>{actions&&<div className="page-actions">{actions}</div>}</header>;
}
export function StatusBadge({tone="neutral",children}:{tone?:StatusTone;children:ReactNode}){
  useLocale();
  return <span className={`status-badge status-${tone}`}>{typeof children==="string"?t(children):children}</span>;
}
export function MetricCard({label,value,meta,children}:{label:string;value:ReactNode;meta?:ReactNode;children?:ReactNode}){
  useLocale();
  return <article className="compact-metric"><span>{t(label)}</span><strong>{value}</strong>{meta&&<small>{typeof meta==="string"?t(meta):meta}</small>}{children}</article>;
}
export function EmptyState({title,description,action}:{title:string;description:string;action?:ReactNode}){
  useLocale();
  return <div className="console-empty" role="status"><div aria-hidden="true">○</div><b>{t(title)}</b><p>{t(description)}</p>{action}</div>;
}
export function ErrorState({title,description,onRetry}:{title:string;description:string;onRetry?:()=>void}){
  useLocale();
  return <div className="console-error" role="alert"><b>{t(title)}</b><p>{t(description)}</p>{onRetry&&<button className="secondary" onClick={onRetry}>{t("重新加载")}</button>}</div>;
}
export function Section({title,description,actions,children,className=""}:{title:string;description?:string;actions?:ReactNode;children:ReactNode;className?:string}){
  useLocale();
  return <section className={`console-section ${className}`}><header><div><h2>{t(title)}</h2>{description&&<p>{t(description)}</p>}</div>{actions&&<div className="section-actions">{actions}</div>}</header>{children}</section>;
}
export function formatValue(value:unknown,fallback="未提供"){
  if(value===null||value===undefined||value==="")return t(fallback);
  if(typeof value==="boolean")return t(value?"已开启":"已关闭");
  return String(value);
}
export function formatLocalTime(value:unknown){
  if(!value)return t("未提供");
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?t("未提供"):date.toLocaleString(localeTags[getLocale()],{hour12:false});
}
