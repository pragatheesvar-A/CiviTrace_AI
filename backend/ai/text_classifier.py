"""
Text classification & semantic embedding (sentence-transformers, MiniLM).

Used for:
  * category prediction from the free-text report (prototype / nearest-centroid,
    calibrated with a softmax temperature) — an honest *weaker* signal than
    vision, always tagged as such;
  * the embedding vector reused by dedup and the assistant (compute once).

No training required: category prototypes are averaged embeddings of curated
seed phrases per class. This keeps the model auditable and updatable by editing
text, which matters for a public-sector system.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from functools import lru_cache
from typing import Optional

from config import settings
from .registry import registry

_SEEDS: dict[str, list[str]] = {
    "Roads": ["pothole in the road", "cracked asphalt", "broken pavement", "damaged street surface",
              "road caved in", "speed breaker damaged", "faded road markings", "sunken road patch"],
    "Water": ["water pipeline leak", "no water supply for days", "burst water main flooding street",
              "contaminated drinking water", "low water pressure", "sewage mixing with drinking water",
              "broken public tap running", "water tanker not arrived"],
    "Waste": ["overflowing garbage bin", "uncollected trash", "waste dumped on street",
              "dead animal on road", "public toilet dirty", "garbage not collected for days",
              "construction debris on footpath", "burning of garbage"],
    "Electricity": ["street light not working", "broken electric pole", "hanging live wire",
                    "transformer sparking", "power outage in area", "damaged junction box",
                    "exposed cable on pole", "frequent voltage fluctuation"],
    "Safety": ["broken park bench with sharp edge", "damaged bus shelter", "open manhole without cover",
               "unsafe dark stretch at night", "collapsed compound wall", "stray dog menace",
               "abandoned building hazard", "missing guard rail near drop"],
    "Flooding": ["road flooding after rain", "water accumulation on the street", "rain water logging",
                 "flooded underpass", "stagnant rain water blocking traffic", "storm drain overflow",
                 "knee deep water on the road", "residential area waterlogged"],
    "Traffic": ["broken traffic signal", "traffic light not working at junction", "signal stuck on red",
                "dangerous junction without signal", "blocked intersection", "malfunctioning pedestrian signal",
                "traffic light pole knocked down", "signal timing causing jam"],
}

_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Roads": ("pothole", "road", "asphalt", "pavement", "crack", "tar", "speed breaker"),
    "Water": ("water", "pipeline", "pipe", "leak", "tap", "supply", "tanker", "drinking"),
    "Waste": ("garbage", "trash", "waste", "bin", "dump", "litter", "dirty", "debris"),
    "Electricity": ("light", "streetlight", "wire", "pole", "power", "electric", "transformer", "cable", "voltage"),
    "Safety": ("unsafe", "hazard", "manhole", "sharp", "collapse", "dark", "stray", "danger", "wall"),
    "Flooding": ("flood", "waterlogging", "logging", "logged", "inundat", "rain water", "stagnant", "underpass"),
    "Traffic": ("signal", "traffic light", "junction", "intersection", "crossing signal", "traffic"),
}


@dataclass
class TextResult:
    category: str
    confidence: float
    scores: dict[str, float]
    method: str          # "embedding" | "keyword"
    model_status: str

    def dict(self) -> dict:
        return asdict(self)


@lru_cache(maxsize=1)
def _prototypes():
    enc = registry.text_encoder()
    if enc is None:
        return None
    import numpy as np

    protos = {}
    for cat, seeds in _SEEDS.items():
        v = enc.encode(seeds, normalize_embeddings=True)
        protos[cat] = np.asarray(v).mean(0)
    return protos


def embed(text: str):
    enc = registry.text_encoder()
    if enc is None or not text.strip():
        return None
    return enc.encode([text], normalize_embeddings=True)[0]


def _keyword(text: str) -> TextResult:
    t = text.lower()
    scores = {c: sum(1.0 for k in kws if k in t) for c, kws in _KEYWORDS.items()}
    total = sum(scores.values())
    if total == 0:
        return TextResult(settings.categories[0], 0.2, {c: 0.0 for c in _KEYWORDS},
                          "keyword", "embeddings unavailable — keyword fallback")
    best = max(scores, key=scores.get)
    conf = min(0.85, 0.4 + 0.15 * scores[best])
    norm = {c: round(v / total, 3) for c, v in scores.items()}
    return TextResult(best, round(conf, 3), norm, "keyword", "embeddings unavailable — keyword fallback")


def classify(text: str) -> TextResult:
    protos = _prototypes()
    if protos is None:
        return _keyword(text)
    v = embed(text)
    if v is None:
        return _keyword(text)
    import numpy as np

    cats = list(protos)
    sims = np.array([float(np.dot(v, protos[c])) for c in cats])
    # temperature-scaled softmax over cosine sims for a calibrated confidence
    T = 0.12
    e = np.exp((sims - sims.max()) / T)
    probs = e / e.sum()
    idx = int(probs.argmax())
    return TextResult(
        category=cats[idx], confidence=round(float(probs[idx]), 3),
        scores={c: round(float(p), 3) for c, p in zip(cats, probs)},
        method="embedding", model_status="ok",
    )
