"""Build a six-sector, 60-stock CSI 300 sample from verified index membership."""
import concurrent.futures
import datetime as dt
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

BASE = 'https://fuyao.aicubes.cn'
CHINA = ZoneInfo('Asia/Shanghai')
CUTOFF = dt.date.fromisoformat(os.getenv('MARKET_DATA_CUTOFF', '2026-11-16'))
STOCKS = {
    '600519.SH': '贵州茅台', '000858.SZ': '五粮液', '300750.SZ': '宁德时代',
    '600036.SH': '招商银行', '600276.SH': '恒瑞医药', '600900.SH': '长江电力',
    '002415.SZ': '海康威视', '000333.SZ': '美的集团',
    '601318.SH': '中国平安', '601012.SH': '隆基绿能',
}
COMPARE_ONLY = {'601318.SH', '601012.SH'}
SECTORS = {
    '消费': r'白酒|家电|食品|饮料|乳品|服装|家居|零售|养殖|旅游|酒店|免税|啤酒|农产品',
    '金融': r'银行|保险|证券|金融|期货',
    '医药': r'制药|药店|中药|生物制品|医疗|医药',
    '新能源与汽车': r'电池|光伏|风电|汽车|电机|电动车',
    '科技': r'计算机|半导体|消费电子|元件|通信|软件|IT服务|光学|电子|传媒|游戏',
    '公用事业与资源': r'电力|煤炭|油气|石油|化工|钢铁|有色|金属|水泥|燃气|公用',
}

def batches(items, size):
    for start in range(0, len(items), size):
        yield items[start:start+size]

def match_sector(labels):
    for sector, pattern in SECTORS.items():
        if any(re.search(pattern, label) for label in labels):
            return sector
    return None

def date(value):
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return dt.datetime.fromtimestamp(value / 1000, CHINA).date().isoformat()

def fetch(job):
    label, endpoint, args = job
    address = BASE + endpoint + '?' + urlencode(args)
    for attempt in range(2):
        try:
            request = Request(address, headers={'X-api-key': os.environ['FUYAO_API_KEY']})
            with urlopen(request, timeout=12) as response:
                result = json.load(response)
            if result.get('code') == 0:
                return label, result.get('data') or {}, result.get('request_id')
            print(label, 'API code', result.get('code'), flush=True)
            return label, {}, None
        except (OSError, ValueError) as error:
            if attempt == 1:
                print(label, type(error).__name__, flush=True)
    return label, {}, None

