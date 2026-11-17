import {provenance,freshness,noticeCoverage,specialStockNotes,compareScreen,explainEmpty,validateResearchProposal,shareScreen,readSharedScreen} from './research.mjs';
import {initMonitoring} from './monitor-ui.mjs';
import {example,fields,operators,makeRule,parseIntent,assessIntentBoundary,validateRules,evaluate,percent,isNumber,
  slicePrices,pathMetrics,alignedReturns,portfolioMetrics,diversification,readSnapshot,validMarketSnapshot,validNoticeSnapshot,sourceFailureText} from './logic.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const statuses = {in:'符合条件',out:'不符合条件',unknown:'数据待核验'};
const periods = {screen:'筛选时段',today:'今日',week:'本周',month:'本月',quarter:'近 3 个月',year:'近 1 年',history:'可用历史'};
let dataset, stocks=[], industries=[], rules=[], executed=[], results=[], tab='in', currentDetail='', currentPeriod='screen';
let compareA='', compareB='', comparePeriod='screen';
let blockedIntent=false,unresolvedIntent=false;
let ifind=null, ifindStatus='loading', ifindFailure='', marketFailure='';
const holdings = new Map();
let objective='risk', allocation=20, ceiling=30, toastTimer;
const storageKey='stock-lens-screen-v1';

function notify(text) {
  $('toast').textContent=text;
  $('toast').hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{$('toast').hidden=true},2600);
}
function notice(id, text) {
  $(id).textContent=text;
  $(id).hidden=!text;
}
const byCode = code => stocks.find(stock=>stock.code===code);
const fieldName = f => fields[f].label;
const option = (value,label,selected) => '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const stockOptions = (selected, available=stocks) => available.map(s=>option(s.code,s.name+' · '+s.code+(s.pool?'':' · 样本外'),selected)).join('');
const fieldValue = (value, field) => !isNumber(value) ? (value||'待核验') : fields[field].unit==='%' ? percent(value,field!=='vol') : value.toFixed(2)+' 倍';
const ruleText = rule => (fields[rule.field].days?'近 '+rule.days+' 个开市日 ':'')+fieldName(rule.field)+' '+operators[rule.op]+' '+rule.value+(fields[rule.field].unit ?? '');
const showRuleMessage = evidence => evidence.pass===null ? (evidence.reason||'数据待核验') :
  evidence.pass ? '符合' : '未达到「'+ruleText(evidence.rule)+'」';
const chosenDays = () => executed.find(r=>r.days)?.days??20;
const badge = (text,type='') => '<span class="pill '+type+'">'+esc(text)+'</span>';

function enforceBoundary() {
  const boundary=assessIntentBoundary($('intent').value);
  blockedIntent=boundary.blocked;
  notice('compliance-notice',boundary.message);
  if (!boundary.blocked) return false;
  unresolvedIntent=false;rules=[];executed=[];results=[];currentDetail='';tab='in';
  $('changes').hidden=true;
  for (const id of ['detail-dialog','compare-dialog','monitor-dialog']) if ($(id).open) $(id).close();
  renderRules();renderResults();
  return true;
}

function generate(scrollToConditions=true) {
  if (enforceBoundary()) {notice('parse-notice','');notice('rule-error','');return;}
  const parsed=parseIntent($('intent').value,industries,rules.length?rules:executed);
  rules=parsed.rules;
  unresolvedIntent=Boolean(parsed.needsClarification||parsed.unsupported?.length);
  if(unresolvedIntent){executed=[];results=[];renderResults();}
  notice('parse-notice',parsed.notes.join(' '));
  notice('rule-error','');
  renderRules();
  if (scrollToConditions && results.length) $('result-description').textContent='下方保留上一次筛选结果。确认新条件后点「开始筛选」更新。';
  renderPreview();
  if (scrollToConditions) $('conditions').scrollIntoView({behavior:'smooth'});
}

function renderRules() {
  $('rules').innerHTML=rules.length ? rules.map((r,i)=>{
    const schema=fields[r.field];
    const fieldOptions=Object.keys(fields).map(f=>option(f,fields[f].label,r.field)).join('');
    const allowed=[...Object.keys(operators)].map(key=>option(key,operators[key],r.op)).join('');
    const values=r.field==='industry'
      ? '<select data-prop="value" aria-label="行业">'+option('','选择行业',r.value)+industries.map(y=>option(y,y,r.value)).join('')+'</select>'
      : '<select data-prop="op" aria-label="选超过还是低于">'+allowed+'</select><input data-prop="value" aria-label="填写条件的数字" type="number" step="any" value="'+esc(r.value??'')+'"><span class="controls-label">'+esc(schema.unit)+'</span>';
    return '<div class="rule" data-rule="'+i+'"><div class="rule-title">'+(r.inferred?badge('推断 · 请确认'):'')+
      '<span class="phrase">'+esc(r.phrase||fieldName(r.field))+'</span></div>' +
      '<div class="rule-controls"><select data-prop="field" aria-label="你想看哪一项">'+fieldOptions+'</select>'+
      (schema.days?'<span class="controls-label">近</span><input data-prop="days" aria-label="想看多少个开市日" type="number" min="2" max="1200" value="'+esc(r.days??'')+'"><span class="controls-label">个开市日</span>':'')+
      values+(r.field!=='industry'?'<input class="threshold-slider" data-prop="threshold" aria-label="拖动调整'+esc(schema.label)+'" type="range" min="'+(['pe','vol'].includes(r.field)?0:-100)+'" max="'+Math.max(r.field==='vol'?10:200,Number(r.value)||0)+'" step="'+(r.field==='vol'?0.1:1)+'" value="'+esc(r.value??0)+'">':'')+'</div><button type="button" class="button quiet rule-remove" data-remove="'+i+'" aria-label="删除条件">×</button></div>';
  }).join('') : '<div class="empty">生成条件后，你可以在这里改看哪一项、看多久和填多少。</div>';
  $('run').disabled=blockedIntent || unresolvedIntent || !rules.length || !dataset;
  $('add-rule').disabled=blockedIntent;
  $('save-rules').disabled=unresolvedIntent||!rules.length;
  $('share-screen').disabled=!rules.length||blockedIntent||unresolvedIntent;
  renderPreview();
}

