import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {getLocale,localeTags,setLocale} from './index';
import {
  enumLabels,formatBoolean,formatHttpStatus,formatLatency,formatMissingValue,formatMoney,
  formatPercentage,formatSourceType,formatTimestamp,formatTokenCount,labelEnum,sourceLabels,
} from '../lib/presentation';
import {formatLocalTime,formatValue,MetricCard,PageHeader} from '../components/console/ConsoleUI';
import {DataSourceBanner,TechnicalDataDrawer} from '../components/operations/OperationsUI';

describe('locale-aware presentation helpers',()=>{
  beforeEach(()=>setLocale('en'));
  afterEach(()=>{cleanup();setLocale('en');});

  it('renders every registered enum label in English by default',()=>{
    expect(getLocale()).toBe('en');
    expect(labelEnum('budget_ok')).toBe('Within budget');
    expect(Object.values(enumLabels).every(value=>!/[\u3400-\u9fff]/.test(value))).toBe(true);
    expect(Object.values(sourceLabels).every(value=>!/[\u3400-\u9fff]/.test(value))).toBe(true);
  });

  it('updates exported label maps and fallbacks without changing enum keys',()=>{
    const keys=Object.keys(enumLabels);
    expect(sourceLabels.demo_mock).toBe('Demo data');
    setLocale('ja');
    expect(sourceLabels.demo_mock).toBe('デモデータ');
    expect(labelEnum('budget_ok')).toBe('予算内');
    expect(formatBoolean(false)).toBe('いいえ');
    setLocale('zh');
    expect(sourceLabels.demo_mock).toBe('演示数据');
    expect(labelEnum('budget_ok')).toBe('预算正常');
    expect(Object.keys(enumLabels)).toEqual(keys);
  });

  it('keeps unknown API enums, identifiers, prompts, and model responses unchanged',()=>{
    const raw=['REAL-CLAUDE-001','new_api_status','constructor','toString','__proto__','成功','用中文解释这个模型。','{"model":"deepseek-flash","stream":false}'];
    for(const locale of ['en','zh','ja'] as const){
      setLocale(locale);
      for(const value of raw){
        expect(labelEnum(value)).toBe(value);
        expect(formatMissingValue(value)).toBe(value);
        expect(formatValue(value)).toBe(value);
      }
    }
  });

  it('localises missing states but never replaces measured zero with missing',()=>{
    expect(formatMissingValue(null)).toBe('Unconfirmed');
    expect(formatMissingValue('', 'no-sample')).toBe('Insufficient samples');
    expect(formatMissingValue(0)).toBe('0');
    expect(formatSourceType('unrecognised_source')).toBe('Unconfirmed');
    expect(formatMoney(0)).toBe('¥0.0000');
    expect(formatLatency(0)).toBe('0 ms');
    expect(formatTokenCount(0)).toBe('0');
    expect(formatPercentage(0)).toBe('0.0%');
    expect(formatHttpStatus(429)).toBe('429 Client error');
  });

  it('uses locale-specific date and number formats without currency conversion',()=>{
    const input='2026-10-19T08:34:56Z';
    for(const locale of ['en','zh','ja'] as const){
      setLocale(locale);
      const tag=localeTags[locale];
      const expectedDate=new Date(input).toLocaleString(tag,{hour12:false});
      expect(formatTimestamp(input)).toBe(expectedDate);
      expect(formatLocalTime(input)).toBe(expectedDate);
      expect(formatTokenCount(12345)).toBe(new Intl.NumberFormat(tag).format(12345));
      expect(formatMoney(1234.5,4)).toBe(`¥${new Intl.NumberFormat(tag,{minimumFractionDigits:4,maximumFractionDigits:4}).format(1234.5)}`);
    }
    expect(formatTimestamp('not-a-date')).not.toContain('Invalid Date');
  });

  it('updates shared UI labels live while retaining raw metric values',()=>{
    render(<><PageHeader title="当前模型" description="尚未选择目标模型"/><MetricCard label="实际模型" value="REAL-CLAUDE-001"/></>);
    expect(screen.getByRole('heading',{name:'Current model'})).toBeTruthy();
    expect(screen.getByText('REAL-CLAUDE-001')).toBeTruthy();
    act(()=>setLocale('ja'));
    expect(screen.getByRole('heading',{name:'現在のモデル'})).toBeTruthy();
    expect(screen.getByText('REAL-CLAUDE-001')).toBeTruthy();
  });

  it('retains raw technical values even when they resemble translatable labels',()=>{
    render(<TechnicalDataDrawer data={{response:'成功',model_id:'claude-sonnet',raw_json:'{"status":"success"}',prompt:'当前模型'}}/>);
    expect(screen.getByText('成功',{exact:true})).toBeTruthy();
    expect(screen.getByText('当前模型',{exact:true})).toBeTruthy();
    expect(screen.getByText('claude-sonnet',{exact:true})).toBeTruthy();
    expect(screen.getByText('{"status":"success"}',{exact:true})).toBeTruthy();
  });

  it('preserves UAT no-sample and no-demo-substitution meaning in all languages',()=>{
    const view=render(<DataSourceBanner genuine={false} kind="uat" label="真实 UAT 数据" sample={0}/>);
    expect(view.container.textContent).toContain('demo data is not substituted');
    act(()=>setLocale('zh'));
    expect(view.container.textContent).toContain('不会回退为演示数据');
    act(()=>setLocale('ja'));
    expect(view.container.textContent).toContain('デモで代用しません');
  });
});
