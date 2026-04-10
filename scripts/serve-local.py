#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeRequestHandler(SimpleHTTPRequestHandler):
    range_matcher = re.compile(r"bytes=(\d*)-(\d*)")

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        ctype = self.guess_type(path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        start = 0
        end = size - 1
        self._range = None

        range_header = self.headers.get("Range")
        if range_header:
            match = self.range_matcher.fullmatch(range_header.strip())
            if match:
                start_text, end_text = match.groups()
                if start_text:
                    start = int(start_text)
                if end_text:
                    end = int(end_text)
                if not start_text and end_text:
                    length = int(end_text)
                    start = max(0, size - length)
                    end = size - 1
                if start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    f.close()
                    return None
                end = min(end, size - 1)
                if end < start:
                    end = size - 1
                self._range = (start, end)
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                content_length = end - start + 1
            else:
                self.send_response(200)
                content_length = size
        else:
            self.send_response(200)
            content_length = size

        self.send_header("Content-type", ctype)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        if self._range:
            f.seek(self._range[0])
        return f

    def copyfile(self, source, outputfile):
        if not getattr(self, "_range", None):
            return super().copyfile(source, outputfile)

        start, end = self._range
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the site locally with HTTP Range support for audio seeking.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), RangeRequestHandler)
    print(f"Serving on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
