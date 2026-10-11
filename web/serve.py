#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""serve.py DIR PORT: serve a browser build (web/build, web/build-fm6) on this computer only, and tell the
browser to keep no copies. With python's plain `http.server` a browser goes on showing an older page and an
older game for hours after a rebuild, because nothing says how long a copy is good for."""
import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):       # (quiet: one line a request is noise in a preview's log)
        pass


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), functools.partial(Handler, directory=sys.argv[1])).serve_forever()
