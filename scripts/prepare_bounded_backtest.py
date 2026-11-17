"""Normalize private provider evidence without calling APIs or reading secrets.
Usage: python3 scripts/prepare_bounded_backtest.py PRIVATE_EVIDENCE_DIR
Original financial amounts must have been checked against the attached pre-cutoff PDFs.
"""
import datetime as dt,json,pathlib,re,sys
p=pathlib.Path(sys.argv[1]);china=dt.timezone(dt.timedelta(hours=8))
def date(ms):return dt.datetime.fromtimestamp(ms/1000,china).date().isoformat()
def bars(rows):return [{'date':date(x['date_ms']),'open':float(x['open_price']),'close':float(x['close_price']),'high':float(x['high_price']),'low':float(x['low_price']),'volume':float(x['volume'])} for x in rows]
pool=json.loads((p/'pool.json').read_text());financials=json.loads((p/'financials-normalized.json').read_text())
stocks={s['code']:{'code':s['code'],'name':s['name'],'listingDate':pool['metadata'][s['code']]['list_date'],'screenBars':[],'holdBars':[],'events':[],'actionsState':'missing','financial':financials.get(s['code'])} for s in pool['eligible']}
for f in sorted(p.glob('screen-prices-*.json')):
 if '.meta.' in f.name:continue
 r=json.loads(f.read_text())
 if r.get('code')!=0:continue
 for x in r['data']['item']:
  if x['thscode'] in stocks:stocks[x['thscode']].update(screenBars=bars(x['item']),screenPriceSource={'file':f.name,'requestId':r['request_id'],'adjust':'none'})
# Do not let an invalid later response overwrite verified historical parameters.
pefiles=list(p.glob('pe-*.json'))+list(p.glob('pe-single-*.json'))
for f in sorted(set(pefiles)):
 if '.meta.' in f.name:continue
 d=json.loads(f.read_text())
 try:d=json.loads(d['content'][0]['text']);data=d['data'];params=data['indicators_params']['市盈率(PE,TTM)']
 except (KeyError,IndexError,ValueError):continue
 if params.get('交易日期')!='20250801' or params.get('TTM基准日')!='报表公告日期':continue
 for line in data['answer'].replace('\\n','\n').splitlines():
  cells=line.strip('|').split('|');c=cells[0].strip()
  if c not in stocks:continue
  try:pe=float(cells[-1])
  except ValueError:continue
  stocks[c].update(pe=pe,peDate='2025-08-01',peParamDate='20250801',peSource={'provider':'iFinD','file':f.name,'params':params})
# A full successful event history confirms an empty interval; code=3002 alone is never enough.
for c,s in stocks.items():
 for name in ['actions-full-'+c,'actions-'+c]:
  f=p/(name+'.json')
  if not f.exists():continue
  r=json.loads(f.read_text())
  if r.get('code')!=0:continue
  s.update(actionsState='verified',actionsSource={'file':f.name,'requestId':r['request_id']},events=[{'date':date(x['ex_date_ms']),'cash':float(x['dividend_per_share']),'bonus':float(x['per_share_bonus'])} for x in r['data']['item'] if '2025-07-01'<=date(x['ex_date_ms'])<='2025-11-18']);break
for f in p.glob('hold-prices-*.json'):
 if '.meta.' in f.name:continue
 r=json.loads(f.read_text())
 if r.get('code')!=0:continue
 for x in r['data']['item']:
  if x['thscode'] in stocks:stocks[x['thscode']].update(holdBars=bars(x['item']),holdSource={'file':f.name,'requestId':r['request_id'],'adjust':'none'})
cal=json.loads((p/'screen-calendar.json').read_text());screenDates=[date(x['date_ms']) for x in cal['data']['item']]
holdDates=[x['date'] for x in json.loads((p/'holding-calendar-normalized.json').read_text())]
# A separately verified historical PE from the strict audit may be reused unchanged.
f=p/'historical-pe-refined-direct.json'
if f.exists():
 d=json.loads(json.loads(f.read_text())['content'][0]['text'])['data'];params=d['indicators_params']['市盈率(PE,TTM)']
 if params['交易日期']=='20250801':
  for line in d['answer'].replace('\\n','\n').splitlines():
   a=line.strip('|').split('|')
   if a[0]=='600519.SH':stocks[a[0]].update(pe=float(a[-1]),peDate='2025-08-01',peParamDate='20250801',peSource={'provider':'iFinD','file':f.name,'params':params})
annuals=json.loads((p/'annuals-normalized.json').read_text());share_counts={}
for f in sorted(list(p.glob('total-shares-*.json'))+list(p.glob('shares-single-*.json'))):
 if '.meta.' in f.name:continue
 try:data=json.loads(json.loads(f.read_text())['content'][0]['text'])['data'];params=data['indicators_params']['总股本']
 except (KeyError,ValueError,IndexError):continue
 if params.get('截止日期')!='20250801':continue
 for line in data['answer'].replace('\\n','\n').splitlines():
  cells=line.strip('|').split('|')
  if not re.fullmatch(r'\d{6}\.(SH|SZ)',cells[0]):continue
  raw=cells[-1].strip();m=re.fullmatch(r'([\d.,]+)(亿|万)?',raw)
  if not m:continue
  scale={None:1,'亿':1e8,'万':1e4}[m[2]];v=m[1].replace(',','');q=scale*10**(-len(v.split('.')[1]) if '.' in v else 0)
  share_counts[cells[0]]={'value':float(v)*scale,'quantum':q,'date':'2025-08-01','paramDate':'20250801','unit':'股','rawText':raw,'file':f.name,'params':params}
for c,s in stocks.items():
 s['vendorPe']=s.pop('pe',None);s.pop('peDate',None);s.pop('peParamDate',None);s['annual']=annuals.get(c);s['shareCount']=share_counts.get(c)
 if s['annual']:s['annual']['currency']='CNY'
out={'signalDate':'2025-08-01','universe':'current-60-listed-before-cutoff','screenDates':screenDates,'holdingDates':holdDates,'stocks':list(stocks.values()),'excludedAfterCutoff':[{'code':s['code'],'name':s['name'],'listingDate':pool['metadata'][s['code']]['list_date']} for s in pool['all'] if s['code'] not in stocks]}
(p/'normalized-input.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps({'stocks':len(stocks),'missingShareCounts':[c for c,s in stocks.items() if not s.get('shareCount')],'missingActions':[c for c,s in stocks.items() if s['actionsState']!='verified'],'missingHolding':[c for c,s in stocks.items() if not s['holdBars']]},ensure_ascii=False))
