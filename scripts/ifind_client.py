"""Read-only iFinD MCP calls with the authorization header passed through stdin."""
import json
import os
import subprocess

BASE = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-'
SERVICES = {'news': 'news-mcp', 'stock': 'stock-mcp'}

def request(service, method, request_id=None, params=None, session=None):
    payload = {'jsonrpc': '2.0', 'method': method}
    if request_id is not None:
        payload['id'] = request_id
    if params is not None:
        payload['params'] = params
    settings = [
        ('url', BASE+SERVICES[service]),
        ('header', 'Content-Type: application/json'),
        ('header', 'Accept: application/json, text/event-stream'),
        ('header', 'Authorization: '+os.environ['IFIND_MCP_KEY']),
        ('header', 'User-Agent: codex'),
        ('data', json.dumps(payload, ensure_ascii=False, separators=(',', ':'))),
    ]
    if session:
        settings.append(('header', 'Mcp-Session-Id: '+session))
    content = '\n'.join(key+' = '+json.dumps(value, ensure_ascii=False) for key, value in settings)
    output = subprocess.run(['curl', '-q', '-sS', '-i', '--connect-timeout', '6',
                             '--max-time', '24', '--config', '-'],
                            input=content.encode(), capture_output=True, check=False)
    if output.returncode:
        return 0, {}, {}
    raw = output.stdout.replace(b'\r\n', b'\n')
    status, headers = 0, {}
    while raw.startswith(b'HTTP/'):
        head, _, raw = raw.partition(b'\n\n')
        lines = head.decode('latin1').split('\n')
        status = int(lines[0].split()[1])
        headers = {key.lower(): value.strip() for line in lines[1:] if ':' in line
                   for key, value in [line.split(':', 1)]}
    pieces = [raw]
    if raw.lstrip().startswith((b'event:', b'data:', b':')):
        pieces = [line[5:].strip() for line in raw.split(b'\n') if line.startswith(b'data:')]
    for piece in pieces:
        try:
            body = json.loads(piece)
            if isinstance(body, dict):
                return status, headers, body
        except ValueError:
            pass
    return status, headers, {}

def start(service):
    for _ in range(2):
        status, headers, body = request(service, 'initialize', 1, {
            'protocolVersion': '2025-03-26', 'capabilities': {},
            'clientInfo': {'name': 'stock-lens', 'version': '1.1.0'},
        })
        if status not in (0, 502, 503, 504):
            break
    session = headers.get('mcp-session-id')
    if status != 200 or not session or 'result' not in body:
        raise RuntimeError(f'{service} initialize HTTP {status}')
    status, _, _ = request(service, 'notifications/initialized', session=session)
    if not 200 <= status < 300:
        raise RuntimeError(f'{service} initialized HTTP {status}')
    return session

def call(service, session, name, args):
    status, _, body = request(service, 'tools/call', 2, {'name':name, 'arguments':args}, session)
    result = body.get('result')
    if status != 200 or not isinstance(result, dict) or result.get('isError'):
        raise RuntimeError(f'{service}/{name} unavailable (HTTP {status})')
    return result