def run():
    _, universe, _ = fetch(('index', '/api/a-share-index/constituents/ths-stock-list', {'thscode': '000300.SH'}))
    members = {row['thscode']: row['name'] for row in universe.get('item', [])}
    if len(members) != 300:
        raise RuntimeError(f'Expected 300 CSI 300 members, found {len(members)}')
    index_codes = sorted(set(members) | COMPARE_ONLY)
    label_jobs = [
        (f'industries-{i}', '/api/a-share-index/constituents/ths-index-list-by-stock',
         {'thscode': ','.join(batch), 'type': 'industry'})
        for i, batch in enumerate(batches(index_codes, 80))
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        label_results = list(executor.map(fetch, label_jobs))
    industries = {row['thscode']: [i['name'] for i in row.get('index_list', [])]
                  for _, result, _ in label_results for row in result.get('item', [])}
    sector_by_code = {code: match_sector(labels) for code, labels in industries.items()}
    preferred = [code for code in STOCKS if code in members and code not in COMPARE_ONLY]
    candidates = preferred + [code for code in sorted(members) if code not in preferred and code not in COMPARE_ONLY]
    selected = [code for sector in SECTORS for code in [symbol for symbol in candidates if sector_by_code.get(symbol) == sector][:10]]
    counts = {sector: sum(sector_by_code.get(code) == sector for code in selected) for sector in SECTORS}
    if set(counts.values()) != {10}:
        raise RuntimeError(f'Each sector requires 10 verified constituents: {counts}')
    codes = selected + sorted(COMPARE_ONLY)
    names = members | STOCKS
    end_ms = int(dt.datetime.combine(CUTOFF, dt.time(23, 59), CHINA).timestamp() * 1000)
    job_list = [
        (f'valuation-{i}', '/api/a-share/valuations/snapshot', {'thscodes': ','.join(batch)})
        for i, batch in enumerate(batches(codes, 10))
    ]
    short_history = [code for code in codes if code not in STOCKS]
    long_history = [code for code in codes if code in STOCKS]
    for series_name, series_codes, days, batch_size in [('short', short_history, 754, 6), ('long', long_history, 1815, 3)]:
        start = CUTOFF - dt.timedelta(days=days)
        start_ms = int(dt.datetime.combine(start, dt.time.min, CHINA).timestamp() * 1000)
        for i, batch in enumerate(batches(series_codes, batch_size)):
            job_list.append((f'prices-{series_name}-{i}', '/api/a-share/prices/historical-batch', {
                'thscodes': ','.join(batch), 'interval': '1d', 'start': start_ms, 'end': end_ms, 'adjust': 'forward',
            }))
    for code in codes:
        job_list.append((code, '/api/a-share/financials/income-statements', {'thscode': code, 'period': 'quarterly', 'limit': 6}))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        data = {label: result for label, result, _ in executor.map(fetch, job_list)}

    valuation_packets = [result for label, result in data.items() if label.startswith('valuation-')]
    valuation_dates = [result['timestamp'] for result in valuation_packets if isinstance(result.get('timestamp'), (int, float))]
    valuations = {row['thscode']: (row.get('pe_ttm'), date(result.get('timestamp')))
                  for result in valuation_packets for row in result.get('item', [])}
    prices = {}
    for label, result in data.items():
        if label.startswith('prices-'):
            for group in result.get('item', []):
                indexed = {}
                for item in group.get('item', []):
                    close = item.get('close_price')
                    observed = date(item.get('date_ms'))
                    if observed and isinstance(close, (int, float)) and math.isfinite(close) and close > 0:
                        indexed[observed] = close
                prices[group['thscode']] = sorted(indexed.items())
    rows = []
    for code in codes:
        reports = []
        for row in data[code].get('item', []):
            period = date(row.get('period_end_ms'))
            disclosed = date(row.get('report_date_ms'))
            if period and disclosed and disclosed <= CUTOFF.isoformat():
                reports.append({'period': period, 'disclosed': disclosed, 'profit': row.get('parent_holder_net_profit'),
                                'revenue': row.get('operating_income'), 'currency': row.get('currency')})
        pe, pe_date = valuations.get(code, (None, None))
        rows.append({'code': code, 'name': names[code], 'industry': ', '.join(industries.get(code, [])),
                     'sector': sector_by_code.get(code), 'pool': code in selected, 'prices': prices.get(code, []),
                     'pe': pe, 'valuationAsOf': pe_date, 'reports': sorted(reports, key=lambda x: x['period'], reverse=True)})

    summary = {'asOf': CUTOFF.isoformat(), 'valuationAsOf': date(max(valuation_dates)) if valuation_dates else None, 'sectors': counts, 'indexMemberCount': len(members), 'source': '扶摇金融数据 API',
               'refs': {'prices': BASE+'/docs/api-reference/prices/', 'fundamentals': BASE+'/docs/api-reference/financials/',
                        'valuation': BASE+'/docs/api-reference/valuation/', 'industry': BASE+'/docs/api-reference/a-share-index/'}, 'stocks': rows}
    if len(selected) != 60 or sum(row['pool'] and len(row['prices']) >= 245 for row in rows) < 54:
        raise RuntimeError('Too little market data for the prototype')
    dest = Path(__file__).resolve().parents[1] / 'dist' / 'market-data.json'
    temp = dest.with_suffix('.json.tmp')
    temp.write_text(json.dumps(summary, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temp.replace(dest)
    print('Verified index membership:', sum(row['pool'] for row in rows))
    print('Sector counts:', counts)
    print('Coverage (prices, PE, reports):', sum(bool(row['prices']) for row in rows),
          sum(row['pe'] is not None for row in rows), sum(bool(row['reports']) for row in rows))

if __name__ == '__main__':
    run()
