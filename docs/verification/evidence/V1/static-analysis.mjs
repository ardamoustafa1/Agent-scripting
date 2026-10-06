import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const root='/Users/ardamoustafa/agent scripting';const require=createRequire(root+'/package.json');const ts=require('typescript');
const E=root+'/docs/verification/evidence/V1';
const {createApiProgram,inventoryRoutes}=await import(root+'/scripts/audit-route-inventory.mjs');
const {catalogInventory}=await import(root+'/scripts/i18n-inventory.mjs');
const cats=catalogInventory();cats.onlyTR=cats.trKeys.filter(k=>!cats.enKeys.includes(k));cats.onlyEN=cats.enKeys.filter(k=>!cats.trKeys.includes(k));fs.writeFileSync(E+'/i18n.json',JSON.stringify(cats,null,2));
const excluded=new Set(['node_modules','dist','coverage','.turbo','generated','test-results','playwright-report','reports','.astro','.git','.stryker-tmp','benchmark-dist','benchmark-report','target','build']);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>excluded.has(x.name)?[]:x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const all=['apps','packages','scripts','infra','deploy','tests'].flatMap(d=>files(root+'/'+d));
const code=all.filter(f=>/\.(?:[cm]?[jt]sx?|java|py|sh|html|json|ya?ml|sql)$/.test(f)||f.endsWith('Dockerfile'));
const isTest=f=>/\.(?:spec|test|stories)\.|\/e2e\/|\/test\/|\/tests\/|\/fixtures?\/|test-fixtures|test-setup|marketplace-test\.ts|\/testing\/|\/fixtures\.ts|\.spec\.helpers|\/benchmark\//.test(f);
const findings=[];
function add(category,file,line,text,detail,kind){findings.push({category,file:path.relative(root,file),line,snippet:text.trim().slice(0,240),detail,scope:kind??(isTest(file)?'test/fixture':file.endsWith('/api/generated.ts')?'generated-contract':file.includes('/src/')?'production/source':'tooling/config')});}
const patterns=[
 ['marker',/\b(?:TODO|FIXME|HACK|XXX)\b|not implemented|coming soon|placeholder|lorem ipsum/gi],
 ['skipped-or-exclusive-test',/\b(?:info|testInfo)\.skip\s*\(|\b(?:test|it|describe)(?:\.[\w]+)*\.(?:skip|skipIf|runIf|only|todo)\b|\b(?:xit|xdescribe)\s*\(/g],
 ['type-or-lint-suppression',/@ts-ignore|@ts-expect-error|\bas\s+any\b|eslint-disable(?:-next-line|-line)?/g],
 ['constant-assertion',/expect\s*\(\s*(?:true|false|\d+|['"][^'"]*['"])\s*\)\s*\.(?:toBe|toEqual|toBeTruthy|toBeFalsy|toBeDefined)\s*\(/g],
 ['console-log',/\bconsole\.log\s*\(/g],
 ['mock-or-synthetic',/\b(?:mock\w*|fake\w*|dummy\w*|synthetic\w*)\b/gi],
 ['hardcoded-credential-candidate',/\b(?:password|passwd|token|secret|apiKey|api_key|username|userName)\b\s*[:=]\s*['"][^'"\n]{3,}['"]/g],
 ['not-implemented-throw',/throw\s+new\s+Error\s*\(\s*['"](?:Not implemented|not implemented)[^'"\n]*['"]/g]
];
for(const file of code){const content=fs.readFileSync(file,'utf8');const lines=content.split('\n');
 for(let i=0;i<lines.length;i++)for(const [category,regex]of patterns){regex.lastIndex=0;if(!regex.test(lines[i]))continue;
  const context=lines.slice(Math.max(0,i-2),i+3).join(' ');
  let detail='Statik aday; davranış/amaç incelemesi gerekli.';
  if(category==='marker'&&/placeholder\s*=|placeholder:|placeholder\)/.test(lines[i]))detail='UI placeholder alanı olabilir; stub kanıtı değildir.';
  if(category==='type-or-lint-suppression')detail=/@ts-expect-error/.test(lines[i])?(/@ts-expect-error\s+\S/.test(lines[i])?'Açıklama var; anayasanın issue URL şartını ayrıca kontrol et.':'Aynı satırda açıklama yok.'):/eslint-disable/.test(lines[i])?(/--\s*\S|because|reason|fixture|test|generated|compatib|intentional/i.test(context)?'Yakın bağlamda açıklama adayı var; rule ve issue gerekçesi incelenmeli.':'Yakın bağlamda açık gerekçe bulunmadı.'): 'Açık exception gerekçesi incelemesi gerekli.';
  if(category==='mock-or-synthetic')detail=isTest(file)?'Test/fixture kullanımı; production stub hükmü verilmez.':/simulator|mock-profile|preview|demo|seed/i.test(file)?'Simülatör/preview/demo alanı; gerçek vendor eşdeğerliği değildir.':'Production source içinde aday; execution path incelenmeli.';
  const snippet=category==='hardcoded-credential-candidate'?lines[i].replace(/(['"])[^'"\n]+\1/g,'[REDACTED_LITERAL]'):lines[i];
  add(category,file,i+1,snippet,detail);
 }
 if(!/\.[cm]?[jt]sx?$/.test(file))continue;
 const sf=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const visit=n=>{
  if(isTest(file)&&ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&ts.isCallExpression(n.expression.expression)){
   const expectCall=n.expression.expression;
   if(expectCall.expression.getText(sf)==='expect'){
    const value=expectCall.arguments[0];const expected=n.arguments[0];const matcher=n.expression.name.text;
    const literal=x=>x&&(ts.isStringLiteralLike(x)||ts.isNumericLiteral(x)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(x.kind)||x.getText(sf)==='undefined');
    if(literal(value)&&((['toBe','toEqual','toStrictEqual'].includes(matcher)&&literal(expected)&&value.getText(sf)===expected.getText(sf))||(matcher==='toBeTruthy'&&value.getText(sf)==='true')||(matcher==='toBeFalsy'&&value.getText(sf)==='false')||(matcher==='toBeDefined'&&value.getText(sf)!=='undefined')))
     add('tautological-assertion',file,sf.getLineAndCharacterOfPosition(n.getStart()).line+1,n.getText(sf),'Literal üzerinde daima geçen assertion; sistem davranışı doğrulamıyor.');
   }
  }

  if((ts.isFunctionDeclaration(n)||ts.isMethodDeclaration(n)||ts.isArrowFunction(n)||ts.isFunctionExpression(n))&&n.body&&ts.isBlock(n.body)&&n.body.statements.length===0){
   const line=sf.getLineAndCharacterOfPosition(n.getStart()).line+1;
   add('empty-function',file,line,n.getText(sf).replace(/\s+/g,' ').slice(0,180),/\/\*|\/\//.test(n.body.getText(sf))?'Boş gövde içinde açıklama var; no-op/dispose sözleşmesi incelenmeli.':'Boş gövde; test noop ile production iskeleti ayrılmalı.');
  }
  if(!isTest(file)&&!file.includes('/locales/')&&file.includes('/src/')){
   if(ts.isJsxText(n)&&n.text.trim()&&/[\p{L}]{2}/u.test(n.text.trim()))add('hardcoded-ui-text',file,sf.getLineAndCharacterOfPosition(n.getStart()).line+1,n.text,'JSX literal görünür metin; i18n kullanılmıyor.');
   if(ts.isJsxExpression(n)&&n.expression&&ts.isStringLiteralLike(n.expression)&&/[\p{L}]{2}/u.test(n.expression.text))add('hardcoded-ui-text',file,sf.getLineAndCharacterOfPosition(n.getStart()).line+1,n.getText(sf),'JSX expression literal kullanıcı metni adayı.');
   if(ts.isPropertyAssignment(n)&&['label','title','description','message','heading','caption','placeholder','text'].includes(n.name.getText(sf).replace(/^['\"]|['\"]$/g,''))&&ts.isStringLiteralLike(n.initializer)&&/[\p{L}]{2}/u.test(n.initializer.text)&&file.endsWith('.tsx'))add('hardcoded-ui-text-candidate',file,sf.getLineAndCharacterOfPosition(n.getStart()).line+1,n.getText(sf),'Frontend label/metin property literal; i18n key veya teknik kullanıcı verisi olabilir, incele.');
   if(ts.isJsxAttribute(n)&&['placeholder','title','aria-label','alt','label'].includes(n.name.getText(sf))&&n.initializer&&ts.isStringLiteral(n.initializer)&&/[\p{L}]{2}/u.test(n.initializer.text))add('hardcoded-ui-text',file,sf.getLineAndCharacterOfPosition(n.getStart()).line+1,n.getText(sf),'JSX literal kullanıcı metni/erişilebilir isim; dinamik script içerikleriyle karıştırma.');
  }
  ts.forEachChild(n,visit);
 };visit(sf);
}
fs.writeFileSync(E+'/static-findings.json',JSON.stringify(findings,null,2));
// All Nest controller routes, GET/HEAD/OPTIONS included, plus direct docs plugin routes.
const program=createApiProgram(root);const checker=program.getTypeChecker();const mutations=inventoryRoutes(program,root);const openapi=JSON.parse(fs.readFileSync(root+'/apps/api/openapi.json','utf8'));
const testfiles=code.filter(f=>isTest(f)&&/\.[cm]?[jt]sx?$/.test(f));const literals=[];
for(const f of testfiles){const s=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true);const walk=n=>{if(ts.isStringLiteralLike(n)||ts.isTemplateExpression(n)){
 const text=ts.isTemplateExpression(n)?n.getText(s).slice(1,-1).replace(/\$\{[^}]*\}/g,':value'):n.text;
 if(text.startsWith('/')&&!text.startsWith('//'))literals.push({text,file:path.relative(root,f),line:s.getLineAndCharacterOfPosition(n.getStart()).line+1});
 }ts.forEachChild(n,walk);};walk(s);}
function decs(n){return((ts.canHaveDecorators(n)?ts.getDecorators(n):[])??[]).map(d=>{const x=d.expression;const callee=ts.isCallExpression(x)?x.expression:x;let sym=checker.getSymbolAtLocation(callee);if(sym?.flags&ts.SymbolFlags.Alias)sym=checker.getAliasedSymbol(sym);return{name:sym?.name??callee.getText(),args:ts.isCallExpression(x)?[...x.arguments]:[],text:d.getText()};});}
function strings(n){if(!n)return[''];if(ts.isStringLiteralLike(n))return[n.text];if(ts.isArrayLiteralExpression(n))return n.elements.flatMap(strings);return['<computed:'+n.getText()+'>'];}
function loc(n){const s=n.getSourceFile();return {file:path.relative(root,s.fileName),line:s.getLineAndCharacterOfPosition(n.getStart()).line+1};}
function shape(t){return t.split('?')[0].replace(/\/$/,'').split('/');}
function matches(route,t){const a=shape(route),b=shape(t);return a.length===b.length&&a.every((x,i)=>x.startsWith(':')||b[i]?.startsWith(':')||x===b[i]);}
const routes=[];
for(const sf of program.getSourceFiles()){
 if(!sf.fileName.startsWith(root+'/apps/api/src')||!sf.fileName.endsWith('.controller.ts'))continue;
 for(const klass of sf.statements.filter(ts.isClassDeclaration)){
 const cd=decs(klass);const ctrl=cd.find(d=>d.name==='Controller');if(!ctrl)continue;
 for(const method of klass.members.filter(ts.isMethodDeclaration)){
 const md=decs(method);const decorators=[...cd,...md];const rd=md.filter(d=>['Get','Post','Put','Patch','Delete','Head','Options','All'].includes(d.name));
 for(const route of rd)for(const prefix of strings(ctrl.args[0]))for(const suffix of strings(route.args[0])){
 const url='/'+[prefix,suffix].filter(Boolean).join('/').replace(/^\/+|\/+$/g,'');const verb=route.name.toUpperCase();const names=decorators.map(d=>d.name);const pub=names.includes('Public');
 const params=method.parameters.flatMap(decs);const z=params.filter(d=>['ZBody','ZQuery','ZParam'].includes(d.name));const raw=params.filter(d=>['Body','Query','Param'].includes(d.name));
 const bodyText=method.body?.getText()??'';
 const evidence=mutations.find(r=>r.method===verb&&r.path===url);
 const candidates=literals.filter(t=>matches(url,t.text));
 const oa=url.replace(/:([\w]+)/g,'{$1}');const op=openapi.paths?.[oa]?.[verb.toLowerCase()];
 const permissions=decorators.filter(d=>['Can','RequirePermissions','AnyAuthenticated','UseGuards'].includes(d.name)).map(d=>d.text);
 const mutating=['POST','PUT','PATCH','DELETE','ALL'].includes(verb);
 routes.push({method:verb,path:url,controller:klass.name?.text,handler:method.name.getText(),...loc(method),public:pub,permissions,guard:pub?'Global guard @Public ile bypass; protokol/iç auth incelenmeli':permissions.length?'Global AuthenticationGuard + AccessGuard; '+permissions.join(' '):'Global AuthenticationGuard + AccessGuard; permission bildirimi yok (deny-default)',zod:z.map(d=>d.text),rawParameters:raw.map(d=>d.text),validation:z.length?'Zod edge decorator var'+(raw.length?'; ayrıca raw param mevcut':''):/(?:\.parse|\.safeParse)\(/.test(bodyText)?'Handler içinde parse adayı (şema türü incelenmeli)':'Doğrudan Zod edge bulunmadı; service/protokol kontrolü gerekli',audit:mutating?evidence?.auditEvidence.length?(evidence.strategy==='transaction-interceptor'?'Global tx audit interceptor':'Explicit audit callgraph adayı'):(url==='/auth/discover'?'Read-only POST exemption':'Audit callgraph bulunmadı; incele'):'Mutasyon değil'+(names.includes('AuditRead')?'; @AuditRead var':''),auditEvidence:evidence?.auditEvidence??[],testCandidates:candidates.slice(0,12),openapi:!!op,openapiSecurity:op?.security??null});
 }
 }
 }
}
routes.sort((a,b)=>(a.path+a.method).localeCompare(b.path+b.method));
fs.writeFileSync(E+'/routes.json',JSON.stringify({interpretation:'Static guard/validation/audit/test-literal reachability candidates; no endpoint behavioral pass inferred.',globalGuardEvidence:'apps/api/src/app.module.ts:72',routes},null,2));
const count={};for(const f of findings)count[f.category]=(count[f.category]??0)+1;
console.log(JSON.stringify({findings:count,routes:routes.length,undocumented:routes.filter(r=>!r.openapi).length,TR:cats.trKeys.length,EN:cats.enKeys.length,onlyTR:cats.onlyTR.length,onlyEN:cats.onlyEN.length,missingLiteralUsages:cats.missing.length},null,2));
