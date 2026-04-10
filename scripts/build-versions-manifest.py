#!/usr/bin/env python3
"""Backward-compatible wrapper for `scripts/build-music-manifests.py`."""

from __future__ import annotations

import runpy
from pathlib import Path


def main() -> int:
    target = Path(__file__).with_name("build-music-manifests.py")
    namespace = runpy.run_path(str(target))
    return int(namespace["main"]())


if __name__ == "__main__":
    raise SystemExit(main())
