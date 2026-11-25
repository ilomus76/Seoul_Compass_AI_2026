"""로컬 개발용 정적 서버 (Python 표준 라이브러리만 사용)

전용 포트: 9200 (다른 프로젝트의 8000/8010/8080/8787/9100~9103 과 겹치지 않음)
실행: python server.py [포트번호]
기본 주소: http://127.0.0.1:9200
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 9200
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[server] " + (fmt % args))


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as exc:
        raise SystemExit(
            f"포트 {PORT}을(를) 사용할 수 없습니다: {exc}\n"
            f"다른 포트를 지정하세요: python server.py 9201"
        )
    with httpd:
        print(f"Seoul Compass AI 2026 → http://127.0.0.1:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료했습니다.")