function runScreen() {
  if (enforceBoundary()) return;
  if(unresolvedIntent){notice('rule-error','还有不支持或未澄清的要求，请改写输入或手动确认条件卡。');return;}
  if (!dataset) return;
  const issue=validateRules(rules);
  notice('rule-error',issue);
  if (issue) return;
  const previous=results;
  const oldIn=new Set(previous.filter(row=>row.status==='in').map(row=>row.stock.code));
  executed=rules.map(rule=>({...rule}));
  results=stocks.filter(s=>s.pool).map(s=>evaluate(s,executed,dataset));
  tab='in';
  const inCodes=new Set(results.filter(r=>r.status==='in').map(r=>r.stock.code));
  const additions=[...inCodes].filter(code=>!oldIn.has(code)).map(code=>byCode(code).name);
  const removals=[...oldIn].filter(code=>!inCodes.has(code)).map(code=>byCode(code).name);
  const sameConditionCount=oldIn.size===0&&inCodes.size===0;
  if (previous.length && (additions.length||removals.length)) {
    $('changes').textContent=[additions.length?'新增 '+additions.join('、'):'',removals.length?'移出 '+removals.join('、'):''].filter(Boolean).join(' · ')+'。点击个股查看每条条件的判断。';
    $('changes').hidden=false;
  } else if (previous.length && !sameConditionCount) {
    $('changes').textContent='这次修改后，符合条件的名单没有变化。';
    $('changes').hidden=false;
  } else $('changes').hidden=true;
  renderResults();
  renderPreview();
}

function renderResults() {
  $('save-monitor').disabled=!results.some(r=>r.status==='in');
  if (blockedIntent) {
    $('result-description').textContent='这次请求未执行筛选，没有生成股票名单。';
    $('result-tabs').innerHTML='';
    $('result-table').innerHTML='<div class="empty">请改成历史数据条件后重新生成。符合历史条件不代表未来必涨或适合买入。</div>';
    return;
  }
  if(unresolvedIntent){$('result-description').textContent='请求有未支持或未澄清的条件，筛选尚未执行。';$('result-tabs').innerHTML='';$('result-table').innerHTML='<div class="empty">请改写输入或手动确认条件卡，不能用部分条件冒充完整结果。</div>';return;}
  if (marketFailure) {
    $('result-description').textContent='扶摇数据未取得，筛选尚未执行。';
    $('result-tabs').innerHTML='';
    $('result-table').innerHTML='<div class="empty">'+esc(marketFailure)+'</div>';
    return;
  }
  const counts=Object.fromEntries(Object.keys(statuses).map(key=>[key,results.filter(row=>row.status===key).length]));
  $('result-description').textContent=results.length ? '本次检查 '+results.length+' 只沪深 300 样本股 · 行情截至 '+dataset.asOf+'（北京时间）' : '确认条件后查看筛选结果。';
  $('result-tabs').innerHTML=Object.keys(statuses).map(key=>'<button type="button" class="tab" data-tab="'+key+'" aria-pressed="'+(key===tab)+'">'+statuses[key]+' <span class="count">'+counts[key]+'</span></button>').join('');
  const rows=results.filter(row=>row.status===tab);
  if (!rows.length) {
    if(tab==='in'&&results.length){$('result-table').innerHTML=emptyExplanation();return;}
    $('result-table').innerHTML='<div class="empty">'+(results.length?'这个分类目前没有股票。':'开始筛选后，结果会显示在这里。')+'</div>';
    return;
  }
  $('result-table').innerHTML='<table><thead><tr><th>股票</th><th>行业</th><th>主要判断依据</th><th>下一步</th></tr></thead><tbody>'+
    rows.map(row=>{
      return '<tr><td><button type="button" class="button link table-stock" data-detail="'+esc(row.stock.code)+'">'+esc(row.stock.name)+'<span class="ticker">'+esc(row.stock.code)+'</span></button></td><td>'+esc(row.stock.industry||'待核验')+'<small class="metric-proof">'+specialStockNotes(row.stock,dataset).map(esc).join('；')+'</small></td><td>'+row.evidence.map(item=>'<div class="metric-line"><span>'+esc(fieldName(item.rule.field))+'：'+esc(fieldValue(item.value,item.rule.field))+' · '+esc(item.pass===null?'不确定 · 待核验：'+showRuleMessage(item):item.pass?'数据事实；按条件判断（推断）：符合':'数据事实；按条件判断（推断）：不符合')+'</span>'+proofLabel(row.stock,item.rule)+'</div>').join('')+'<p class="coverage-tag">'+esc(noticeCoverage(row.stock,ifind,ifindStatus).label)+'</p>'+'</td><td><div class="row-actions"><button class="button outline" type="button" data-compare="'+esc(row.stock.code)+'">对比</button><button class="button quiet" type="button" data-holding="'+esc(row.stock.code)+'">加入组合</button></div></td></tr>';
    }).join('')+'</tbody></table>';
}

function saveRules() {
  if (enforceBoundary()||unresolvedIntent) return;
  const issue=validateRules(rules);
  notice('rule-error',issue);
  if (issue) return;
  try {
    const verified=validateResearchProposal({rules},stocks,dataset);
    localStorage.setItem(storageKey,JSON.stringify({intent:$('intent').value,rules:verified.rules,asOf:dataset.asOf}));
    $('load-saved').disabled=false;
    notify('已保存在这台设备上');
  } catch { notify('浏览器暂时无法保存'); }
}
function loadRules() {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Array.isArray(saved.rules)) return;
    $('intent').value=saved.intent;
    if (enforceBoundary()) return;
    rules=validateResearchProposal({rules:saved.rules},stocks,dataset).rules;
    notice('parse-notice','已打开保存在此浏览器里的条件。');
    notice('rule-error','');
    renderRules();
    runScreen();
  } catch { notice('rule-error','这组保存条件无法验证，未执行。'); }
}

