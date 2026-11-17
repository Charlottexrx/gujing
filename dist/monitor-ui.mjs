import {fields,operators} from './logic.mjs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'还未检查';
const state={pending:'等待首次检查',checking:'检查中',ok:'本次数据完整',attention:'有变化，请查看',missing:'数据缺失 · 待核验'};
const $=id=>document.getElementById(id);
const ruleText=r=>(r.days?'近 '+r.days+' 个开市日，':'')+fields[r.field].label+' '+operators[r.op]+' '+r.value+(fields[r.field].unit??'');
export function initMonitoring(getScreen){
 let tasks=[],editing=null,busy=new Set();
 async function api(path='',options={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),160000);
  try{const r=await fetch('/api/monitoring/tasks'+path,{...options,headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal});let data;try{data=await r.json();}catch{throw new Error('监控服务没有返回可识别的数据');}if(!r.ok)throw new Error(data.error??'监控服务暂时不可用');return data;}
  catch(e){throw new Error(e.name==='AbortError'?'检查等待超时，结果尚未确认，请刷新任务状态':e.message);}finally{clearTimeout(timer);}
 }
 function message(text){$('monitor-message').textContent=text;$('monitor-message').hidden=!text;}
 function render(){
  $('monitor-count').textContent=tasks.length+' 个任务';
  if(!tasks.length){$('monitor-tasks').innerHTML='<div class="empty">把满意的筛选结果存下来，就可以持续关注它们的变化。<br>点击筛选结果上方的「存成监控任务」开始。</div>';return;}
  const names=new Map((getScreen().dataset?.stocks??[]).map(s=>[s.code,s.name]));
  $('monitor-tasks').innerHTML=tasks.map(t=>{
   const r=t.lastReport,waiting=t.status==='checking',active=busy.has(t.id),unknown=t.status==='missing';
   const status=!t.enabled?'已暂停':state[t.status]??'待检查';
   const alerts=r?.events??[];
   const issues=[...(r?.issues??[]),...(r?.stocks??[]).flatMap(s=>s.issues.map(issue=>s.name+'：'+issue))];
   return '<article class="monitor-task" data-task="'+t.id+'"><div class="monitor-top"><div><h3>'+escape(t.name)+'</h3><p>'+t.codes.length+' 只股票 · 北京时间 '+escape(t.schedule.time)+' · '+t.schedule.days.map(d=>'周'+'日一二三四五六'[d]).join('、')+'</p></div><span class="pill '+(unknown?'warn':t.status==='ok'?'good':'')+'">'+status+'</span></div>'+
    '<p class="monitor-stocks">'+t.codes.map(c=>escape(names.get(c)??c)).join('、')+'</p><div class="monitor-meta"><span>最近检查 <b>'+time(t.lastCheckAt)+'</b></span><span>下次检查 <b>'+(!t.enabled?'已暂停':time(t.nextCheckAt))+'</b></span><span>上次数据完整 <b>'+time(t.lastSuccessAt)+'</b></span></div>'+
    (waiting?'<p role="status">正在分批检查 '+(t.progress?.done??0)+' / '+t.codes.length+' 只。可点「继续检查」完成剩余股票。</p>':'')+
    (r?'<div class="monitor-report '+(unknown?'notice':'')+'"><strong>'+ (unknown?'这次有数据没有拿到，不能确认全部条件':alerts.length?'这次发现 '+alerts.length+' 项变化':'这次未触发提醒')+'</strong>'+(alerts.length?'<ul>'+alerts.map(e=>'<li>'+escape(e.text)+' <small>'+escape(e.date)+'</small></li>').join('')+'</ul>':'')+(issues.length?'<details><summary>查看 '+issues.length+' 项数据缺失或异常</summary><ul>'+issues.map(i=>'<li>'+escape(i)+'</li>').join('')+'</ul></details>':'')+'</div>':'<p class="monitor-note">保存的是 '+escape(t.savedDataAsOf)+' 的筛选结果，尚未用最新数据复查。</p>')+
    '<details class="monitor-evidence"><summary>筛选条件与最近一次检查依据</summary><ul>'+t.rules.map(rule=>'<li>'+escape(ruleText(rule))+'</li>').join('')+'</ul><p>波动提醒：最近 '+t.options.volDays+' 个开市日的日常涨跌幅度，比上次有效检查增加超过 '+t.options.volRise+'%。'+(t.options.notices?'已开启公告检索。':'未开启公告检索。')+'</p>'+
    (r?.stocks??[]).map(s=>'<div class="monitor-stock-evidence"><h4>'+escape(s.name)+' · 行情至 '+escape(s.asOf)+'</h4><ul>'+s.evidence.map(e=>'<li>'+escape(fields[e.rule.field].label)+'：'+(e.pass===null?'待核验':e.pass?'符合':'不符合')+'；实际 '+escape(e.value??'缺失')+escape(fields[e.rule.field].unit??'')+'；'+escape(e.date??'时点缺失')+'；'+escape(e.source)+' '+escape(e.raw??'')+'</li>').join('')+'</ul><p>日常涨跌幅度 '+(s.volatility.value===null?'缺失':s.volatility.value.toFixed(2)+'%')+'；前次 '+(s.volatility.previous===null?'无有效基准':s.volatility.previous.toFixed(2)+'%')+'（'+escape(s.volatility.previousDate??'无')+'）</p><details><summary>原始字段和取数记录（不含密钥）</summary><pre>'+escape(JSON.stringify({requests:s.requests,evidence:s.evidence,volatility:s.volatility},null,2))+'</pre></details></div>').join('')+'</details>'+
    '<div class="row-actions"><button class="button primary" data-monitor-action="check" '+(active||!t.enabled?'disabled':'')+'>'+ (active?'检查中…':waiting?'继续检查':'立即检查')+'</button><button class="button outline" data-monitor-action="toggle" '+(active?'disabled':'')+'>'+ (t.enabled?'暂停':'恢复')+'</button><button class="button quiet" data-monitor-action="edit" '+(active?'disabled':'')+'>修改设置</button><button class="button quiet" data-monitor-action="delete" '+(active?'disabled':'')+'>删除</button></div></article>';
  }).join('');
 }
 async function refresh(){
  try{const data=await api();tasks=data.tasks;render();message('');}
  catch(e){message(e.message+'。当前未能读取任务，不能判断是否检查成功。');}
 }
 function openForm(task=null){
  editing=task;const screen=getScreen();const codes=task?.codes??screen.codes;
  if(!task&&(!codes.length||!screen.rules.length)){message('先完成筛选，且至少有一只股票符合条件。');$('monitoring').scrollIntoView();return;}
  $('monitor-form-title').textContent=task?'修改监控设置':'把这次筛选存成监控任务';
  $('monitor-name').value=task?.name??('我的筛选 · '+codes.length+' 只股票');
  $('monitor-time').value=task?.schedule.time??'15:30';
  for(const box of document.querySelectorAll('[name="monitor-day"]'))box.checked=(task?.schedule.days??[1,2,3,4,5]).includes(Number(box.value));
  $('monitor-vol-days').value=task?.options.volDays??20;$('monitor-vol-rise').value=task?.options.volRise??50;$('monitor-notices').checked=task?.options.notices??true;
  $('monitor-scope').textContent='固定关注这 '+codes.length+' 只当时符合条件的股票，不会自动加入新股票。';
  $('monitor-form-rules').textContent=(task?.rules??screen.rules).map(ruleText).join('；');
  $('monitor-form-error').hidden=true;$('monitor-dialog').showModal();
 }
 $('save-monitor').addEventListener('click',()=>openForm());
 $('monitor-refresh').addEventListener('click',refresh);
 $('monitor-close').addEventListener('click',()=>$('monitor-dialog').close());
 $('monitor-form').addEventListener('submit',async event=>{
  event.preventDefault();const screen=getScreen();const input={name:$('monitor-name').value,rules:editing?.rules??screen.rules,codes:editing?.codes??screen.codes,schedule:{time:$('monitor-time').value,days:[...document.querySelectorAll('[name="monitor-day"]:checked')].map(x=>Number(x.value))},options:{volDays:Number($('monitor-vol-days').value),volRise:Number($('monitor-vol-rise').value),notices:$('monitor-notices').checked}};
  $('monitor-submit').disabled=true;
  try{await api(editing?'/'+editing.id:'',{method:editing?'PATCH':'POST',body:JSON.stringify(input)});$('monitor-dialog').close();await refresh();$('monitoring').scrollIntoView({behavior:'smooth'});}
  catch(e){$('monitor-form-error').hidden=false;$('monitor-form-error').textContent=e.message;}
  finally{$('monitor-submit').disabled=false;}
 });
 $('monitor-tasks').addEventListener('click',async e=>{
  const button=e.target.closest('[data-monitor-action]');if(!button)return;
  const id=button.closest('[data-task]').dataset.task;const t=tasks.find(t=>t.id===id);const action=button.dataset.monitorAction;
  if(action==='edit'){openForm(t);return;}
  if(action==='delete'&&!window.confirm('删除这个监控任务及其检查记录？'))return;
  busy.add(id);render();message('');
  try{
   if(action==='check'){
    let more=true,steps=0;while(more&&steps++<15){const data=await api('/'+id+'/check',{method:'POST',body:'{}'});if(data.task){tasks=tasks.map(t=>t.id===id?data.task:t);render();}if(data.busy){message(data.message);break;}if(data.error)message(data.error);more=data.more;}
   }else await api('/'+id,{method:action==='delete'?'DELETE':'PATCH',body:action==='delete'?undefined:JSON.stringify({enabled:!t.enabled})});
   await refresh();
  }catch(e){message(e.message+'。请刷新状态后再试。');}finally{busy.delete(id);render();}
 });
 refresh();
 setInterval(()=>{if(!document.hidden&&!busy.size)refresh();},60000);
}
