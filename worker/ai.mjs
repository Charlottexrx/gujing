import {assessIntentBoundary,validateRules,fields} from '../dist/logic.mjs';
import {validateResearchProposal} from '../dist/research.mjs';
export const MODEL='gpt-5.4-mini';
const properties={field:{type:'string',enum:['gain','vol','profit','pe','industry']},op:{type:'string',enum:['gt','gte','lt','lte','eq']},value:{anyOf:[{type:'number'},{type:'string'}]},days:{anyOf:[{type:'integer',minimum:2,maximum:250},{type:'null'}]},inferred:{type:'boolean'}};
export const schema={type:'object',properties:{status:{type:'string',enum:['ready','clarify','blocked']},rules:{type:'array',maxItems:12,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}},missing:{type:'array',maxItems:6,items:{type:'string',enum:['window','gain','vol','pe','profit','industry','unsupported']}}},required:['status','rules','missing'],additionalProperties:false};
const questions={window:'你想看多少个开市日？例如20日或60日。',gain:'这段时间最多或至少涨多少，才符合你的想法？',vol:'每天涨跌的起伏上限是多少？可以先试1%或2%，再修改。',pe:'你希望股价最多是每股盈利的多少倍？',profit:'利润改善是指累计利润比去年同期更多吗？',industry:'你想看哪一类公司？',unsupported:'这项要求目前没有可核验的指标，请换成页面支持的条件。'};
export function verifyInterpretation(value,text,context,snapshot){
 if(!value||Object.keys(value).some(k=>!['status','rules','missing'].includes(k))||!['ready','clarify','blocked'].includes(value.status)||!Array.isArray(value.rules)||!Array.isArray(value.missing))throw Error('模型返回格式未通过校验');
 if(value.rules.some(r=>!r||Object.keys(r).some(k=>!Object.hasOwn(properties,k))))throw Error('模型包含未支持的条件字段');
 const checked=value.rules.length?validateResearchProposal({rules:value.rules},snapshot.stocks,snapshot).rules:[];
 const numbers=new Set([...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(x=>Number(x[0])));for(const r of context??[]){if(typeof r.value==='number')numbers.add(r.value);if(r.days)numbers.add(r.days);}
 for(const r of checked){if(typeof r.value==='number'&&!numbers.has(r.value))r.inferred=true;if(r.days&&!numbers.has(r.days))r.inferred=true;}
 return {rules:checked,status:value.status==='ready'&&!checked.length?'clarify':value.status,needsClarification:value.status!=='ready'||!checked.length,questions:value.missing.map(k=>questions[k]).filter(Boolean),inferred:checked.some(r=>r.inferred)};
}
export async function interpret(env,input,snapshot,fetcher=fetch){
 if(typeof input?.text!=='string'||input.text.length>2000)throw Error('请输入不超过2000字的选股想法');
 const boundary=assessIntentBoundary(input.text);if(boundary.blocked)return {status:'blocked',rules:[],needsClarification:true,questions:[boundary.message],engine:'deterministic-safety',modelUsed:null};
 if(!env.OPENAI_API_KEY)return {error:'大模型密钥尚未配置，未调用AI；可切换到规则解析继续体验。',code:'MODEL_NOT_CONFIGURED'};
 const context=Array.isArray(input.context)?input.context:[];if(validateRules(context)&&context.length)throw Error('上一轮条件无效');
 const sectors=[...new Set(snapshot.stocks.map(s=>s.sector).filter(Boolean))];
 const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,max_output_tokens:1400,reasoning:{effort:'none'},instructions:'你是中文股票研究意图解释器。只把用户意图变为数据条件，不推荐买卖，不提供必涨预测或收益承诺，不编造股票数字。只输出规定JSON。gain=区间涨跌幅百分数，vol=日简单收益样本标准差百分数，profit=最新已披露累计归母净利润同比百分数(正基期)，pe=正PE TTM倍数，industry=行业组。gain/vol须有2至250交易日days，其余days=null。value行业字符串，其余为数值。所有条件为AND。模糊的“最近涨得不错、每天别起伏太大”必须追问window/gain/vol，不得自行断言阈值。明确数字按原文，语义默认数字标inferred=true，需要用户确认。后续“把涨幅放宽到40%”沿用上一轮其他条件，只改对应涨幅上限。无法支持的指标、未来价格保证、行业多选等给clarify或blocked，不以部分条件冒充完整。status=ready仅当意图可执行，clarify时列missing。行业组只有'+sectors.join('、')+'。不要数据声明或自由建议。',input:JSON.stringify({text:input.text,context}),text:{format:{type:'json_schema',name:'stock_intent',strict:true,schema}}}),signal:AbortSignal.timeout(25000)});
 if(!response.ok)return {error:'大模型调用未成功（HTTP '+response.status+'），未生成正常条件，请重试或切换规则解析。',code:'MODEL_API_FAILED'};
 const raw=await response.json();if(raw.status!=='completed')return {error:'大模型回复未完整返回，条件未采用。',code:'MODEL_INCOMPLETE'};
 const content=raw.output?.flatMap(o=>o.content??[]).find(c=>c.type==='output_text')?.text;if(!content)throw Error('大模型未返回可核验的结构化条件');
 const result=verifyInterpretation(JSON.parse(content),input.text,context,snapshot);return {...result,engine:'openai',modelUsed:raw.model,responseId:raw.id,usage:raw.usage??null};
}
