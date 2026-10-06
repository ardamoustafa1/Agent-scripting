from pathlib import Path
import json,shutil,re
root=Path('/Users/ardamoustafa/agent scripting');work=Path('/tmp/verbis-v1-quality-20261004');E=root/'docs/verification/evidence/V1';metrics=['lines','statements','functions','branches'];results=[];zero=[];critical=[]
def relative(file):
 for prefix in [str(work.resolve())+'/',str(work)+'/']:
  if file.startswith(prefix):return file[len(prefix):]
 return file

def aggregate(items):
 out={}
 for metric in metrics:
  total=sum(d[metric]['total'] for d in items);covered=sum(d[metric]['covered'] for d in items)
  out[metric]={'total':total,'covered':covered,'pct':round(covered/total*100,2) if total else None}
 return out
for group in ['apps','packages']:
 for pkg in sorted((work/group).iterdir()):
  if not pkg.is_dir():continue
  f=pkg/'coverage/coverage-summary.json'
  if not f.exists():continue
  data=json.loads(f.read_text());dest=E/'coverage'/group/pkg.name;dest.mkdir(parents=True,exist_ok=True)
  for name in ['coverage-summary.json','coverage-final.json','lcov.info']:
   if (pkg/'coverage'/name).exists():shutil.copy2(pkg/'coverage'/name,dest/name)
  if (pkg/'coverage/index.html').exists():shutil.copytree(pkg/'coverage',dest/'html',dirs_exist_ok=True,ignore=shutil.ignore_patterns('coverage-final.json','lcov.info','coverage-summary.json'))
  floor=90 if group=='packages' else 85 if pkg.name=='api' else 80 if pkg.name.endswith('-web') else 75
  results.append({'workspace':group+'/'+pkg.name,'floor':floor,'total':data['total'],'below':[k for k in metrics if data['total'][k]['pct']<floor]})
  for file,values in data.items():
   if file=='total':continue
   if values['lines']['total'] and not values['lines']['covered']:zero.append({'file':relative(file),'lines':values['lines']['total'],'functions':values['functions']})
  dirs={'designer-web':['editor','flow','rules','lifecycle','preview','integrations'],'agent-web':['launch','desktop'],'admin-web':['workspace']}.get(pkg.name,[])
  for d in dirs:
   values=[v for file,v in data.items() if file!='total' and relative(file).startswith(f'{group}/{pkg.name}/src/{d}/')]
   critical.append({'directory':f'{group}/{pkg.name}/src/{d}','floor':80,'total':aggregate(values),'kind':'frontend-critical','files':len(values)})
  if pkg.name=='api':
   for d in ['modules/launch','modules/authz','modules/audit','modules/integrations/engine/transport.ts','modules/identity/egress/idp-fetch.ts']:
    values=[v for file,v in data.items() if file!='total' and relative(file).startswith(f'{group}/{pkg.name}/src/{d}')]
    critical.append({'directory':f'{group}/{pkg.name}/src/{d}','floor':95,'total':aggregate(values),'kind':'constitution-security','files':len(values)})
# No suite in workspace is not automatically config-only.
noSuite=[]
for group in ['apps','packages']:
 for pkg in sorted((work/group).iterdir()):
  if not pkg.is_dir():continue
  package=pkg/'package.json'
  if not package.exists():
   if (pkg/'build.gradle.kts').exists():noSuite.append({'workspace':group+'/'+pkg.name,'kind':'Java/Gradle; ayrı test komutu çalıştırıldı, V8 coverage kapsamında değil'})
   continue
  d=json.loads(package.read_text())
  if 'test' not in d.get('scripts',{}):noSuite.append({'workspace':group+'/'+pkg.name,'kind':'config-only' if pkg.name.startswith('config-') else 'runtime/build var; standart test scripti yok','scripts':list(d.get('scripts',{}))})
(E/'coverage-analysis.json').write_text(json.dumps({'workspaces':results,'criticalDirectories':critical,'zeroExecutedLineFiles':zero,'noStandardSuite':noSuite},indent=2))
print(json.dumps({'workspaces':len(results),'belowTarget':[x['workspace'] for x in results if x['below']],'criticalBelow':[x['directory'] for x in critical if any(v['pct'] is not None and v['pct']<x['floor'] for v in x['total'].values())],'zeroFiles':zero,'noSuite':noSuite},ensure_ascii=False,indent=2))
