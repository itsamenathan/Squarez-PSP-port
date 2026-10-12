#!/usr/bin/env python3
"""Serve the Squarez web app on all interfaces (default 0.0.0.0:8080)."""
import argparse
import functools
import http.server
import os

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='0.0.0.0')
parser.add_argument('--port', type=int, default=8080)
args = parser.parse_args()

root = os.path.dirname(os.path.abspath(__file__))
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)

with http.server.ThreadingHTTPServer((args.host, args.port), Handler) as httpd:
    print(f'Squarez running at http://{args.host}:{args.port}/')
    httpd.serve_forever()
