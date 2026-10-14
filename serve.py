#!/usr/bin/env python3
"""Static server for local use. Same as `python3 -m http.server` but tells the browser not to
cache files, so edits to the JS modules show up on the next reload."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    print('Paper Reading: http://localhost:%d/' % PORT, flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
