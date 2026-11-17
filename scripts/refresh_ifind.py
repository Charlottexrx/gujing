"""Build the iFinD notice metadata used by stock detail. Keep raw excerpts private."""
import argparse
import datetime as dt
import json
import re
import time
from pathlib import Path

from ifind_client import call, start

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = {'000858.SZ':'五粮液','600519.SH':'贵州茅台','300750.SZ':'宁德时代',
          '600036.SH':'招商银行','600276.SH':'恒瑞医药','600900.SH':'长江电力',
          '002415.SZ':'海康威视','000333.SZ':'美的集团'}

def select_notice(result, issuer, begin, end):
    selected = {}
    for entry in result.get('content', []):
        try:
            wrapper = json.loads(entry.get('text', ''))
            payload = wrapper.get('data')
            rows = json.loads(payload) if isinstance(payload, str) else payload
        except (AttributeError, ValueError):
            continue
        if wrapper.get('code') != 1 or not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            title, date = row.get('公告标题'), row.get('日期')
            if not isinstance(title, str) or issuer not in title:
                continue
            if not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date) or not begin <= date <= end:
                continue
            title = title.strip()
            selected[(title, date)] = {'title':title,'date':date}
    return sorted(selected.values(),key=lambda x:x['date'],reverse=True)[:3]

def fetch_notices(begin, end):
    session = start('news')
    data = {}
    for code, issuer in SAMPLE.items():
        try:
            data[code] = call('news',session,'search_notice',{
                'query':issuer+' '+code+' 2026年第三季度报告',
                'time_start':begin,'time_end':end,'size':3,
            })
        except RuntimeError as error:
            print(code, str(error), flush=True)
        time.sleep(.6)
    return data

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw',type=Path,help='Use an existing private MCP response for offline review.')
    options = parser.parse_args()
    market = json.loads((ROOT/'dist/market-data.json').read_text(encoding='utf-8'))
    end = market['asOf']
    begin = (dt.date.fromisoformat(end)-dt.timedelta(days=46)).isoformat()
    data = json.loads(options.raw.read_text(encoding='utf-8')) if options.raw else fetch_notices(begin, end)
    by_code = {code:select_notice(result,SAMPLE[code],begin,end) for code,result in data.items() if code in SAMPLE}
    verified = {code:rows for code,rows in by_code.items() if rows}
    if not verified:
        raise RuntimeError('iFinD did not return any issuer-verified notice metadata')
    package = {'source':'iFinD MCP 公告检索','sourceUrl':'https://mcp.51ifind.com/',
               'from':begin,'asOf':end,'notices':verified,'attempted':list(SAMPLE)}
    destination = ROOT/'dist/ifind-notices.json'
    pending = destination.with_suffix('.json.tmp')
    pending.write_text(json.dumps(package,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    pending.replace(destination)
    print('iFinD verified issuers:',len(verified),'notices:',sum(map(len,verified.values())))
    print('Issuer codes:',', '.join(verified))

if __name__ == '__main__':
    main()