function draw(canvas, series, indexMode=false) {
  const ctx=canvas.getContext('2d');
  const w=Math.max(canvas.clientWidth,260),h=canvas.clientHeight||215,scale=Math.min(window.devicePixelRatio||1,2);
  canvas.width=w*scale; canvas.height=h*scale;
  ctx.scale(scale,scale);
  const padding={left:52,right:18,top:20,bottom:27};
  const x1=padding.left,y1=padding.top,x2=w-padding.right,y2=h-padding.bottom;
  const palette=['#176b50','#455e9d'];
  const nums=series.flatMap(s=>s.values.map(r=>r[1]));
  if (!nums.length) return;
  let min=Math.min(...nums),max=Math.max(...nums);
  const pad=(max-min)*.08 || Math.max(1,max*.01);
  min-=pad;max+=pad;
  const x=(i,n)=>x1+(x2-x1)*i/Math.max(1,n-1);
  const y=n=>y2-(y2-y1)*(n-min)/(max-min);
  ctx.font='11px system-ui';
  ctx.lineWidth=1;
  for (let i=0;i<4;i++) {
    const yy=y1+(y2-y1)*i/3;
    ctx.strokeStyle='#dae7dd';
    ctx.beginPath();ctx.moveTo(x1,yy);ctx.lineTo(x2,yy);ctx.stroke();
    ctx.fillStyle='#526a5c';ctx.fillText((max-(max-min)*i/3).toFixed(indexMode?0:1),8,yy+4);
  }
  series.forEach((s,idx)=>{
    ctx.strokeStyle=palette[idx];ctx.lineWidth=2;ctx.beginPath();
    s.values.forEach((row,i)=>i===0?ctx.moveTo(x(i,s.values.length),y(row[1])):ctx.lineTo(x(i,s.values.length),y(row[1])));
    ctx.stroke();
    if (s.values.length===1) {ctx.fillStyle=palette[idx];ctx.beginPath();ctx.arc(x1,y(s.values[0][1]),3,0,Math.PI*2);ctx.fill();}
  });
  ctx.fillStyle='#526a5c';
  ctx.fillText(series[0].values[0][0],x1,y2+17);
  const end=series[0].values.at(-1)[0];
  ctx.fillText(end,x2-ctx.measureText(end).width,y2+17);
}

function periodButtons(active,group) {
  return '<div class="period-list" aria-label="时间范围">'+Object.entries(periods).map(([id,label])=>
    '<button type="button" data-'+group+'-period="'+id+'" aria-pressed="'+(id===active)+'">'+label+'</button>').join('')+'</div>';
}
function dialogHead(message, title, id) {
  return '<div class="dialog-head"><div><h2>'+esc(title)+'</h2><p>'+esc(message)+'</p></div><button type="button" class="button quiet dialog-close" data-close="'+id+'" aria-label="关闭">×</button></div>';
}
function evidenceTable(stock) {
  if (!executed.length) return '<p class="data-date">完成一次筛选后，可查看每条条件的实际数值。</p>';
  const reviewed=evaluate(stock,executed,dataset);
  return '<div class="table-scroll"><table><thead><tr><th>筛选条件</th><th>数据事实（历史实际值）</th><th>按条件判断（推断）</th><th>依据与日期</th></tr></thead><tbody>'+
    reviewed.evidence.map(e=>'<tr><td>'+esc(ruleText(e.rule))+(fields[e.rule.field].evidenceLabel?'<span class="ticker">'+esc(fields[e.rule.field].evidenceLabel)+'</span>':'')+'</td><td>'+esc(fieldValue(e.value,e.rule.field))+proofLabel(stock,e.rule)+'</td><td>'+esc(e.pass===null?'不确定 · 待核验：'+showRuleMessage(e):e.pass?'符合':'不符合')+'</td><td><a href="'+dataset.refs[fields[e.rule.field].source]+'" target="_blank" rel="noreferrer">扶摇</a> · '+esc(e.date||'时点缺失')+
      (e.raw?'<span class="ticker">'+esc(e.raw)+'</span>':'')+'</td></tr>').join('')+'</tbody></table></div>';
}

function ifindNotices(stock) {
  const rows=ifind?.notices?.[stock.code];
  let explanation;
  if (ifindStatus==='loading') explanation='正在读取公告快照。';
  else if (ifindStatus==='unavailable') explanation=ifindFailure;
  else if (!rows?.length) explanation=ifind?.attempted?.includes(stock.code) ?
    '这只股票本次检索没有获得可核验的公告。' : '这只股票暂未纳入本次 iFinD 公告样本。';
  const content=rows?.length ? '<ul class="notices-list">'+rows.map(row=>
    '<li><time datetime="'+esc(row.date)+'">'+esc(row.date)+'</time><span>'+esc(row.title)+'</span></li>').join('')+'</ul>' :
    '<p class="data-date">'+esc(explanation)+'</p>';
  return '<section class="notice-evidence" aria-label="iFinD 上市公司公告"><h3 class="evidence-title">上市公司公告</h3>'+
    '<p class="data-date"><a href="https://mcp.51ifind.com/" target="_blank" rel="noreferrer">来源：同花顺 iFinD MCP</a>'+
    (rows?.length?' · 检索截至 '+esc(ifind.asOf)+' · 可按标题查原文':'')+'</p>'+content+'</section>';
}

