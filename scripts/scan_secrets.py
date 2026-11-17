"""Scan source, build output and every reachable Git blob without printing matches."""
import argparse,datetime,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RULES={
 'fuyao_key':re.compile(rb'sk-fuyao-[A-Za-z0-9_-]{16,}'),
 'openai_key':re.compile(rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}'),
 'ifind_jwe':re.compile(rb'eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]+'),
 'private_key':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'literal_bearer':re.compile(rb'Bearer [A-Za-z0-9_-]{30,}'),
 'email':re.compile(rb'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
}
def hits(data):
 return [kind for kind,pattern in RULES.items() if pattern.search(data)]
def scan(root=ROOT,history=True):
 findings=[];files=set();blobs=0
 paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
 for name in paths:
  p=root/name
  if not name or not p.is_file():continue
  files.add(name)
  for kind in hits(p.read_bytes()):findings.append({'scope':'worktree','path':name,'kind':kind})
 # Generated deployment output is ignored by Git, but is shipped.
 for p in (root/'dist/server').glob('**/*'):
  if p.is_file():
   files.add(str(p.relative_to(root)))
   for kind in hits(p.read_bytes()):findings.append({'scope':'build','path':str(p.relative_to(root)),'kind':kind})
 if history:
  objects=subprocess.check_output(['git','rev-list','--objects','--all'],cwd=root).decode().splitlines()
  process=subprocess.Popen(['git','cat-file','--batch'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
  try:
   for entry in objects:
    oid,_,name=entry.partition(' ')
    process.stdin.write((oid+'\n').encode());process.stdin.flush()
    info=process.stdout.readline().decode().split();size=int(info[2]);data=process.stdout.read(size);process.stdout.read(1)
    if info[1]!='blob':continue
    blobs+=1
    for kind in hits(data):findings.append({'scope':'git-history','object':oid,'path':name,'kind':kind})
  finally:process.stdin.close();process.wait()
 return {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'filesScanned':len(files),'historyBlobsScanned':blobs,'findings':findings,'limits':'Pattern scan for keys, private keys, literal bearer tokens and email addresses; not a proof that every kind of personal data is absent.'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--report');a=p.parse_args();result=scan()
 if a.report:(ROOT/a.report).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False));raise SystemExit(bool(result['findings']))
