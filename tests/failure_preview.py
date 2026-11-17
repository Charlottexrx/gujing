"""Local-only preview with six deterministic fixture routes; sends no vendor requests."""
import json
import os
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]

class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/__failure_checks/':
            return self.send_bytes((ROOT/'tests/failure_checks.html').read_bytes(),'text/html')
        pieces=path.split('/')
        if len(pieces)>=5 and pieces[1]=='__fail__' and pieces[2] in ('fuyao','ifind') and pieces[3] in ('timeout','error','empty','business-error'):
            source,scenario=pieces[2:4]
            relative='/'.join(pieces[4:]) or 'index.html'
            target='market-data.json' if source=='fuyao' else 'ifind-notices.json'
            self.path='/'+relative
            if relative==target:
                if scenario=='timeout':
                    time.sleep(8)
                    return self.send_bytes((ROOT/'dist'/target).read_bytes(),'application/json')
                if scenario=='error':
                    return self.send_bytes(b'{"code":503,"message":"simulated error"}','application/json',503)
                if scenario=='business-error':
                    return self.send_bytes(b'{"code":2003,"message":"simulated upstream error"}','application/json')
                data=json.loads((ROOT/'dist'/target).read_text())
                data['stocks' if source=='fuyao' else 'notices']=[] if source=='fuyao' else {}
                return self.send_bytes(json.dumps(data).encode(),'application/json')
        return super().do_GET()

    def send_bytes(self,body,kind,status=200):
        self.send_response(status)
        self.send_header('Content-Type',kind+'; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):
            pass

    def log_message(self,*args):
        pass

if __name__=='__main__':
    port=int(os.environ.get('PORT','4173'))
    server=ThreadingHTTPServer(('0.0.0.0',port),partial(Preview,directory=str(ROOT/'dist')))
    print(f'Failure preview at http://127.0.0.1:{port}/',flush=True)
    server.serve_forever()
