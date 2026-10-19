import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sources from './sources.json';
import extraSources from './extra-sources.json';
import { catalog as catalogA, translatedRowCount as countA } from './catalog-a';
import { catalog as catalogB, translatedRowCount as countB } from './catalog-b';
import { catalog as catalogC, translatedRowCount as countC } from './catalog-c';
import { catalog as extraCatalog, translatedRowCount as extraCount } from './extra-catalog';
import {
  catalog, getLocale, LOCALE_KEY, LocaleProvider, setLocale, translate, useLocale,
  type Locale,
} from './index';

const locales: Locale[] = ['en', 'zh', 'ja'];
// JSON examples also contain braces; only interpolation tokens are placeholders.
const placeholders = (text: string) => (text.match(/\{(?:\d+|[A-Za-z_]\w*)\}/g) ?? []).sort();

/** Test-only user data deliberately includes a phrase that is also a UI key. */
function LocaleHarness() {
  const { locale, localeTag, setLocale: changeLocale } = useLocale();
  const [prompt, updatePrompt] = useState('');
  const [response] = useState('成功');
  const [identifier] = useState('REAL-CLAUDE-001');
  return <>
    <nav aria-label="Test language selector">
      {locales.map(value => <button key={value} onClick={() => changeLocale(value)}>{value}</button>)}
    </nav>
    <h1>{translate('请求内容')}</h1>
    <label>{translate('用户任务')}<textarea value={prompt} onChange={event => updatePrompt(event.target.value)} /></label>
    <output data-testid="locale">{locale}</output>
    <output data-testid="locale-tag">{localeTag}</output>
    <p data-testid="model-response">{response}</p>
    <code data-testid="model-identifier">{identifier}</code>
  </>;
}

function renderHarness() {
  return render(<LocaleProvider><LocaleHarness /></LocaleProvider>);
}

