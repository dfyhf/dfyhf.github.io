#!/usr/bin/env python3
"""Write flat + studio music manifests from the on-disk folder layout.

Creates:
  - music/iteration-1/files.json
  - music/iteration-2/files.json
  - music/iteration-2/files.inline.js
  - music/studio-takes/files.json

Flat iteration manifests map track ids to the exact `.mp3` basename found in that folder.
Studio takes manifest maps each track folder id to its contained `.mp3` basenames.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ALBUM_TRACK_IDS = [
    "01-the-garden-path",
    "02-decades",
    "03-arrows",
    "04-smoke-filled-rooms",
    "05-passing-thoughts",
    "06-reorient",
    "07-recursion",
    "08-the-weighout",
    "09-permaculture",
]


def write_json(path: Path, payload: dict[str, str | list[str]]) -> None:
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_seeded_js(path: Path, global_name: str, payload: dict[str, str]) -> None:
    path.write_text(
        f"globalThis.{global_name} = "
        + json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True)
        + ";\n",
        encoding="utf-8",
    )


def collect_flat_manifest(directory: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not directory.is_dir():
        return out

    for child in sorted(directory.iterdir()):
        if not child.is_file() or child.suffix.lower() != ".mp3":
            continue
        match = re.match(r"^(\d{2})\b", child.name)
        if not match:
            continue
        idx = int(match.group(1)) - 1
        if idx < 0 or idx >= len(ALBUM_TRACK_IDS):
            continue
        out[ALBUM_TRACK_IDS[idx]] = child.name
    return out


def collect_studio_manifest(directory: Path) -> dict[str, str | list[str]]:
    out: dict[str, str | list[str]] = {}
    if not directory.is_dir():
        return out

    for child in sorted(directory.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        mp3s = sorted(p.name for p in child.glob("*.mp3") if p.is_file())
        if not mp3s:
            continue
        out[child.name] = mp3s[0] if len(mp3s) == 1 else mp3s
    return out


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    music_dir = root / "music"

    iteration_1_dir = music_dir / "iteration-1"
    iteration_2_dir = music_dir / "iteration-2"
    studio_takes_dir = music_dir / "studio-takes"

    iteration_1_dir.mkdir(parents=True, exist_ok=True)
    iteration_2_dir.mkdir(parents=True, exist_ok=True)
    studio_takes_dir.mkdir(parents=True, exist_ok=True)

    iteration_1_manifest = collect_flat_manifest(iteration_1_dir)
    iteration_2_manifest = collect_flat_manifest(iteration_2_dir)
    studio_manifest = collect_studio_manifest(studio_takes_dir)

    write_json(iteration_1_dir / "files.json", iteration_1_manifest)
    write_json(iteration_2_dir / "files.json", iteration_2_manifest)
    write_seeded_js(iteration_2_dir / "files.inline.js", "__ITERATION_2_MANIFEST__", iteration_2_manifest)
    write_json(studio_takes_dir / "files.json", studio_manifest)

    print(f"Wrote {iteration_1_dir / 'files.json'} ({len(iteration_1_manifest)} tracks)")
    print(f"Wrote {iteration_2_dir / 'files.json'} ({len(iteration_2_manifest)} tracks)")
    print(f"Wrote {iteration_2_dir / 'files.inline.js'} ({len(iteration_2_manifest)} tracks)")
    print(f"Wrote {studio_takes_dir / 'files.json'} ({len(studio_manifest)} tracks with takes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
