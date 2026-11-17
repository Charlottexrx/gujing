import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chinaDate,nextDue,validateTask,inspectStock} from '../worker/monitor.mjs';
import {fuyao,fetchNotices,requestJson} from '../worker/providers.mjs';
const snapshot=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url)));
snapshot.tradingDays=[...new Set(snapshot.stocks.flatMap(s=>s.prices.map(p=>p[0])))].sort();
const stock=snapshot.stocks.find(s=>s.code==='600519.SH');
const config={name:'测试监控',codes:[stock.code],rules:[{field:'pe',op:'lt',value:1000}],schedule:{time:'15:30',days:[1,2,3,4,5]},options:{volDays:20,volRise:50,notices:true}};
const task={...config,createdAt:'2026-11-16T01:00:00Z'};
const live={stock,asOf:snapshot.asOf,tradingDays:snapshot.tradingDays,valuationAsOf:snapshot.valuationAsOf,notices:[{title:'贵州茅台：新公告',date:'2026-11-16'}],noticesValid:true,issues:[]};
test('China market schedule uses UTC+8, skips weekends and supports a selected weekday',()=>{
 assert.equal(chinaDate('2026-11-16T23:00:00Z'),'2026-11-17');
 assert.equal(nextDue(config.schedule,'2026-11-20T08:00:00Z'),'2026-11-23T07:30:00.000Z');
 assert.equal(nextDue({time:'18:30',days:[5]},'2026-11-17T08:00:00Z'),'2026-11-20T10:30:00.000Z');
});
test('save validates conditions, sample membership and schedule server-side',()=>{
 assert.equal(validateTask(config,snapshot).codes[0],stock.code);
 assert.throws(()=>validateTask({...config,codes:['FAKE.SH']},snapshot));
 assert.throws(()=>validateTask({...config,schedule:{time:'12:00',days:[1]}},snapshot));
 assert.throws(()=>validateTask({...config,rules:[{field:'pe',op:'lt',value:0}]},snapshot));
});
test('dropped conditions and new notices alert once; recovered observations remain traceable',()=>{
 const t={...task,rules:[{field:'pe',op:'lt',value:1}]};
 const first=inspectStock(t,stock,live,{conditionStatus:'in',noticeKeys:[]});
 assert(first.row.events.some(e=>e.type==='dropped'));assert(first.row.events.some(e=>e.type==='notice'));
 const again=inspectStock(t,stock,live,first.next);assert.equal(again.row.events.length,0);
 assert.equal(first.row.evidence[0].value,stock.pe);assert.equal(first.row.evidence[0].source,'扶摇估值快照');
});
test('missing values never advance a known passing baseline or masquerade as normal',()=>{
 const r=inspectStock(task,stock,{...live,stock:{...stock,pe:null,prices:[]},issues:['iFinD 超时'],notices:[],noticesValid:false},{conditionStatus:'in',vol:1,volDate:'2026-11-15'});
 assert.equal(r.row.conditionStatus,'unknown');assert.equal(r.row.complete,false);assert.equal(r.next.conditionStatus,'in');assert.equal(r.next.vol,1);assert(r.row.issues.length>=3);
});
test('relative volatility surge threshold and same-day deduplication use actual historical returns',()=>{
 const r=inspectStock(task,stock,live,{conditionStatus:'in',vol:.001,volDate:'2026-11-15',noticeKeys:[]});
 assert(r.row.events.some(e=>e.type==='volatility'));const again=inspectStock(task,stock,live,r.next);assert(!again.row.events.some(e=>e.type==='volatility'));
});
for(const [label,response] of [['HTTP error',()=>new Response('{}',{status:503})],['business error',()=>Response.json({code:2003})],['empty',()=>Response.json({code:0,data:{item:[]}})]])test('live Fuyao rejects '+label,async()=>{
 await assert.rejects(fuyao({FUYAO_API_KEY:'test'},'/test',{},async()=>response()));
});
test('live HTTP timeout is bounded and explicit',async()=>{
 await assert.rejects(requestJson('https://test',{}, {},()=>new Promise(()=>{}),8),/超时/);
});
for(const [label,data] of [['empty',[]],['issuer mismatch',[{'公告标题':'其他公司公告','日期':'2026-11-16'}]]])test('iFinD '+label+' does not prove no new notices',async()=>{
 await assert.rejects(fetchNotices({},stock,'2026-11-01','2026-11-16',async()=>Response.json({result:{content:[{type:'text',text:JSON.stringify({code:1,data:JSON.stringify(data)})}]}})),/不能确认/);
});
test('iFinD rejects business errors',async()=>{await assert.rejects(fetchNotices({},stock,'2026-11-01','2026-11-16',async()=>Response.json({result:{content:[{type:'text',text:'{"code":0,"data":[]}'}]}})),/业务错误/);});
test('MCP SSE parses a complete response without waiting for a persistent connection to close',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'));}});
 const r=await requestJson('https://test',{}, {},async()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),100);
 assert.equal(r.body.result.ok,true);
});
