import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
const sql=readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort().flatMap(x=>readFileSync(new URL('../drizzle/'+x,import.meta.url),'utf8').split('--> statement-breakpoint')); 
test('real D1: create, read after reload, owner isolation, failure report persistence, pause and delete',async()=>{
 const mf=new Miniflare({modules:true,scriptPath:new URL('../dist/server/index.js',import.meta.url).pathname,compatibilityDate:'2026-11-01',d1Databases:['DB'],bindings:{SESSION_SECRET:'unit-session',MONITOR_CRON_SECRET:'unit-cron'}});
 try{
  const db=await mf.getD1Database('DB');for(const statement of sql)await db.prepare(statement).run();
  const call=async(path='',method='GET',body,owner='test-owner')=>{const r=await mf.dispatchFetch('http://localhost/api/monitoring/tasks'+path,{method,headers:{'oai-authenticated-user-id':owner,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const validate=async payload=>{const r=await mf.dispatchFetch('https://stock-lens.test/api/research/validate',{method:'POST',headers:{'oai-authenticated-user-id':'test-owner','Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
  const source=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url))).stocks.find(s=>s.code==='600519.SH');
  assert.equal((await validate({rules:[{field:'fakeAlpha',op:'gt',value:5}]})).status,422);
  const proposal={rules:[{field:'pe',op:'lt',value:1000}],claims:[{code:source.code,field:'pe',value:source.pe,asOf:source.valuationAsOf,unit:'倍'}]};
  assert.equal((await validate(proposal)).status,200);
  assert.equal((await validate({...proposal,claims:[{...proposal.claims[0],value:99999}]})).status,422);
  const config={name:'D1集成测试',codes:['600519.SH'],rules:[{field:'pe',op:'lt',value:1000}],schedule:{time:'15:30',days:[1,2,3,4,5]},options:{volDays:20,volRise:50,notices:true}};
  const created=await call('','POST',config);assert.equal(created.status,201);const id=created.data.task.id;
  assert.equal((await call()).data.tasks[0].id,id);assert.equal((await call('','GET',null,'other-owner')).data.tasks.length,0);
  assert.equal((await call('/'+id+'/check','POST',{},'other-owner')).status,404);
  const checked=await call('/'+id+'/check','POST',{});assert.equal(checked.data.report.status,'missing');assert.equal(checked.data.task.lastSuccessAt,null);assert(checked.data.report.stocks[0].issues.some(s=>s.includes('未配置')));
  const restored=(await call()).data.tasks[0];assert(restored.lastCheckAt);assert.equal(restored.status,'missing');assert(restored.lastReport.stocks[0].evidence.some(e=>e.pass===null));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitor_runs').first()).n,1);
  // The public deployment must reject anonymous scheduler access.
  const raw=await db.prepare('SELECT data FROM monitor_tasks WHERE id = ?').bind(id).first();const due=JSON.parse(raw.data);due.nextCheckAt='2020-01-01T00:00:00.000Z';await db.prepare('UPDATE monitor_tasks SET data = ? WHERE id = ?').bind(JSON.stringify(due),id).run();
  const denied=await mf.dispatchFetch('https://stock-lens.example/api/monitoring/check-due',{method:'POST'});assert.equal(denied.status,401);
  const automatic=await mf.dispatchFetch('https://stock-lens.example/api/monitoring/check-due',{method:'POST',headers:{Authorization:'Bearer unit-cron'}});const result=await automatic.json();assert.equal(result.checked,1);assert.equal(result.reports[0].status,'missing');
  const duplicate=await mf.dispatchFetch('https://stock-lens.example/api/monitoring/check-due',{method:'POST',headers:{Authorization:'Bearer unit-cron'}});assert.equal((await duplicate.json()).checked,0);
  await call('/'+id,'PATCH',{options:{...config.options,volDays:40}});const newBaseline=JSON.parse((await db.prepare('SELECT data FROM monitor_tasks WHERE id = ?').bind(id).first()).data).baseline;assert.equal(newBaseline['600519.SH'].vol,null);
  await call('/'+id,'PATCH',{enabled:false});const skipped=await call('/'+id+'/check','POST',{});assert.equal(skipped.data.skipped,true);
  await call('/'+id,'DELETE');assert.equal((await call()).data.tasks.length,0);
 }finally{await mf.dispose();}
});
