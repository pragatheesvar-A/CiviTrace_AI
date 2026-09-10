"""
Hybrid priority model.

Contribution: a single learned function that fuses heterogeneous signals into a
4-level priority, with a transparent rule-based safety net.

Features (all in [0,1] unless noted):
    vision_conf        calibrated Stage-2 detection confidence (0 if none)
    detections         min(count, 5) / 5
    severity           fraction of frame covered by damage
    text_conf          embedding classifier confidence
    cluster_size       min(n_reports, 15) / 15   (multi-signal dedup output)
    upvotes            min(upvotes, 30) / 30
    reporter_trust     Bayesian trust posterior mean
    ward_weight        socio-economic vulnerability weight of the location (0..1)
    hazard_category    1 if category in {Flooding, Electricity, Safety, Traffic} (life-safety prone)

Model: sklearn GradientBoostingClassifier, trained at startup on a synthetic but
rule-consistent dataset (documented in AI_MODELS.md) so the repo is
self-contained; swap `train.csv` for real labelled triage history to retrain.
Rule net: >=2 confident vision detections OR severe severity -> at least 'high';
a live-wire / open-manhole keyword -> 'critical'. The net can only *raise*, never
lower, the learned level.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from functools import lru_cache

import numpy as np

from config import settings

LEVELS = ["low", "medium", "high", "critical"]
_FEATURES = ["vision_conf", "detections", "severity", "text_conf", "cluster_size",
             "upvotes", "reporter_trust", "ward_weight", "hazard_category"]


@dataclass
class PriorityResult:
    level: str
    score: float                 # 0..1 continuous (expected level / 3)
    method: str                  # "model+rules" | "rules"
    contributions: dict[str, float]
    rule_overrides: list[str]

    def dict(self) -> dict:
        return asdict(self)


def _synth_dataset(n=4000, seed=7):
    rng = np.random.default_rng(seed)
    X = rng.random((n, len(_FEATURES)))
    X[:, 8] = (X[:, 8] > 0.6).astype(float)  # hazard_category binary
    w = np.array([2.4, 1.6, 2.0, 1.0, 1.7, 1.1, 0.8, 1.2, 1.5])
    s = X @ w + rng.normal(0, 0.6, n)
    q = np.quantile(s, [0.55, 0.8, 0.94])
    y = np.digitize(s, q)  # 0..3
    return X, y


@lru_cache(maxsize=1)
def _model():
    try:
        from sklearn.ensemble import GradientBoostingClassifier

        csv = os.path.join(os.path.dirname(__file__), "weights", "priority_train.csv")
        if os.path.exists(csv):
            import pandas as pd

            df = pd.read_csv(csv)
            X, y = df[_FEATURES].to_numpy(), df["level"].to_numpy()
        else:
            X, y = _synth_dataset()
        clf = GradientBoostingClassifier(n_estimators=150, max_depth=3, random_state=0)
        clf.fit(X, y)
        return clf
    except Exception:
        return None


HAZARD_WORDS = ("live wire", "open manhole", "gas leak", "sinkhole", "collapsed",
                "electric shock", "sparking", "exposed wire", "child", "school",
                "knee deep", "waist deep", "chest deep", "trapped", "swept away",
                "drowning", "person stuck", "car submerged", "no signal at highway")


def compute(*, vision_conf=0.0, detections=0, severity=0.0, text_conf=0.0,
            cluster_size=1, upvotes=0, reporter_trust=0.5, ward_weight=0.5,
            category="Roads", text="") -> PriorityResult:
    feats = np.array([[
        float(vision_conf),
        min(detections, 5) / 5,
        float(severity),
        float(text_conf),
        min(cluster_size, 15) / 15,
        min(upvotes, 30) / 30,
        float(reporter_trust),
        float(ward_weight),
        1.0 if category in ("Flooding", "Electricity", "Safety", "Traffic") else 0.0,
    ]])
    clf = _model()
    overrides: list[str] = []
    if clf is not None:
        proba = clf.predict_proba(feats)[0]
        # pad to 4 classes if the training split missed one
        if len(proba) < 4:
            p = np.zeros(4); p[: len(proba)] = proba; proba = p / p.sum()
        expected = float(np.dot(proba, np.arange(4)))
        level_idx = int(np.argmax(proba))
        method = "model+rules"
        contrib = dict(zip(_FEATURES, np.round(feats[0] * clf.feature_importances_[: len(_FEATURES)]
                                               if hasattr(clf, "feature_importances_") else feats[0], 3)))
    else:
        expected = float(feats[0].mean() * 3)
        level_idx = min(3, int(round(expected)))
        method = "rules"
        contrib = dict(zip(_FEATURES, np.round(feats[0], 3)))

    # ---- rule safety-net: can only raise ----
    tl = text.lower()
    if any(w in tl for w in HAZARD_WORDS):
        if level_idx < 3:
            overrides.append("hazard keyword -> critical")
        level_idx = 3
    if detections >= 2 and vision_conf >= settings.verify_conf_threshold and level_idx < 2:
        overrides.append("2+ confident vision detections -> high")
        level_idx = 2
    if severity >= 0.12 and level_idx < 2:
        overrides.append("severe damage area -> high")
        level_idx = 2

    return PriorityResult(
        level=LEVELS[level_idx],
        score=round(min(1.0, expected / 3), 3),
        method=method,
        contributions={k: float(v) for k, v in contrib.items()},
        rule_overrides=overrides,
    )
