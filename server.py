"""Standalone, loopback-only static server for Walking Fortress Formationsstudio."""
from __future__ import annotations
import argparse
import json
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent

class StudioServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits competing listeners. Reserve this port exclusively.
    allow_reuse_address = not hasattr(socket, 'SO_EXCLUSIVEADDRUSE')

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.json': 'application/json'}

    def do_GET(self):
        if urlsplit(self.path).path == '/health':
            body = b'{"application":"walking-fortress-formation-studio","version":1}'
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
        server.server_close()

if __name__ == '__main__':
    main()