function renderDetail() {
  const stock=byCode(currentDetail);
  if (!stock) return;
  const bars=slicePrices(stock.prices,currentPeriod,dataset.asOf,chosenDays());
  const stats=pathMetrics(bars);
  const evaluated=executed.length?evaluate(stock,executed,dataset):null;
  const main=evaluated?.evidence.find(e=>e.pass===false)??evaluated?.evidence.find(e=>e.pass===null)??evaluated?.evidence[0];
  const expl=main ? (stock.pool?statuses[evaluated.status]+' · ':'本次筛选范围外 · ')+fieldName(main.rule.field)+' '+fieldValue(main.value,main.rule.field)+' · '+showRuleMessage(main):'';
  const dateNote=bars.length?bars[0][0]+' 至 '+bars.at(-1)[0]+' · 来源：扶摇 · 前复权收盘价（元）；涨幅/波动单位 %'+(currentPeriod==='history'?' · 覆盖范围以接口实际返回为准':''):'';
  $('detail-content').innerHTML=dialogHead(stock.code+' · '+(stock.industry||'行业待核验'),stock.name,'detail-dialog')+
    '<div class="dialog-body">'+(expl?'<div class="detail-summary">'+esc(expl)+'</div>':'')+
    periodButtons(currentPeriod,'detail')+(bars.length?'<canvas id="detail-chart" class="chart" role="img" aria-label="所选日期范围内的前复权收盘价格走势"></canvas><p class="data-date">'+esc(dateNote)+'</p>'+
    '<div class="kpis"><div class="kpi"><span>区间涨跌幅</span><b>'+percent(stats.gain,true)+'</b></div><div class="kpi"><span>日收益率波动率</span><b>'+percent(stats.vol)+'</b></div><div class="kpi"><span>收盘价区间</span><b>'+(stats.min===null?'待核验':stats.min.toFixed(2)+'–'+stats.max.toFixed(2))+'</b></div></div>' :
    '<div class="empty">'+(currentPeriod==='today'?'今天的分时数据未接入此预览。可切到本周或其他日线范围。':'这个时间范围暂无可用数据。')+'</div>')+
    '<p class="notice">'+specialStockNotes(stock,dataset).map(esc).join('；')+'</p><h3 class="evidence-title">筛选依据</h3>'+evidenceTable(stock)+ifindNotices(stock)+
    '<div class="bench-head"><button type="button" class="button outline" data-compare="'+esc(stock.code)+'">拿这只股票对比</button><button type="button" class="button primary" data-holding="'+esc(stock.code)+'">加入组合</button></div></div>';
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
  if (bars.length) draw($('detail-chart'),[{values:bars}]);
}

