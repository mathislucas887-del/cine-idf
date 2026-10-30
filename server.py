#!/usr/bin/env python3
"""Ciné IDF – serveur local : sert l'appli + relais (proxy) vers l'API publique de pathe.fr.
Usage : python3 server.py   puis ouvrir http://localhost:8765
"""
import http.server, socketserver, urllib.request, urllib.error, time, os, sys, threading
PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8765))
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE, TTL, LOCK = {}, 600, threading.Lock()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        if not s.path.startswith("/pathe/"): return super().do_GET()
        path = s.path[len("/pathe/"):]
        url = "https://www.pathe.fr/api/" + path + ("&" if "?" in path else "?") + "language=fr"
        now = time.time()
        with LOCK: hit = CACHE.get(url)
        if hit and now - hit[0] < TTL: code, body = 200, hit[1]
        else:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Language": "fr-FR,fr;q=0.9", "Referer": "https://www.pathe.fr/"})
                body = urllib.request.urlopen(req, timeout=20).read(); code = 200
                with LOCK: CACHE[url] = (now, body)
            except urllib.error.HTTPError as e: code, body = e.code, e.read() or b'{"error":"http"}'
            except Exception as e: code, body = 502, ('{"error":"%s"}' % str(e).replace('"', "'")).encode()
        s.send_response(code); s.send_header("Content-Type", "application/json; charset=utf-8")
        s.send_header("Content-Length", str(len(body))); s.end_headers(); s.wfile.write(body)

class TS(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
if __name__ == "__main__":
    import socket
    HOST = os.environ.get("HOST", "0.0.0.0")
    try:
        k = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); k.connect(("8.8.8.8", 80)); ip = k.getsockname()[0]; k.close()
    except Exception: ip = "IP-de-cet-ordinateur"
    print(f"Ciné IDF → sur cet ordinateur : http://localhost:{PORT}")
    print(f"           sur votre téléphone (même Wi-Fi) : http://{ip}:{PORT}")
    print("Ctrl+C pour arrêter")
    TS((HOST, PORT), H).serve_forever()
