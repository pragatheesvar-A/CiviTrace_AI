"""
Stage 1 — Scene-relevance gate (CLIP zero-shot, calibrated).

Contribution: a narrow pothole detector, run alone, confidently fires on
irrelevant photos (a face, a wall, food). We gate it behind a general
vision-language check that the image actually depicts a road/street surface.
Only if the gate passes do we run the detector.

Calibration: raw CLIP softmax over a hand-picked prompt set is over-confident.
We apply temperature scaling (T>1 softens) and report both the raw and the
calibrated score. The decision threshold is configurable and tuned on a small
labelled dev set (see AI_MODELS.md).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

from config import settings
from .registry import registry

# Prompt ensembles — averaged for robustness. One positive set per vision category;
# the negative set is shared (things a civic photo should never be).
_POSITIVE_BY_CATEGORY: dict[str, list[str]] = {
    "Roads": [
        "a photo of a road surface",
        "a street or asphalt pavement",
        "a close-up of a road with cracks or a pothole",
        "a tarmac road seen from above",
        "a damaged city street",
    ],
    "Flooding": [
        "a flooded street with standing water",
        "a road covered by rain water",
        "water logging on an urban road",
        "a submerged street after heavy rain",
        "vehicles driving through a waterlogged road",
    ],
    "Traffic": [
        "a traffic signal light at a road junction",
        "a broken or damaged traffic light",
        "a road intersection with traffic signals",
        "a street pole with traffic lights",
        "a busy road junction with vehicles",
    ],
}
_POSITIVE = _POSITIVE_BY_CATEGORY["Roads"]  # backwards-compat default
_NEGATIVE = [
    "a photo of a person or a face",
    "a photo of food",
    "an indoor room or furniture",
    "a screenshot or document",
    "a plant, animal or the sky selfie",
]

_TEMPERATURE = 2.0  # calibration; >1 softens over-confident CLIP logits


@dataclass
class SceneResult:
    is_scene: bool
    score: float          # calibrated P(road scene)
    raw_score: float      # uncalibrated
    method: str           # "clip" | "heuristic"
    model_status: str
    detail: str

    def dict(self) -> dict:
        return asdict(self)


def _heuristic(path: str) -> SceneResult:
    """Deterministic fallback when CLIP is unavailable (offline / download fail)."""
    try:
        import numpy as np
        from PIL import Image

        with Image.open(path) as im:
            im = im.convert("RGB").resize((64, 64))
            a = np.asarray(im, dtype="float32")
        # road surfaces: low colour saturation, mid brightness, textured
        sat = (a.max(2) - a.min(2)).mean() / 255.0
        bright = a.mean() / 255.0
        texture = float(np.abs(np.diff(a.mean(2), axis=0)).mean()) / 255.0
        score = max(0.0, min(1.0, 0.55 * (1 - sat) + 0.25 * (1 - abs(bright - 0.45) * 2) + 0.6 * texture))
        return SceneResult(
            is_scene=score >= settings.scene_gate_threshold,
            score=round(score, 3), raw_score=round(score, 3),
            method="heuristic", model_status="clip unavailable — using texture heuristic",
            detail=f"sat={sat:.2f} bright={bright:.2f} texture={texture:.2f}",
        )
    except Exception as e:
        return SceneResult(False, 0.0, 0.0, "heuristic", f"error: {e}", "unreadable image")


def check(path: str, category: str = "Roads") -> SceneResult:
    positive = _POSITIVE_BY_CATEGORY.get(category, _POSITIVE)
    model, proc = registry.clip()
    if model is None:
        return _heuristic(path)
    try:
        import torch
        from PIL import Image

        with Image.open(path) as im:
            im = im.convert("RGB")
        prompts = positive + _NEGATIVE
        inp = proc(text=prompts, images=im, return_tensors="pt", padding=True)
        with torch.no_grad():
            out = model(**inp)
        logits = out.logits_per_image.squeeze(0)  # [n_prompts]
        pos = logits[: len(positive)].mean()
        neg = logits[len(positive):].mean()
        raw = torch.softmax(torch.stack([pos, neg]), dim=0)[0].item()
        cal = torch.softmax(torch.stack([pos, neg]) / _TEMPERATURE, dim=0)[0].item()
        return SceneResult(
            is_scene=cal >= settings.scene_gate_threshold,
            score=round(cal, 3), raw_score=round(raw, 3),
            method="clip", model_status="ok",
            detail=f"pos_logit={pos.item():.1f} neg_logit={neg.item():.1f} T={_TEMPERATURE}",
        )
    except Exception as e:  # pragma: no cover
        r = _heuristic(path)
        r.model_status = f"clip error: {e}; fell back to heuristic"
        return r
