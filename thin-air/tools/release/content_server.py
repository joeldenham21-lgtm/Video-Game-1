#!/usr/bin/env python3
"""Local stand-in for the GitHub release host, to test the Lite build's first-launch download on desktop.

Serves one file with HTTP Range support behind a 302 redirect (like github.com -> the release CDN), and can
drop the connection part-way to exercise resume. Writes a manifest the game reads with --content-manifest.

  python3 tools/release/content_server.py build/content-linux/ThinAir-content.pck --port 8765 \
      --manifest /tmp/manifest.json [--drop-after-mb 40] [--rate-mbps 0]
  build/linux-lite/ThinAir.x86_64 --headless -- --content-manifest=/tmp/manifest.json --autostart --autoquit=5
"""
import argparse
import hashlib
import http.server
import json
import os
import socketserver
import threading
import time

ap = argparse.ArgumentParser()
ap.add_argument("pack")
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--manifest", required=True)
ap.add_argument("--id", default="localtest")
ap.add_argument("--drop-after-mb", type=float, default=0.0, help="cut the first response after this many MB")
ap.add_argument("--rate-mbps", type=float, default=0.0, help="throttle (MB/s), 0 = unlimited")
args = ap.parse_args()

SIZE = os.path.getsize(args.pack)
h = hashlib.sha256()
with open(args.pack, "rb") as fh:
    for b in iter(lambda: fh.read(1 << 20), b""):
        h.update(b)
with open(args.manifest, "w") as fh:
    json.dump({"id": args.id, "size": SIZE, "sha256": h.hexdigest(),
               "urls": [f"http://127.0.0.1:{args.port}/releases/download/test/ThinAir-content.pck"]}, fh)
state = {"dropped": False, "requests": 0}
lock = threading.Lock()


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        print("[server]", fmt % a, flush=True)

    def do_GET(self):
        if self.path.startswith("/releases/download/"):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{args.port}/cdn/blob?sig=abc")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self.path.startswith("/cdn/"):
            self.send_error(404)
            return
        start, end = 0, SIZE - 1
        rng = self.headers.get("Range")
        code = 200
        if rng and rng.startswith("bytes="):
            a, b = rng[6:].split("-")
            start = int(a)
            end = min(int(b) if b else SIZE - 1, SIZE - 1)
            if start >= SIZE:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{SIZE}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            code = 206
        n = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(n))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{SIZE}")
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with lock:
            state["requests"] += 1
        sent = 0
        with open(args.pack, "rb") as fh:
            fh.seek(start)
            while sent < n:
                block = fh.read(min(1 << 18, n - sent))
                if not block:
                    break
                with lock:
                    drop = (args.drop_after_mb > 0 and not state["dropped"]
                            and start + sent >= args.drop_after_mb * 1e6)
                    if drop:
                        state["dropped"] = True
                if drop:
                    print(f"[server] dropping connection at byte {start + sent}", flush=True)
                    self.close_connection = True
                    self.connection.shutdown(2)
                    return
                self.wfile.write(block)
                sent += len(block)
                if args.rate_mbps > 0:
                    time.sleep(len(block) / (args.rate_mbps * 1e6))


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


print(f"serving {args.pack} ({SIZE} bytes) on :{args.port}; manifest {args.manifest}", flush=True)
S(("127.0.0.1", args.port), H).serve_forever()
