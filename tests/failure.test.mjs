import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readSnapshot,validMarketSnapshot,validNoticeSnapshot,sourceFailureText} from '../dist/logic.mjs';

const snapshots={
  fuyao:JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url),'utf8')),
  ifind:JSON.parse(readFileSync(new URL('../dist/ifind-notices.json',import.meta.url),'utf8')),
};
const validators={fuyao:validMarketSnapshot,ifind:validNoticeSnapshot};
const sourceNames={fuyao:'扶摇数据没拿到',ifind:'iFinD 公告没拿到'};
const response=(data,ok=true)=>({ok,json:async()=>data});

for (const source of ['fuyao','ifind']) {
  test(source+' successful payload is accepted',async()=>{
    assert.equal(await readSnapshot('/data',validators[source],async()=>response(snapshots[source])),snapshots[source]);
  });
  for (const failure of ['timeout','error','empty']) {
    test(source+' / '+failure+' is reported with source-specific failure state',async()=>{
      let signal;
      const input=async(_url,options)=>{
        signal=options.signal;
        if(failure==='timeout') return new Promise(()=>{});
        if(failure==='error') return response({code:503,message:'unavailable'},false);
        return response(source==='fuyao'?{...snapshots.fuyao,stocks:[]}:{...snapshots.ifind,notices:{}});
      };
      await assert.rejects(readSnapshot('/data',validators[source],input,15),error=>{
        assert.equal(error.kind,failure);
        const message=sourceFailureText(source,error);
        assert.ok(message.includes(sourceNames[source]));
        assert.ok(message.includes({timeout:'超时',error:'失败',empty:'空数据'}[failure]));
        if(source==='fuyao') assert.match(message,/筛选和组合计算暂不可用/);
        else assert.match(message,/公告核验未完成/);
        return true;
      });
      assert.equal(signal.aborted,failure==='timeout');
    });
  }
  test(source+' HTTP 200 with an upstream error is rejected',async()=>{
    await assert.rejects(readSnapshot('/data',validators[source],async()=>response({code:2003,message:'API error'})),{kind:'error'});
  });
  test(source+' an empty JSON body cannot become a normal zero-result screen',async()=>{
    await assert.rejects(readSnapshot('/data',validators[source],async()=>response({})),{kind:'empty'});
  });
}

test('timeout covers JSON body download as well as response headers',async()=>{
  await assert.rejects(readSnapshot('/data',validMarketSnapshot,async()=>({ok:true,json:()=>new Promise(()=>{})}),15),{kind:'timeout'});
});

test('malformed nested fields are rejected before the page starts rendering data',()=>{
  assert.equal(validMarketSnapshot({...snapshots.fuyao,stocks:[{code:'600519.SH',pool:true,prices:[]}]}),false);
  assert.equal(validNoticeSnapshot({...snapshots.ifind,notices:{'600519.SH':[]}}),false);
  assert.equal(validNoticeSnapshot({...snapshots.ifind,notices:{'600519.SH':[{title:'',date:'2026-11-01'}]}}),false);
});