beforeEach(() => {
  localStorage.clear();
  setLocale('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale('en');
  localStorage.clear();
  document.documentElement.lang = 'en-GB';
});

describe('Complete UI translation catalogs', () => {
  it('covers all 2,888 inventoried phrases exactly once across the three source packets', () => {
    expect(sources).toHaveLength(2888);
    expect(new Set(sources).size).toBe(sources.length);
    expect([countA, countB, countC]).toEqual([963, 963, 962]);
    expect(Object.keys(catalogA)).toEqual(sources.slice(0, 963));
    expect(Object.keys(catalogB)).toEqual(sources.slice(963, 1926));
    expect(Object.keys(catalogC)).toEqual(sources.slice(1926));
    for (const source of sources) expect(catalog).toHaveProperty(source);
  });

  it('provides nonempty English, Chinese and Japanese text with exact placeholder parity', () => {
    const failures: string[] = [];
    for (const [source, entry] of Object.entries(catalog)) {
      for (const locale of locales) {
        if (typeof entry[locale] !== 'string' || entry[locale].length === 0) failures.push(`${locale}: empty ${source}`);
        if (JSON.stringify(placeholders(entry[locale])) !== JSON.stringify(placeholders(source))) {
          failures.push(`${locale}: placeholder mismatch ${source}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('covers all 572 supplemental phrases with three languages and matching placeholders', () => {
    expect(extraSources).toHaveLength(572);
    expect(extraCount).toBe(572);
    expect(new Set(extraSources).size).toBe(572);
    expect(Object.keys(extraCatalog)).toEqual(extraSources);
    const failures: string[] = [];
    for (const source of extraSources) {
      expect(Object.hasOwn(catalog, source)).toBe(true);
      for (const locale of locales) {
        const translated = extraCatalog[source][locale];
        if (typeof translated !== 'string' || translated.length === 0) failures.push(`${locale}: empty ${source}`);
        if (JSON.stringify(placeholders(translated)) !== JSON.stringify(placeholders(source))) {
          failures.push(`${locale}: placeholder mismatch ${source}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('uses safe own-property lookup for names inherited from Object.prototype', () => {
    for (const locale of locales) {
      setLocale(locale);
      expect(translate('constructor')).toBe('constructor');
      expect(translate('__proto__')).toBe('__proto__');
      expect(translate('toString')).toBe('toString');
    }
  });

  it('translates padded inline labels without losing their spaces', () => {
    for (const locale of locales) {
      setLocale(locale);
      expect(translate(' 请求内容 ')).toBe(` ${catalog['请求内容'][locale]} `);
      expect(translate('\t请求内容\n')).toBe(`\t${catalog['请求内容'][locale]}\n`);
    }
  });

  it('interpolates all values without rewriting identifiers or unknown user data', () => {
    for (const locale of locales) {
      setLocale(locale);
      const label = translate('状态：{0} / {1}', { 0: 'REAL-CLAUDE-001', 1: '成功' });
      expect(label).toContain('REAL-CLAUDE-001');
      expect(label).toContain('成功');
      expect(label).not.toContain('{0}');
      expect(label).not.toContain('{1}');
      expect(translate('RAW-MODEL-RESPONSE: 保留原文')).toBe('RAW-MODEL-RESPONSE: 保留原文');
    }
    expect(translate(null)).toBe('');
    expect(translate(undefined)).toBe('');
  });
});

describe('Locale defaults and persistence', () => {
  it('defaults to English on a fresh import without saved preferences', async () => {
    localStorage.removeItem(LOCALE_KEY);
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.getLocale()).toBe('en');
    expect(fresh.translate('模型')).toBe('Model');
  });

  it.each(['fr', 'EN', 'undefined', ''])('falls back to English for invalid stored value %j', async value => {
    localStorage.setItem(LOCALE_KEY, value);
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.getLocale()).toBe('en');
  });

  it.each<Locale>(['zh', 'ja'])('restores a valid stored %s preference', async locale => {
    localStorage.setItem(LOCALE_KEY, locale);
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.getLocale()).toBe(locale);
  });

  it('falls back safely when browser preference storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable in test'); });
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.getLocale()).toBe('en');
  });

  it('switches visible labels, persists the preference and updates the document language', () => {
    renderHarness();
    expect(screen.getByRole('heading')).toHaveTextContent('Request content');
    fireEvent.click(screen.getByRole('button', { name: 'zh' }));
    expect(screen.getByRole('heading')).toHaveTextContent('请求内容');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: 'ja' }));
    expect(screen.getByRole('heading')).toHaveTextContent('リクエスト内容');
    expect(screen.getByTestId('locale-tag')).toHaveTextContent('ja-JP');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('ja');
    expect(document.documentElement.lang).toBe('ja-JP');
    fireEvent.click(screen.getByRole('button', { name: 'en' }));
    expect(screen.getByRole('heading')).toHaveTextContent('Request content');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en-GB');
  });

  it('rejects unsupported runtime locale values without changing the current preference', () => {
    setLocale('ja');
    setLocale('fr' as Locale);
    expect(getLocale()).toBe('ja');
    expect(localStorage.getItem(LOCALE_KEY)).toBe('ja');
  });

  it('remains usable when writing browser storage fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable in test'); });
    expect(() => setLocale('ja')).not.toThrow();
    expect(getLocale()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja-JP');
  });
});

describe('Locale changes preserve application data and isolation', () => {
  it('preserves controlled request input and the same DOM control across all language switches', () => {
    renderHarness();
    const textarea = screen.getByRole('textbox');
    const userPrompt = '请分析 DeepSeek / deepseek-v4.1-flash-1017。\nReturn JSON: {"ok":true}';
    fireEvent.change(textarea, { target: { value: userPrompt } });
    for (const locale of ['zh', 'ja', 'en'] as const) {
      fireEvent.click(screen.getByRole('button', { name: locale }));
      expect(screen.getByRole('textbox')).toBe(textarea);
      expect(textarea).toHaveValue(userPrompt);
    }
  });

  it('never translates Chinese model response data or model/channel identifiers', () => {
    renderHarness();
    for (const locale of locales) {
      act(() => setLocale(locale));
      expect(screen.getByTestId('model-response')).toHaveTextContent('成功');
      expect(screen.getByTestId('model-identifier')).toHaveTextContent('REAL-CLAUDE-001');
    }
  });

  it('does not trigger fetch, XHR or WebSocket calls when switching locales', () => {
    const fetchSpy = vi.fn();
    const socketSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', socketSpy);
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    renderHarness();
    for (const locale of locales) fireEvent.click(screen.getByRole('button', { name: locale }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });
});