function compareOptions() {
  const entered=$('comparison-search')?.value.toLowerCase().trim()||'';
  const matched=stocks.filter(s=>s.code!==compareA && (!entered||s.name.includes(entered)||s.code.toLowerCase().includes(entered)));
  $('compare-b').innerHTML=option('','选择股票',compareB)+stockOptions(compareB,matched);
}
function comparisonContent() {
  const a=byCode(compareA),b=byCode(compareB);
  if (!a || !b) {
    $('compare-panel').innerHTML='<div class="empty">选择第二只股票后，就能沿用你设的条件做对照。</div>';
    return;
  }
  const ea=evaluate(a,executed,dataset),eb=evaluate(b,executed,dataset);
  const unmatched=eb.evidence.findIndex(e=>e.pass===false);
  const summary=unmatched>=0 ? b.name+'未通过「'+ruleText(eb.evidence[unmatched].rule)+'」。' :
    eb.evidence.some(e=>e.pass===null) ? b.name+'有数据待核验。' : executed.length ? b.name+'符合当前筛选条件。' : '你可以切换时间范围，查看两只股票的历史走势。';
  const ba=slicePrices(a.prices,comparePeriod,dataset.asOf,chosenDays());
  const bb=new Map(slicePrices(b.prices,comparePeriod,dataset.asOf,chosenDays()));
  const common=ba.filter(([d])=>bb.has(d));
  const label=b.pool?'本次样本':'你添加的股票 · 样本外';
  const table=executed.length?'<div class="table-scroll"><table><thead><tr><th>你设的条件</th><th>'+esc(a.name)+'</th><th>'+esc(b.name)+'</th></tr></thead><tbody>'+
    ea.evidence.map((e,i)=>'<tr><td>'+esc(ruleText(e.rule))+'</td>'+[e,eb.evidence[i]].map((item,index)=>'<td>'+esc(fieldValue(item.value,item.rule.field))+' · '+(item.pass===null?'待核验':item.pass?'符合':'未通过')+proofLabel(index===0?a:b,item.rule)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'';
  $('compare-panel').innerHTML='<div class="detail-summary">'+esc(summary+' '+label)+'</div>'+periodButtons(comparePeriod,'compare')+
    (common.length>1?'<canvas id="compare-chart" class="chart" role="img" aria-label="两只股票从相同起点计算的相对走势"></canvas>'+
    '<p class="data-date"><strong style="color:#176b50">'+esc(a.name)+'</strong> · <strong style="color:#455e9d">'+esc(b.name)+'</strong> · 同一起点为 100 · '+esc(common[0][0]+' 至 '+common.at(-1)[0])+'</p>':'<p class="data-date">这个时间范围暂无共同日线数据。</p>')+table;
  if (common.length>1) {
    draw($('compare-chart'),[{values:common.map(([d,v])=>[d,v/common[0][1]*100])},{values:common.map(([d])=>[d,bb.get(d)/bb.get(common[0][0])*100])}],true);
  }
}

function renderCompare() {
  if (!compareA) compareA=results.find(row=>row.status==='in')?.stock.code??stocks[0]?.code??'';
  if (compareB===compareA) compareB='';
  $('compare-content').innerHTML=dialogHead('用相同的日期范围和筛选条件并排看。','股票对比','compare-dialog')+
    '<div class="dialog-body"><div class="compare-controls"><div><label for="compare-a">对比中的股票</label><select id="compare-a">'+stockOptions(compareA)+'</select></div>'+
    '<div><label for="comparison-search">你关注的股票</label><input id="comparison-search" type="search" placeholder="搜股票名称或代码"><select id="compare-b" aria-label="选择关注的股票"></select></div></div><div id="compare-panel"></div></div>';
  compareOptions();
  if (!$('compare-dialog').open) $('compare-dialog').showModal();
  comparisonContent();
}

function renderPortfolio() {
  const selected=[...holdings.keys()].map(byCode).filter(Boolean);
  const weights=selected.map(stock=>holdings.get(stock.code));
  const previous=$('portfolio-stock').value;
  $('portfolio-stock').innerHTML=option('','选择要加入的股票',previous)+stockOptions(previous,stocks.filter(s=>!holdings.has(s.code)));
  if (!selected.length) {
    $('portfolio-body').innerHTML='<div class="empty">加入一只股票后，这里会显示行业集中情况，自动列出可以尝试加入的分散候选。</div>';
    return;
  }
  const exposures=new Map();
  selected.forEach((stock,index)=>{
    const sector=stock.sector||'行业待核验';
    exposures.set(sector,(exposures.get(sector)||0)+weights[index]);
  });
  const sectorSummary=[...exposures].sort((a,b)=>b[1]-a[1]).map(([sector,weight])=>sector+' '+(weight*100).toFixed(0)+'%').join('、');
  const coverageNote='当前行业分布：'+sectorSummary+'。';
  const aligned=alignedReturns(selected,dataset.asOf);
  const base=aligned?portfolioMetrics(aligned.returns,weights):null;
  const candidates=aligned?diversification(selected,stocks,dataset.asOf,weights,allocation/100,objective,ceiling):[];
  const pill=selected.map(s=>'<span class="holding">'+esc(s.name)+' '+(100*holdings.get(s.code)).toFixed(Number.isInteger(100*holdings.get(s.code))?0:1)+'%<button type="button" data-drop="'+esc(s.code)+'" aria-label="移出 '+esc(s.name)+'">×</button></span>').join('');
  $('portfolio-body').innerHTML='<div class="port-holdings">'+pill+'</div><div class="bench-head"><div><h3>当前模拟组合</h3><p>'+esc(coverageNote)+'</p></div></div>'+
    (base?'<div class="kpis"><div class="kpi"><span>历史累计收益</span><b>'+percent(base.gain,true)+'</b></div><div class="kpi"><span>历史年化波动率</span><b>'+percent(base.vol)+'</b></div><div class="kpi"><span>历史最大回撤</span><b>'+percent(base.drawdown)+'</b></div></div>'+
    '<p class="data-date">'+esc(aligned.dates[0]+' 至 '+aligned.dates.at(-1))+' · '+aligned.returnDates.length+' 个日收益观察值 · 每日按设定权重再平衡，不计费用</p>' :
    '<div class="notice">缺少足量的共同复权日线，组合历史表现暂待核验。</div>')+
    '<div class="bench-head"><div><h3>看看怎么分散风险</h3><p>给新股票一部分权重，其余权重按原比例缩减，比较同一时段的数据。</p></div></div>'+
    '<div class="controls-inline"><label for="port-objective">目标</label><select id="port-objective">'+option('risk','优先降低波动',objective)+option('return','在波动上限内看收益',objective)+'</select>'+
    '<label for="port-allocation">试加入比例</label><select id="port-allocation">'+[10,15,20,25,30].map(x=>option(x,x+'%',allocation)).join('')+'</select>'+
    (objective==='return'?'<label for="port-ceiling">年化波动上限</label><select id="port-ceiling">'+[10,15,20,25,30,40,50,60].map(x=>option(x,x+'%',ceiling)).join('')+'</select>':'')+'</div>'+
    (candidates.length?'<div class="candidate-list">'+candidates.map(c=>{
      const note=c.outsider?'能增加一个行业组':'和现有持仓属于同一行业组';
      const delta=c.after.vol-c.before.vol;
      return '<article class="candidate"><h4>'+esc(c.stock.name)+' <span class="secondary">'+esc(c.stock.sector||c.stock.industry||'行业待核验')+'</span></h4>'+
        '<p>'+esc(note)+(isNumber(c.correlation)?' · 与当前组合的历史相关性 '+c.correlation.toFixed(2):'')+'</p>'+
        '<p>年化波动 <b class="'+(delta<=0?'pos':'neg')+'">'+percent(c.before.vol)+' → '+percent(c.after.vol)+'</b><br>累计收益 '+percent(c.before.gain,true)+' → '+percent(c.after.gain,true)+'<br>最大回撤 '+percent(c.before.drawdown)+' → '+percent(c.after.drawdown)+'</p>'+
        '<small class="metric-proof">来源：扶摇前复权日线 · '+esc(c.dates[0]+' 至 '+c.dates.at(-1))+' · 上述百分比单位 %；相关性无量纲</small><button type="button" class="button outline" data-holding="'+esc(c.stock.code)+'" data-candidate="true">加入组合试试</button></article>';
    }).join('')+'</div>':'<div class="empty">'+(aligned?'样本里暂无满足这个目标、且数据足够的候选。':'先补齐共同日线再计算候选。')+'</div>')+
    '<p class="port-note"><strong>历史情境模拟（推断）</strong>：候选按这段历史样本计算，不代表未来收益更高或风险一定更低，不是买卖建议。直接加入股票会按等权分配。通过候选卡加入时，会用卡片上显示的试加入比例。</p>';
}

function addHolding(code, simulatedAllocation=null) {
  if (!byCode(code)) {notify('请先选择一只股票');return;}
  if (holdings.has(code)) {notify('这只股票已经在组合里');return;}
  if (simulatedAllocation!==null && holdings.size) {
    for (const [held,weight] of holdings) holdings.set(held,weight*(1-simulatedAllocation));
    holdings.set(code,simulatedAllocation);
  } else {
    const newWeight=1/(holdings.size+1);
    holdings.set(code,newWeight);
    for (const held of holdings.keys()) holdings.set(held,newWeight);
  }
  renderPortfolio();
  notify(byCode(code).name+'已加入组合');
}

function proofLabel(stock,rule) {
  const p=provenance(stock,rule,dataset);
  return '<small class="metric-proof">来源：<a href="'+esc(p.url)+'" target="_blank" rel="noreferrer">扶摇</a> · 时点：'+esc(p.period)+' · 单位：'+esc(p.unit)+'<br>'+esc(p.formula)+(p.freshness.status==='stale'||p.freshness.status==='unknown'||p.freshness.status==='invalid'?' · '+esc(p.freshness.label):'')+'</small>';
}
function renderCoverage() {
 if(!dataset)return;
 const pool=stocks.filter(s=>s.pool),covered=pool.filter(s=>noticeCoverage(s,ifind,ifindStatus).state==='covered').length;
 $('coverage-summary').textContent='公告历史样本覆盖 '+covered+' / '+pool.length+' 只；其余逐只标注，非实时、非全量覆盖。';
 $('coverage-body').innerHTML='<div class="coverage-grid">'+pool.map(s=>'<p><strong>'+esc(s.name)+'</strong><span>'+esc(noticeCoverage(s,ifind,ifindStatus).label)+'</span></p>').join('')+'</div>';
 const fresh=freshness(dataset.asOf);
 notice('freshness-notice','当前是历史快照：行情截至 '+dataset.asOf+'，估值截至 '+(dataset.valuationAsOf??'未记录')+'，不是实时数据。'+fresh.label+'。ST、停牌和上市日期元数据未完整取得，不能据此认定已排除特殊股；缺口逐只列出。');
}
function renderPreview() {
 if(!dataset||blockedIntent||!executed.length){$('live-impact').hidden=true;return;}
 $('live-impact').hidden=false;
 const issue=validateRules(rules);
 if(issue){$('live-impact').textContent='预览未执行：'+issue;return;}
 const changed=JSON.stringify(rules.map(({field,op,value,days})=>({field,op,value,days})))!==JSON.stringify(executed.map(({field,op,value,days})=>({field,op,value,days})));
 const diff=compareScreen(stocks,executed,rules,dataset),names=codes=>codes.length?codes.map(c=>byCode(c)?.name??c).join('、'):'无';
 $('live-impact').innerHTML='<strong>实时预览 · 尚未替换已确认结果</strong><p>新增 '+diff.added.length+' 只：'+esc(names(diff.added))+'</p><p>移出 '+diff.removed.length+' 只：'+esc(names(diff.removed))+'</p><p>待核验 '+diff.uncertain.length+' 只：'+esc(names(diff.uncertain))+'</p><details><summary>预览符合名单（'+diff.results.filter(r=>r.status==='in').length+' 只）</summary><p>'+esc(names(diff.results.filter(r=>r.status==='in').map(r=>r.stock.code)))+'</p></details><small>基于同一份 '+esc(dataset.asOf)+' 历史样本。点「开始筛选」确认当前条件。</small>';
 if(changed){$('save-monitor').disabled=true;$('result-description').textContent='下方是上一次已确认结果；上方实时预览显示这次改动。点「开始筛选」确认。';}
 else $('save-monitor').disabled=!results.some(r=>r.status==='in');
}
function emptyExplanation() {
 const advice=explainEmpty(stocks,executed,dataset),unknown=results.filter(r=>r.status==='unknown').length;
 return '<div class="empty"><strong>当前没有符合全部条件的候选。</strong><p>'+ (unknown?'另有 '+unknown+' 只数据待核验；补数据才能确认，放宽阈值不能代替缺失数据。':'每条条件都参与检查，没有静默丢掉股票。')+'</p></div><div class="empty-advice">'+advice.map(a=>'<p>'+esc(fieldName(a.rule.field))+'：'+a.failed+' 只不符合，'+a.missing+' 只缺数据。'+(a.proposed?'<button type="button" class="button quiet" data-relax="'+a.index+'">预览改为 '+esc(operators[a.proposed.op]+' '+a.proposed.value+' '+(fields[a.rule.field].unit??''))+'（可有 '+a.count+' 只）</button>':'请先检查数据口径，或手动修改这条条件。')+'</p>').join('')+'</div>';
}
function restoreScreen() {
 try {
  const shared=readSharedScreen(location.hash);
  const saved=shared??JSON.parse(localStorage.getItem(storageKey)||'null');
  if(!saved)return false;
  if(!shared&&saved.intent&&assessIntentBoundary(saved.intent).blocked)throw new Error('保存的文字含不支持的投资请求');
  const verified=validateResearchProposal({rules:saved.rules},stocks,dataset);
  rules=verified.rules;$('intent').value=shared?'':saved.intent??'';
  notice('parse-notice',shared?'已载入分享条件；按当前快照重算，不沿用链接里的股票或数字。':'已恢复本浏览器保存的条件，按当前快照重新计算。');
  renderRules();runScreen();return true;
 }catch(e){rules=[];executed=[];results=[];renderRules();renderResults();notice('rule-error','保存或分享条件未执行：'+e.message);return true;}
}

$('use-example').addEventListener('click',()=>{$('intent').value=example;$('intent').focus()});
$('intent').addEventListener('input',()=>{if(assessIntentBoundary($('intent').value).blocked)enforceBoundary();});
$('generate').addEventListener('click',async()=>{
 if($('parse-engine').value!=='ai'){generate();return;}
 if(enforceBoundary())return;
 const text=$('intent').value;const context=rules.length?rules:executed;
 $('generate').disabled=true;$('ai-status').textContent='正在请AI理解你的意思…';
 try{
  const r=await fetch('/api/ai/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,context})});const value=await r.json();
  if(text!==$('intent').value)return;
  if(!r.ok||value.error)throw Error(value.error??'AI理解未成功');
  rules=value.rules;unresolvedIntent=value.needsClarification;executed=[];results=[];
  notice('parse-notice',(value.questions??[]).join(' ')+(value.inferred?' AI提出的默认条件需要你确认。':''));notice('rule-error','');renderRules();renderResults();
  $('ai-status').textContent=value.engine==='openai'?'已由 '+value.modelUsed+' 理解；条件需你确认，数值由筛选程序计算。':'合规边界已拦截，未请求模型。';
 }catch(e){unresolvedIntent=true;executed=[];results=[];rules=[];renderRules();renderResults();notice('rule-error',e.message);$('ai-status').textContent='AI条件未采用；可以手动切换规则解析。';}
 finally{$('generate').disabled=false;}
});
fetch('/api/ai/status').then(r=>r.json()).then(v=>{$('ai-status').textContent=v.configured?'已连接 gpt-5.4-mini；可切换AI理解。':'gpt-5.4-mini 尚未配置密钥，当前使用免费规则解析。';if(v.configured)$('parse-engine').value='ai';}).catch(()=>{$('ai-status').textContent='AI连接状态未取得，当前使用免费规则解析。';});
$('add-rule').addEventListener('click',()=>{if(enforceBoundary())return;rules.push(makeRule('gain'));renderRules();notice('rule-error','')});
$('run').addEventListener('click',()=>{runScreen();if ($('rule-error').hidden) $('results').scrollIntoView({behavior:'smooth'})});
$('save-rules').addEventListener('click',saveRules);
$('load-saved').addEventListener('click',loadRules);
$('open-compare').addEventListener('click',()=>{compareA='';compareB='';comparePeriod='screen';renderCompare()});
$('add-holding').addEventListener('click',()=>addHolding($('portfolio-stock').value));
$('rules').addEventListener('click',event=>{
  const element=event.target.closest('[data-remove]');
  if (element) {rules.splice(Number(element.dataset.remove),1);renderRules();notice('rule-error','')}
});
$('rules').addEventListener('input',event=>{
 const prop=event.target.dataset.prop;if(!['threshold','value','days'].includes(prop)||event.target.tagName==='SELECT')return;
 if(unresolvedIntent){unresolvedIntent=false;notice('parse-notice','已采用你手动修改的条件卡，运行时以卡片为准。');$('run').disabled=false;$('save-rules').disabled=false;$('share-screen').disabled=false;}
 const container=event.target.closest('[data-rule]'),r=rules[Number(container.dataset.rule)];if(!r||r.field==='industry')return;
 const key=prop==='threshold'?'value':prop;r[key]=event.target.value===''?null:Number(event.target.value);r.inferred=false;
 if(prop==='threshold')container.querySelector('[data-prop="value"]').value=event.target.value;
 if(prop==='value')container.querySelector('[data-prop="threshold"]').value=event.target.value;
 renderPreview();
});
$('rules').addEventListener('change',event=>{
  let prop=event.target.dataset.prop;
  if(prop==='threshold')prop='value';
  if (!prop) return;
  if(unresolvedIntent){unresolvedIntent=false;notice('parse-notice','已采用你手动修改的条件卡，运行时以卡片为准。');}
  const index=Number(event.target.closest('[data-rule]').dataset.rule);
  const rule=rules[index];
  if (prop==='field') {rules[index]=makeRule(event.target.value);renderRules();}
  else {
    rule[prop]=(prop==='days'||(prop==='value'&&rule.field!=='industry')) ? (event.target.value===''?null:Number(event.target.value)) : event.target.value;
    rule.inferred=false;
    const label=event.target.closest('[data-rule]').querySelector('.pill');
    if (label) label.remove();
  }
  notice('rule-error','');
  renderRules();renderPreview();
});
$('compare-dialog').addEventListener('input',event=>{
  if (event.target.id!=='comparison-search') return;
  compareOptions();
  const options=[...$('compare-b').options].filter(item=>item.value);
  if (options.length===1) {compareB=options[0].value;$('compare-b').value=compareB;comparisonContent();}
  else if (!$('compare-b').value && compareB) {compareB='';comparisonContent();}
});
$('compare-dialog').addEventListener('change',event=>{
  if (event.target.id==='compare-a') {
    compareA=event.target.value;
    if (compareB===compareA) compareB='';
    compareOptions();
    comparisonContent();
  }
  if (event.target.id==='compare-b') {compareB=event.target.value;comparisonContent();}
});
$('portfolio-body').addEventListener('change',event=>{
  if (event.target.id==='port-objective') objective=event.target.value;
  if (event.target.id==='port-allocation') allocation=Number(event.target.value);
  if (event.target.id==='port-ceiling') ceiling=Number(event.target.value);
  renderPortfolio();
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if (!button) return;
  const d=button.dataset;
  if(d.relax!==undefined){const a=explainEmpty(stocks,executed,dataset).find(a=>a.index===Number(d.relax));if(a?.proposed){rules=executed.map((r,i)=>i===a.index?a.proposed:{...r});renderRules();renderPreview();$('conditions').scrollIntoView({behavior:'smooth'});}}
  if (d.tab) {tab=d.tab;renderResults();}
  if (d.detail) {currentDetail=d.detail;currentPeriod='screen';renderDetail();}
  if (d.compare) {
    if ($('detail-dialog').open) $('detail-dialog').close();
    compareA=d.compare;compareB='';comparePeriod='screen';renderCompare();
  }
  if (d.close) $(d.close).close();
  if (d.detailPeriod) {currentPeriod=d.detailPeriod;renderDetail();}
  if (d.comparePeriod) {comparePeriod=d.comparePeriod;comparisonContent();}
  if (d.holding) addHolding(d.holding,d.candidate==='true'?allocation/100:null);
  if (d.drop) {
    const weight=holdings.get(d.drop);
    holdings.delete(d.drop);
    for (const [code,remaining] of holdings) holdings.set(code,remaining/(1-weight));
    renderPortfolio();
  }
});
let resizeTimer;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if ($('detail-dialog').open) renderDetail();
    if ($('compare-dialog').open) comparisonContent();
  },100);
});

