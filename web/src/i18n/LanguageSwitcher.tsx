import {translate,useLocale} from './index';
export function LanguageSwitcher(){
  const {locale,setLocale}=useLocale();
  return <label className="locale-control"><span className="control-symbol" aria-hidden="true">文</span><span className="sr-only">{translate('Language')}</span>
    <select aria-label={translate('Language')} value={locale} onChange={event=>setLocale(event.target.value as 'en'|'zh'|'ja')}><option value="en">English</option><option value="zh">中文</option><option value="ja">日本語</option></select>
  </label>;
}
