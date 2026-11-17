import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessIntentBoundary,parseIntent,evaluate,makeRule} from '../dist/logic.mjs';
const cases=JSON.parse(readFileSync(new URL('./fixtures/compliance-cases.json',import.meta.url)));
const dataset=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url)));
for(const item of cases.blocked)test('refuses '+item.kind+' — '+item.input,()=>{
 const boundary=assessIntentBoundary(item.input);assert.equal(boundary.blocked,true);assert(boundary.categories.includes(item.kind));
 const parsed=parseIntent(item.input,['科技']);assert.deepEqual(parsed.rules,[]);assert.equal(parsed.blocked,true);
 const output=parsed.notes.join(' ');assert.match(output,/不提供确定性涨跌预测、收益承诺或直接买卖建议/);assert.match(output,/历史表现不能保证未来结果/);
 // The response is generic guidance: no stock selected and no promised return value.
 assert(!dataset.stocks.some(s=>output.includes(s.name)));assert(!/保证(?:收益|年化收益)\s*\d/.test(output));
});
for(const text of cases.allowed)test('allows historical research — '+text,()=>{
 assert.equal(assessIntentBoundary(text).blocked,false);const p=parseIntent(text,['科技']);assert(p.rules.length>0);assert.notEqual(p.blocked,true);
});
test('numeric facts and condition judgements are typed separately; missing evidence stays uncertain',()=>{
 const stock=dataset.stocks[0];const rule=makeRule('pe',1000);
 const known=evaluate(stock,[rule],dataset).evidence[0];assert.equal(known.kind,'fact');assert.equal(known.value,stock.pe);assert.equal(known.judgementKind,'inference');assert(known.date);
 const missing=evaluate({...stock,pe:null},[rule],dataset);assert.equal(missing.status,'unknown');assert.equal(missing.evidence[0].kind,'uncertain');assert.equal(missing.evidence[0].judgementKind,'uncertain');assert.equal(missing.evidence[0].pass,null);
});
test('ambiguous user intent yields editable assumptions rather than asserted facts',()=>{
 const p=parseIntent('经营改善、走势相对稳定',['科技']);assert(p.rules.length);assert(p.rules.every(r=>r.inferred===true));
});
