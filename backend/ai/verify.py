"""
Verification pipeline orchestrator.

Roads + photo  ->  Stage 1 CLIP scene gate  ->  (if pass)  Stage 2 YOLO detector
Other categories / no photo  ->  embedding text classifier (explicitly weaker)

Every verdict records an *evidence chain* (which model, which version, which
score, calibrated vs raw) so an authority can audit why a report was trusted.
Nothing here dispatches resources — it is a decision aid; a human still acts.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from typing import Optional

from config import settings
from . import scene_gate, detector, text_classifier, weather

_MODEL_VERSION = "clip-vitb32/yolov8m-pothole/minilm-l6-v2/open-meteo @ pipeline-v3"


@dataclass
class Verdict:
    verified: bool
    method: str                       # "vision" | "text" | "none"
    confidence: float                 # calibrated, 0..1
    detections: int
    severity: float
    severity_label: str
    category_suggestion: Optional[str]
    evidence: list[dict] = field(default_factory=list)
    note: str = ""
    model_version: str = _MODEL_VERSION
    elapsed_ms: int = 0

    def dict(self) -> dict:
        return asdict(self)


def run(category: str, title: str, description: str, photo_path: Optional[str],
        lat: Optional[float] = None, lng: Optional[float] = None) -> Verdict:
    t0 = time.time()
    text = f"{title}. {description}".strip()
    tc = text_classifier.classify(text)

    use_vision = category in settings.vision_categories and photo_path

    # ---- Flooding: CLIP water-scene gate + independent rainfall correlation ----
    if category == "Flooding":
        scene = scene_gate.check(photo_path, "Flooding") if photo_path else None
        rain = weather.context_for(lat, lng) if (lat is not None and lng is not None) else None
        ev = []
        if scene:
            ev.append({"stage": "scene_gate", "target": "flooding", **scene.dict()})
        if rain:
            ev.append({"stage": "rain_correlation", **rain.dict()})
        scene_p = scene.score if scene else 0.0
        rain_p = rain.rain_factor if rain else 0.35
        # fuse: photo evidence 60%, meteorology 40%
        conf = round(0.6 * scene_p + 0.4 * rain_p, 3)
        verified = conf >= settings.verify_conf_threshold and (scene_p >= 0.4 or rain_p >= 0.6)
        severity = round(min(1.0, 0.35 * scene_p + 0.65 * rain_p), 3)
        sev_label = "severe" if severity >= 0.6 else "moderate" if severity >= 0.35 else "minor"
        bits = []
        if scene: bits.append(f"water-scene {scene_p:.0%}")
        if rain: bits.append(f"rainfall {rain.detail}")
        v = Verdict(
            verified=verified, method="vision" if scene else "text", confidence=conf,
            detections=1 if verified else 0, severity=severity, severity_label=sev_label,
            category_suggestion="Flooding", evidence=ev,
            note="Flooding check — " + "; ".join(bits) + f". Fused confidence {conf:.0%}."
                 + ("" if verified else " Below verification bar — needs corroborating reports."),
        )
        v.elapsed_ms = int((time.time() - t0) * 1000)
        return v

    # ---- Traffic: CLIP signal/junction scene gate ----
    if category == "Traffic" and photo_path:
        scene = scene_gate.check(photo_path, "Traffic")
        ev = [{"stage": "scene_gate", "target": "traffic", **scene.dict()}]
        verified = scene.is_scene and scene.score >= settings.verify_conf_threshold
        v = Verdict(
            verified=verified, method="vision", confidence=round(scene.score, 3),
            detections=1 if verified else 0, severity=0.0,
            severity_label="moderate" if verified else "minor",
            category_suggestion="Traffic", evidence=ev,
            note=(f"Traffic-scene classifier {scene.score:.0%} — image shows a signal / junction."
                  if verified else
                  f"Traffic-scene classifier only {scene.score:.0%}; photo unclear — not verified."),
        )
        v.elapsed_ms = int((time.time() - t0) * 1000)
        return v

    if use_vision:
        scene = scene_gate.check(photo_path, "Roads")
        ev = [{"stage": "scene_gate", **scene.dict()}]
        if not scene.is_scene:
            v = Verdict(
                verified=False, method="vision", confidence=scene.score,
                detections=0, severity=0.0, severity_label="minor",
                category_suggestion=tc.category, evidence=ev,
                note=f"Stage 1 gate failed — photo does not look like a road surface "
                     f"({scene.score:.0%} calibrated). Not marked verified.",
            )
            v.elapsed_ms = int((time.time() - t0) * 1000)
            return v

        det = detector.detect(photo_path)
        ev.append({"stage": "detector", **det.dict()})
        verified = det.detected and det.mean_confidence >= settings.verify_conf_threshold and det.model_kind == "pothole"
        conf = det.mean_confidence if det.detected else scene.score * 0.5
        note = (f"Stage 1 road-scene {scene.score:.0%} -> Stage 2 "
                f"{det.count} pothole(s) @ mean {det.mean_confidence:.0%}, "
                f"severity {det.severity_label}."
                if det.detected else
                f"Stage 1 passed ({scene.score:.0%}) but Stage 2 found no potholes.")
        if det.model_kind != "pothole":
            note += " (No pothole-trained weights loaded — vision result treated as weak.)"
        v = Verdict(
            verified=verified, method="vision", confidence=round(conf, 3),
            detections=det.count, severity=det.severity, severity_label=det.severity_label,
            category_suggestion="Roads", evidence=ev, note=note,
        )
        v.elapsed_ms = int((time.time() - t0) * 1000)
        return v

    # ---- text path ----
    verified = tc.confidence >= 0.62
    v = Verdict(
        verified=verified, method="text", confidence=tc.confidence,
        detections=0, severity=0.0, severity_label="minor",
        category_suggestion=tc.category,
        evidence=[{"stage": "text_classifier", **tc.dict()}],
        note=(f"Text classifier ({tc.method}) → {tc.category} @ {tc.confidence:.0%}. "
              f"No vision model for '{category}' yet — weaker signal than a verified photo."),
    )
    v.elapsed_ms = int((time.time() - t0) * 1000)
    return v