(async function loadNotices() {
  try {
    ifind=await readSnapshot('./ifind-notices.json',validNoticeSnapshot);
    ifindStatus='ready';
    $('ifind-status').textContent='iFinD 公告覆盖 '+Object.keys(ifind.notices).length+' 只样本股。';
  } catch (error) {
    ifind=null;
    ifindStatus='unavailable';
    ifindFailure=sourceFailureText('ifind',error);
    $('ifind-status').textContent='iFinD 公告没拿到。';
    notice('ifind-notice',ifindFailure);
  }
  renderCoverage();
  if(results.length){renderResults();renderPreview();}
  if ($('detail-dialog').open) renderDetail();
})();

(async function loadData() {
  try {
    const snapshot=await readSnapshot('./market-data.json',validMarketSnapshot);
    dataset=snapshot;
    stocks=dataset.stocks;
    dataset.tradingDays=[...new Set(stocks.flatMap(s=>s.prices.map(b=>b[0])))].sort();
    industries=[...new Set(stocks.flatMap(s=>[s.sector,...s.industry.split(', ')].filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    $('sample-label').textContent='沪深 300 · '+stocks.filter(s=>s.pool).length+' 只样本';
    $('sample-sectors').textContent=Object.entries(dataset.sectors??{}).map(([group,count])=>group+' '+count+' 只').join(' · ');
    $('side-date').textContent='日线截至 '+dataset.asOf;
    try { $('load-saved').disabled=!localStorage.getItem(storageKey); } catch {}
    if(!restoreScreen()){generate(false);runScreen();}
    renderCoverage();
    renderPortfolio();
    $('open-compare').disabled=false;
    $('add-holding').disabled=false;
  } catch (error) {
    dataset=null;
    stocks=[];
    results=[];
    executed=[];
    holdings.clear();
    marketFailure=sourceFailureText('fuyao',error);
    notice('data-notice',marketFailure);
    $('changes').hidden=true;
    $('sample-label').textContent='股票数据待取得';
    $('sample-sectors').textContent='';
    $('portfolio-body').textContent=marketFailure;
    $('side-date').textContent='数据源待核验';
    $('open-compare').disabled=true;
    $('add-holding').disabled=true;
    renderRules();
    renderResults();
  }
})();

initMonitoring(()=>({rules:executed,codes:results.filter(r=>r.status==='in').map(r=>r.stock.code),dataset}));

$('share-screen').addEventListener('click',async()=>{
 if(enforceBoundary()||unresolvedIntent)return;
 try{const url=shareScreen(rules,location.href,dataset.asOf);$('share-link').value=url;$('share-link-box').hidden=false;try{await navigator.clipboard.writeText(url);notify('条件链接已复制');}catch{notify('链接已生成，可在下方复制');}}
 catch(e){notice('rule-error',e.message);}
});

function renderPaper(){
 const box=$('paper-result');let saved;try{saved=JSON.parse(localStorage.getItem('stock-lens-paper-v1')??'null');}catch{box.textContent='模拟盘记录损坏，请重置后再建立。';return;}
 if(!saved){box.textContent='尚未建立模拟盘。先在上方加入股票，再分配模拟资金。';return;}
 if(!dataset)return;
 const rows=saved.positions.map(p=>{const s=byCode(p.code);const price=s?.prices.at(-1);const valid=price?.[0]===dataset.asOf;return {...p,name:s?.name??p.code,value:valid?p.shares*price[1]:null,date:price?.[0]};});
 const complete=rows.every(p=>p.value!==null);const total=complete?rows.reduce((a,b)=>a+b.value,0)+saved.cash:null;
 box.innerHTML='<p>建立时点：'+esc(saved.asOf)+'；最新可用快照：'+esc(dataset.asOf)+'。本模拟允许碎股，不计费用、分红或利息。</p><p>初始模拟资金 '+saved.capital.toFixed(2)+' 元；现金 '+saved.cash.toFixed(2)+' 元；'+(complete?'快照总值 '+total.toFixed(2)+' 元；模拟盈亏 '+(total-saved.capital).toFixed(2)+' 元':'部分估值缺失，不能给出总值或盈亏')+'</p><ul>'+rows.map(p=>'<li>'+esc(p.name)+'：模拟 '+p.shares.toFixed(4)+' 股；'+(p.value===null?'行情缺失 · 待核验':p.value.toFixed(2)+' 元，时点 '+esc(p.date))+'</li>').join('')+'</ul>';
}
$('paper-open').addEventListener('click',()=>{
 if(!dataset||!holdings.size){notify('先加入至少一只股票');return;}
 const capital=Number($('paper-capital').value);if(!Number.isFinite(capital)||capital<1000||capital>10000000){notify('模拟资金请填1000至10000000元');return;}
 const positions=[];let used=0;for(const [code,weight] of holdings){const s=byCode(code),p=s?.prices.at(-1);if(!p||p[0]!==dataset.asOf||p[1]<=0){notify('行情缺失，模拟盘没有建立');return;}positions.push({code,shares:capital*weight/p[1],entry:p[1],weight});used+=capital*weight;}
 localStorage.setItem('stock-lens-paper-v1',JSON.stringify({version:1,asOf:dataset.asOf,capital,cash:Math.max(0,capital-used),positions}));renderPaper();
});
$('paper-reset').addEventListener('click',()=>{localStorage.removeItem('stock-lens-paper-v1');renderPaper();});
setTimeout(renderPaper,1500);
