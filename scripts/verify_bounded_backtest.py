"""Independent Python check of fixed-share NAV. No API or JS function calls."""
import json,pathlib,statistics,math,sys
private=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);inputs=json.loads((private/'normalized-input.json').read_text());result=json.loads((output/'result.json').read_text());screen=json.loads((output/'screen.json').read_text());states=[]
for code in screen['selectedCodes']:
 s=next(x for x in inputs['stocks'] if x['code']==code);q=(1/len(screen['selectedCodes']))/(s['holdBars'][0]['open']*1.0005*1.0005);cash=0;nav=[]
 for i,b in enumerate(s['holdBars']):
  if i:
   for e in s['events']:
    if e['date']==b['date']:cash+=q*e['cash'];q*=1+e['bonus']
  nav.append(q*b['close']*(.9995*.999 if i==len(s['holdBars'])-1 else 1)+cash)
 states.append(nav)
daily=[sum(x[i] for x in states) for i in range(len(inputs['holdingDates']))];err=max(abs(x-y['nav']) for x,y in zip(daily,result['daily']));returns=[b/a-1 for a,b in zip(daily,daily[1:])];vol=statistics.stdev(returns)*math.sqrt(252)*100;peak=1;dd=0
for value in daily:peak=max(peak,value);dd=max(dd,1-value/peak)
actual=[(daily[-1]-1)*100,vol,dd*100];expected=[result['metrics'][k] for k in ['returnPct','annualizedVolatilityPct','maxDrawdownPct']]
assert err<1e-12 and all(abs(a-b)<1e-10 for a,b in zip(actual,expected))
print(json.dumps({'status':'PASS','maxNavAbsoluteDifference':err,'returnPct':actual[0],'annualizedVolatilityPct':actual[1],'maxDrawdownPct':actual[2]}))
