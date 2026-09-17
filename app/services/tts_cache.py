"""Content-addressed audio cache shared by every student.

Audio used to be synthesized per browser and kept in IndexedDB, so each student
paid the full generation cost and a cache clear lost everything. Files are now
keyed by a hash of the synthesis inputs and stored on disk, which lets one
student's request (or a pre-generation script) serve everyone.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

AUDIO_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "audio"

EXTENSIONS = {"audio/mpeg": "mp3", "audio/wav": "wav"}
MEDIA_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav"}


def cache_key(text: str, *, provider: str, voice: str, rate: int) -> str:
    """Hash every input that changes the audio.

    `rate` is part of the key: the old frontend key omitted it, so changing the
    playback speed kept serving audio at the previous speed.
    """
    payload = f"{provider}\x00{voice}\x00{rate}\x00{text.strip()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def find(key: str) -> tuple[Path, str] | None:
    """Return the cached file and its media type, or None on a miss."""
    for extension, media_type in MEDIA_TYPES.items():
        path = AUDIO_DIR / f"{key}.{extension}"
        if path.is_file() and path.stat().st_size > 0:
            return path, media_type
    return None


def store(key: str, audio: bytes, media_type: str) -> Path:
    """Persist audio, writing via a temp file so readers never see a partial."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    extension = EXTENSIONS.get(media_type, "mp3")
    path = AUDIO_DIR / f"{key}.{extension}"
    temp_path = path.with_suffix(f".{extension}.tmp")
    temp_path.write_bytes(audio)
    temp_path.replace(path)
    return path


def stats() -> dict[str, int]:
    if not AUDIO_DIR.is_dir():
        return {"files": 0, "bytes": 0}
    files = [p for p in AUDIO_DIR.iterdir() if p.suffix in {".mp3", ".wav"}]
    return {
        "files": len(files),
        "bytes": sum(p.stat().st_size for p in files),
    }
