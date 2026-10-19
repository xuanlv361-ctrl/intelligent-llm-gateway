/** Presentation-only source migration. No DOM rewriting, APIs or user data. */
import fs from 'node:fs';
import path from 'node:path';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {execFileSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'web/src');
if(process.argv.includes('--restore-inline-space')) {
  const pageFiles=[];
  function collectPages(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()&&!['i18n','test','routing','demo'].includes(entry.name))collectPages(file);else if(entry.isFile()&&file.endsWith('.tsx')&&!file.endsWith('.test.tsx'))pageFiles.push(file);}}
  collectPages(sourceRoot);let count=0;
  for(const file of pageFiles){const relative=path.relative(root,file).replaceAll('\\','/');let original;try{original=execFileSync('git',['show',`HEAD:${relative}`],{cwd:root,encoding:'utf8',maxBuffer:3000000,windowsHide:true});}catch{continue;}
    const baseline=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const padding=new Map();
    function collect(node){if(ts.isJsxText(node)){const text=node.getText(baseline);if(!text.includes('\n')&&text.trim()){const key=text.trim();const old=padding.get(key)||['',''];padding.set(key,[/^\s/.test(text)?' ':old[0],/\s$/.test(text)?' ':old[1]]);}}ts.forEachChild(node,collect);}collect(baseline);
    const source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const edits=[];
    function repair(node){if(ts.isJsxExpression(node)&&node.expression&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='uiText'){const arg=node.expression.arguments[0];if(arg&&ts.isStringLiteral(arg)&&arg.text===arg.text.trim()){const pad=padding.get(arg.text);if(pad&&(pad[0]||pad[1]))edits.push({start:arg.getStart(ast),end:arg.end,text:JSON.stringify(pad[0]+arg.text+pad[1])});}}ts.forEachChild(node,repair);}repair(ast);
    if(edits.length){let next=source;for(const edit of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);fs.writeFileSync(file,next,'utf8');count+=edits.length;}
  }
  console.log(JSON.stringify({restored_inline_spaces:count}));process.exit(0);
}
if(process.argv.includes('--test-locales')) {
  const testFiles=[];
  function collectTests(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()&&!['i18n','routing'].includes(entry.name))collectTests(file);else if(entry.isFile()&&file.endsWith('.test.tsx')&&!file.endsWith('GatewayWorkspacePage.test.tsx'))testFiles.push(file);}}
  collectTests(sourceRoot);
  let count=0;
  for(const file of testFiles){const source=fs.readFileSync(file,'utf8');if(source.includes('beforeLocaleTest'))continue;const relative=path.relative(path.dirname(file),path.join(sourceRoot,'i18n/index')).replaceAll('\\','/');fs.writeFileSync(file,`// Legacy contract tests explicitly exercise the original Chinese locale.\nimport {beforeEach as beforeLocaleTest} from 'vitest';\nimport {setLocale} from ${JSON.stringify(relative.startsWith('.')?relative:'./'+relative)};\nbeforeLocaleTest(()=>setLocale('zh'));\n`+source,'utf8');count++;}
  console.log(JSON.stringify({explicit_test_locales:count}));
  process.exit(0);
}
const apply = process.argv.includes('--apply');
const output = process.argv.find(value => value.startsWith('--inventory='))?.slice(12);
const sourcesOutput = process.argv.find(value => value.startsWith('--sources='))?.slice(10);
const extraOutput = process.argv.find(value => value.startsWith('--extra-sources='))?.slice(16);
const displayProps = new Set(['title','label','description','sub','note','context','caption','placeholder','aria-label','aria-description','alt','emptyMessage','loadingText','meta']);
const displayNames = /^(label|title|description|explanation|notice|error|warning|globalSyncLabel|emptyText|statusLabel|noticeText|errorText|messageText|EMPTY|purpose|sub|note|catalogError)$/;
const files = [];
function visitFiles(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory() && !['i18n','test','demo'].includes(entry.name)) visitFiles(name);
    else if (entry.isFile() && name.endsWith('.tsx') && !name.endsWith('.test.tsx')) files.push(name);
  }
}
visitFiles(sourceRoot);
const inventory = new Map();
let modified = 0;
function isProse(value) {return /[\p{L}]/u.test(value) && !/^(?:https?:|[A-Z0-9_./:-]+$)/.test(value);}
function phrase(value, file) {
  if (!isProse(value)) return;
  const sources = inventory.get(value) || [];
  const relative = path.relative(root,file).replaceAll('\\','/');
  if (!sources.includes(relative)) sources.push(relative);
  inventory.set(value,sources);
}
for (const file of files) {
  const only=process.argv.find(value=>value.startsWith('--only='))?.slice(7).split(',');
  if(only&&!only.includes(path.basename(file)))continue;
  // New graph files are independently localized by their owner.
  if (file.includes(`${path.sep}routing${path.sep}`) || file.includes(`${path.sep}i18n${path.sep}`)) continue;
  const source = fs.readFileSync(file,'utf8');
  const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const edits = [];
  const add = (node,text) => edits.push({start:node.getStart(ast),end:node.end,text});
  const call = value => `uiText(${JSON.stringify(value)})`;
  function expression(node) {
    if (ts.isStringLiteral(node) && isProse(node.text)) {phrase(node.text,file);add(node,call(node.text));}
    else if (ts.isNoSubstitutionTemplateLiteral(node) && isProse(node.text)) {phrase(node.text,file);add(node,call(node.text));}
    else if (ts.isTemplateExpression(node)) {
      let key = node.head.text;
      const args = [];
      node.templateSpans.forEach((span,index)=>{key+=`{${index}}${span.literal.text}`;args.push(`${JSON.stringify(String(index))}: ${span.expression.getText(ast)}`);});
      if (isProse(key)) {phrase(key,file);add(node,`uiText(${JSON.stringify(key)}, {${args.join(', ')}})`);}
    } else if (ts.isConditionalExpression(node)) {expression(node.whenTrue);expression(node.whenFalse);}
    else if (ts.isParenthesizedExpression(node)) expression(node.expression);
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) expression(node.right);
    else if (ts.isIdentifier(node) && (displayNames.test(node.text)||(file.endsWith('GatewayWorkspacePage.tsx')&&node.text==='item'))) add(node,`uiText(${node.text})`);
    else if(file.endsWith('GatewayWorkspacePage.tsx')&&ts.isElementAccessExpression(node)&&node.expression.getText(ast)==='objectives')add(node,`uiText(${node.getText(ast)})`);
  }
  function walk(node, raw = false) {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(ast);
      const attrs = node.openingElement.attributes.properties;
      const ownRaw = raw || ['pre','code','textarea','script','style'].includes(tag) || attrs.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='data-i18n'&&attr.initializer?.getText(ast)==='"off"');
      walk(node.openingElement, raw);
      node.children.forEach(child=>walk(child,ownRaw));
      return;
    }
    if (!raw && ts.isJsxText(node)) {
      const text = node.getText(ast).replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean).join(' ');
      if (isProse(text)) {phrase(text,file);add(node,`{${call(text)}}`);}
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const owner=node.parent?.parent;
      const metricValue=node.name.getText(ast)==='value'&&(ts.isJsxSelfClosingElement(owner)||ts.isJsxOpeningElement(owner))&&owner.tagName.getText(ast)==='MetricCard';
      if ((displayProps.has(node.name.getText(ast))||metricValue) && node.initializer) {
        if (ts.isStringLiteral(node.initializer) && isProse(node.initializer.text)) {phrase(node.initializer.text,file);add(node.initializer,`{${call(node.initializer.text)}}`);}
        else if(ts.isJsxExpression(node.initializer)&&node.initializer.expression) expression(node.initializer.expression);
      }
      // Action slots contain real JSX too. Inspect only nested JSX, never the
      // data expression of value/defaultValue/onChange or other protocol props.
      if(node.initializer){const nested=(child)=>{if(ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child)||ts.isJsxFragment(child))walk(child,raw);else ts.forEachChild(child,nested);};ts.forEachChild(node.initializer,nested);}
      return;
    }
    if (!raw && ts.isJsxExpression(node) && node.expression) {expression(node.expression);ts.forEachChild(node,child=>{if(ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child)||ts.isJsxFragment(child))walk(child,raw);else ts.forEachChild(child,nested=>walk(nested,raw));});return;}
    ts.forEachChild(node,child=>walk(child,raw));
  }
  walk(ast);
  // Prefer outer replacements and discard nested edits to avoid overlaps.
  const unique = edits.sort((a,b)=>a.start-b.start||b.end-a.end).filter((edit,index,all)=>!all.slice(0,index).some(previous=>previous.start<=edit.start&&previous.end>=edit.end));
  if (unique.length) {
    modified++;
    if (apply) {
      let next = source;
      for (const edit of [...unique].reverse()) next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
      if(!source.includes('translate as uiText')) {
        const relative=path.relative(path.dirname(file),path.join(sourceRoot,'i18n/index')).replaceAll('\\','/');
        next=`import {translate as uiText} from ${JSON.stringify(relative.startsWith('.')?relative:'./'+relative)};\n`+next;
      }
      fs.writeFileSync(file,next,'utf8');
    }
  }
}
const rows = [...inventory].map(([source,files])=>({source,files})).sort((a,b)=>a.source.localeCompare(b.source,'en'));
if(output) fs.writeFileSync(path.resolve(root,output),JSON.stringify(rows,null,2)+'\n','utf8');
if(sourcesOutput) fs.writeFileSync(path.resolve(root,sourcesOutput),JSON.stringify(rows.map(row=>row.source),null,2)+'\n','utf8');
if(extraOutput) {
  const known=new Set(JSON.parse(fs.readFileSync(path.join(sourceRoot,'i18n/sources.json'),'utf8')));
  const extras=new Set();
  const extraFiles=[...files];
  for(const name of ['lib/presentation.ts','lib/apiClient.ts','lib/logSyncRange.ts'])extraFiles.push(path.join(sourceRoot,name));
  for(const name of extraFiles) {
    if(name.includes(`${path.sep}routing${path.sep}`))continue;
    const ast=ts.createSourceFile(name,fs.readFileSync(name,'utf8'),ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function collect(node){
      if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&!known.has(node.text)
        &&(/[\u3400-\u9fff]/.test(node.text)||(name.endsWith('GatewayWorkspacePage.tsx')&&isProse(node.text)&&/\s/.test(node.text)&&!node.text.startsWith('gw-'))))extras.add(node.text);
      ts.forEachChild(node,collect);
    }collect(ast);
  }
  fs.writeFileSync(path.resolve(root,extraOutput),JSON.stringify([...extras].sort((a,b)=>a.localeCompare(b,'en')),null,2)+'\n','utf8');
  console.log(JSON.stringify({extra_sources:extras.size}));
}
console.log(JSON.stringify({mode:apply?'apply':'inventory',files:modified,phrases:rows.length,inventory:output||null}));
