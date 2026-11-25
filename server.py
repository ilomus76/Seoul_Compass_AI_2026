"""로컬 개발용 정적 서버 (Python 표준 라이브러리만 사용)

실행: python server.py [포트번호]
기본 주소: http://127.0.0.1:8000
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[server] " + (fmt % args))


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Seoul Compass AI 2026 → http://127.0.0.1:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료했습니다.")
