"""
Report authenticity — "is this a real, first-hand, unstaged report?"

Signals fused into a 0..1 authenticity score:
  * scene_pass      — the vision gate accepted the photo as the claimed kind of scene
  * detection       — an object detector actually found the defect (Roads)
  * novel_image     — the photo's perceptual hash is not a near-duplicate of an
                      image already in the system (catches reused / stock photos)
  * reporter_trust  — Bayesian trust of the submitter
  * text_match      — the free-text classifier agrees with the chosen category
  * corroboration   — independent nearby reports of the same kind

Every check is transparent (returned in ``checks``) so an authority can see
exactly why a report was trusted or held. Nothing here blocks a submission —
it produces a decision aid and, at most, holds a low-scoring report out of the
"verified" state until a human or corroborating reports arrive.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Authenticity:
    score: float
    label: str                       # "authentic" | "plausible" | "needs review"
    flags: list[str] = field(default_factory=list)
    checks: dict = field(default_factory=dict)

    def dict(self) -> dict:
        return asdict(self)


def dhash(path: str, size: int = 8) -> Optional[str]:
    """Difference hash — 64-bit perceptual fingerprint, robust to resize / re-encode."""
    try:
        from PIL import Image

        with Image.open(path) as im:
            im = im.convert("L").resize((size + 1, size), Image.LANCZOS)
            px = list(im.getdata())
        bits = 0
        for row in range(size):
            for col in range(size):
                left = px[row * (size + 1) + col]
                right = px[row * (size + 1) + col + 1]
                bits = (bits << 1) | (1 if left > right else 0)
        return f"{bits:016x}"
    except Exception:
        return None


def hamming(a: Optional[str], b: Optional[str]) -> int:
    if not a or not b:
        return 64
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return 64


def assess(*, has_photo: bool, scene_pass: Optional[bool], detections: int,
           reporter_trust: float, text_agrees: bool, corroboration: int,
           novel_image: bool) -> Authenticity:
    checks: dict = {}
    flags: list[str] = []

    # weighted evidence — weights sum to 1.0
    score = 0.0
    if has_photo:
        sp = 1.0 if scene_pass else (0.0 if scene_pass is False else 0.5)
        checks["scene_pass"] = sp
        score += 0.30 * sp
        if scene_pass is False:
            flags.append("photo does not match the reported scene type")
        dc = min(detections, 3) / 3
        checks["detection"] = dc
        score += 0.15 * dc
        ni = 1.0 if novel_image else 0.0
        checks["novel_image"] = ni
        score += 0.15 * ni
        if not novel_image:
            flags.append("photo is a near-duplicate of an existing image")
    else:
        checks["photo"] = 0.0
        flags.append("no photo attached — text-only report")
        score += 0.10  # small base credit; text reports are allowed but weaker

    tt = max(0.0, min(1.0, reporter_trust))
    checks["reporter_trust"] = round(tt, 3)
    score += 0.20 * tt

    ta = 1.0 if text_agrees else 0.0
    checks["text_match"] = ta
    score += 0.10 * ta
    if not text_agrees:
        flags.append("description does not clearly match the chosen category")

    cor = min(corroboration, 3) / 3
    checks["corroboration"] = round(cor, 3)
    score += 0.10 * cor

    score = round(max(0.0, min(1.0, score)), 3)
    label = "authentic" if score >= 0.7 else "plausible" if score >= 0.45 else "needs review"
    return Authenticity(score=score, label=label, flags=flags, checks=checks)
