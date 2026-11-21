#!/usr/bin/env python3
"""Abre HealthForest en local. Sirve la carpeta dist (rápida, con módulos separados)."""
import http.server
import os
import webbrowser

root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist"))
if not os.path.isdir(root):
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(root)
port = 4173
webbrowser.open(f"http://127.0.0.1:{port}/")
http.server.ThreadingHTTPServer(("127.0.0.1", port), http.server.SimpleHTTPRequestHandler).serve_forever()
