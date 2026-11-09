"""Loopback-only Formation Studio and local animation library server."""
from __future__ import annotations
import argparse
import json
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from library_api import LibraryService, MAX_BODY
from urllib.request import urlopen
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
LIBRARY = LibraryService(ROOT)

class StudioServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits competing listeners. Reserve this port exclusively.
    allow_reuse_address = not hasattr(socket, 'SO_EXCLUSIVEADDRUSE')

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.json': 'application/json'}

    def local_request(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get('Host') not in allowed:
            self.send_error(403, 'Only local studio requests are allowed.')
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://' + host for host in allowed}:
            self.send_error(403, 'Only local studio requests are allowed.')
            return False
        return True

    def json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_request(self, path, data=None):
        try:
            result = LIBRARY.get(path) if data is None else LIBRARY.post(path, data)
            self.json_response(result)
        except KeyError as exc:
            self.json_response({'error': str(exc).strip("'")}, 404)
        except (ValueError, TypeError, FileNotFoundError) as exc:
            self.json_response({'error': str(exc)}, 400)
        except Exception as exc:
            self.json_response({'error': str(exc) or 'Biblioteket kunne ikke udføre handlingen.'}, 500)

    def do_POST(self):
        if not self.local_request():
            return
        path = urlsplit(self.path).path
        if not path.startswith('/api/library'):
            self.send_error(404)
            return
        try:
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Anmodningen skal indeholde JSON.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                raise ValueError('Anmodningen er tom eller for stor.')
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(data, dict):
                raise ValueError('Anmodningen skal være et JSON-objekt.')
        except (ValueError, UnicodeError) as exc:
            self.json_response({'error': str(exc)}, 400)
            return
        self.api_request(path, data)

    def do_GET(self):
        if not self.local_request():
            return
        if urlsplit(self.path).path.startswith('/api/library'):
            self.api_request(urlsplit(self.path).path)
            return
        if urlsplit(self.path).path == '/health':
            body = b'{"application":"walking-fortress-formation-studio","version":2}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        target = (ROOT / unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or any(part.startswith('.') for part in target.relative_to(ROOT).parts):
            self.send_error(403)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            super().log_message(fmt, *args)

def main():
    parser = argparse.ArgumentParser(description='Start Formationsstudio locally.')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    try:
        server = StudioServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT)))
    except OSError as exc:
        if args.open:
            try:
                with urlopen(f'http://127.0.0.1:{args.port}/health', timeout=2) as response:
                    existing = json.load(response)
                if existing.get('application') == 'walking-fortress-formation-studio':
                    webbrowser.open(f'http://127.0.0.1:{args.port}')
                    print('Formationsstudio koerer allerede. Browseren er aabnet.')
                    return
            except Exception:
                pass
        raise SystemExit(f'Port {args.port} kunne ikke bruges. Formationsstudio er muligvis allerede startet.\n{exc}')
    url = f'http://127.0.0.1:{args.port}'
    print(f'Formationsstudio: {url}\nLad vinduet staa aabent. Stop med Ctrl+C.', flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        LIBRARY.close()
        server.server_close()

if __name__ == '__main__':
    main()
