#!/usr/bin/env python3
"""Rename album MP3s to numbered filenames and set ID3 (title, artist, album, track).

Dependencies: Python 3 + mutagen (`pip install -r scripts/requirements.txt`).

For ffmpeg (transcode, stream-copy metadata experiments, etc.) via Nix user profile::

    nix profile add nixpkgs#ffmpeg

This script uses mutagen only; ffmpeg is optional tooling for future workflows.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from mutagen.id3 import TALB, TIT2, TPE1, TRCK
from mutagen.mp3 import MP3

ALBUM = "The Garden Path"
ARTIST = "iterations"
TOTAL = 9

# (source stem without .mp3, numbered filename without .mp3, id3 title)
TRACKS: list[tuple[str, str, str]] = [
    ("The Garden Path", "01 - The Garden Path", "The Garden Path"),
    ("Decades", "02 - Decades", "Decades"),
    ("← ↑ Arrows ↓→", "03 - ← ↑ Arrows ↓→", "← ↑ Arrows ↓→"),
    ("Smoke-Filled Rooms", "04 - Smoke-Filled Rooms", "Smoke-Filled Rooms"),
    ("Passing Thoughts", "05 - Passing Thoughts", "Passing Thoughts"),
    ("Reorient", "06 - Reorient", "Reorient"),
    ("Recursion", "07 - Recursion", "Recursion"),
    ("The Weigh Out", "08 - The Weighout", "The Weighout"),
    ("Permaculture", "09 - Permaculture", "Permaculture"),
]


def tag_file(path: Path, title: str, track: int) -> None:
    audio = MP3(path)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    tags.delall("TIT2")
    tags.delall("TPE1")
    tags.delall("TALB")
    tags.delall("TRCK")
    tags.add(TIT2(encoding=3, text=title))
    tags.add(TPE1(encoding=3, text=ARTIST))
    tags.add(TALB(encoding=3, text=ALBUM))
    tags.add(TRCK(encoding=3, text=f"{track}/{TOTAL}"))
    audio.save()


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    music = root / "music"

    phase1: list[tuple[Path, Path]] = []
    for i, (src_stem, dest_stem, _) in enumerate(TRACKS, start=1):
        src = music / f"{src_stem}.mp3"
        if not src.is_file():
            raise SystemExit(f"Missing source: {src}")
        dest = music / f"{dest_stem}.mp3"
        tmp = music / f".rename_tmp_{i:02d}.mp3"
        shutil.move(src, tmp)
        phase1.append((tmp, dest))

    for tmp, dest in phase1:
        shutil.move(tmp, dest)

    for i, (_, _, title) in enumerate(TRACKS, start=1):
        dest_stem = TRACKS[i - 1][1]
        tag_file(music / f"{dest_stem}.mp3", title, i)

    print("Renamed and tagged", len(TRACKS), "tracks in", music)


if __name__ == "__main__":
    main()
