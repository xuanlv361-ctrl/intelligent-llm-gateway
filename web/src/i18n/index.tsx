/* eslint-disable react-refresh/only-export-components -- One external locale store is intentionally shared with its provider; edits may perform a full refresh. */
import {createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {catalog as catalogA} from './catalog-a';
import {catalog as catalogB} from './catalog-b';
import {catalog as catalogC} from './catalog-c';
import {core} from './core';
import {catalog as presentationCatalog} from './presentation-catalog';
import {catalog as extraCatalog} from './extra-catalog';
import {catalog as finalCatalog} from './final-catalog';

export type Locale = 'en' | 'zh' | 'ja';
export type TranslationEntry = {en:string;zh:string;ja:string};
export const LOCALE_KEY = 'llm-gateway.locale.v1';
export const localeTags: Record<Locale,string> = {en:'en-GB',zh:'zh-CN',ja:'ja-JP'};
const allowed = (value:unknown): value is Locale => value === 'en' || value === 'zh' || value === 'ja';
function readLocale():Locale {try {const value=localStorage.getItem(LOCALE_KEY);return allowed(value)?value:'en';}catch{return 'en';}}
let current:Locale = readLocale();
const listeners = new Set<()=>void>();
export function getLocale():Locale {return current;}
export function setLocale(locale:Locale) {
  if(!allowed(locale)) return;
  current=locale;
  try {localStorage.setItem(LOCALE_KEY,locale);}catch{/* Storage is optional. */}
  if(typeof document!=='undefined') document.documentElement.lang=localeTags[locale];
  listeners.forEach(listener=>listener());
}
const subscribe = (listener:()=>void) => {listeners.add(listener);return ()=>listeners.delete(listener);};
export const catalog:Record<string,TranslationEntry> = {...catalogA,...catalogB,...catalogC,...extraCatalog,...presentationCatalog,...finalCatalog,...core};
function interpolate(value:string, values:Record<string,unknown>) {return value.replace(/\{([^{}]+)\}/g,(match,key)=>key in values?String(values[key]):match);}
export function translate(source:unknown, values:Record<string,unknown> = {}):string {
  if(source===null||source===undefined)return '';
  const key=String(source);
  const trimmed=key.trim();
  const entry=Object.hasOwn(catalog,key)?catalog[key]:Object.hasOwn(catalog,trimmed)?catalog[trimmed]:undefined;
  const text=entry?.[current];
  const padded=text===undefined?key:key===trimmed?text:key.slice(0,key.indexOf(trimmed))+text+key.slice(key.indexOf(trimmed)+trimmed.length);
  return interpolate(padded,values);
}
const LocaleContext=createContext<{locale:Locale;setLocale:typeof setLocale;localeTag:string}>({locale:current,setLocale,localeTag:localeTags[current]});
export function LocaleProvider({children}:{children:ReactNode}) {
  const locale=useSyncExternalStore(subscribe,getLocale,()=> 'en' as Locale);
  useEffect(()=>{document.documentElement.lang=localeTags[locale];},[locale]);
  const value=useMemo(()=>({locale,setLocale,localeTag:localeTags[locale]}),[locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale(){const state=useContext(LocaleContext);const locale=useSyncExternalStore(subscribe,getLocale,()=> 'en' as Locale);return {...state,locale,localeTag:localeTags[locale]};}
