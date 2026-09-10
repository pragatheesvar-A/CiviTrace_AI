"""
Stage 2 — Pothole detector (YOLOv8, trained).

Weights: `keremberke/yolov8m-pothole-segmentation` (single class 'pothole',
trained on a public pothole dataset; see AI_MODELS.md for reported mAP).
Downloaded once into backend/ai/weights/ by scripts/fetch_models.py.

Returns real per-detection confidence, a count of distinct potholes, and a
severity estimate derived from the fraction of frame area covered (segmentation
mask when available, else bounding-box area). Severity + count feed priority.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

from config import settings
from .registry import registry


@dataclass
class Detection:
    confidence: float
    area_ratio: float
    box: list[float]  # x1,y1,x2,y2 normalised


@dataclass
class DetectResult:
    detected: bool
    count: int
    mean_confidence: float
    max_confidence: float
    severity: float               # 0..1 (area covered, capped)
    severity_label: str           # minor | moderate | severe
    detections: list[Detection] = field(default_factory=list)
    method: str = "yolo"
    model_status: str = ""
    model_kind: str = ""          # pothole | generic | none

    def dict(self) -> dict:
        d = asdict(self)
        d["detections"] = [asdict(x) for x in self.detections]
        return d


def _label(sev: float) -> str:
    return "severe" if sev >= 0.12 else "moderate" if sev >= 0.04 else "minor"


def _empty(status: str, kind: str = "none") -> DetectResult:
    return DetectResult(False, 0, 0.0, 0.0, 0.0, "minor", [], "yolo", status, kind)


def detect(path: str) -> DetectResult:
    model, kind = registry.yolo()
    if model is None:
        return _empty("yolo unavailable", "none")
    try:
        import numpy as np
        from PIL import Image

        with Image.open(path) as im:
            W, H = im.convert("RGB").size
        res = model.predict(path, conf=settings.detect_conf_threshold, verbose=False)[0]

        # Which class ids count as "pothole"?
        names = {i: n.lower() for i, n in res.names.items()}
        if kind == "pothole":
            keep_ids = set(names)  # single-class model
        else:
            keep_ids = {i for i, n in names.items() if n in ("pothole", "crack")}

        dets: list[Detection] = []
        frame = float(W * H)
        boxes = res.boxes
        masks = getattr(res, "masks", None)
        for j in range(len(boxes) if boxes is not None else 0):
            cid = int(boxes.cls[j].item())
            if keep_ids and cid not in keep_ids:
                continue
            conf = float(boxes.conf[j].item())
            x1, y1, x2, y2 = (float(v) for v in boxes.xyxy[j].tolist())
            if masks is not None and masks.data is not None and j < len(masks.data):
                area_ratio = float(masks.data[j].sum().item()) / max(
                    1.0, masks.data[j].shape[-1] * masks.data[j].shape[-2]
                )
            else:
                area_ratio = ((x2 - x1) * (y2 - y1)) / frame
            dets.append(Detection(round(conf, 3), round(min(area_ratio, 1.0), 4),
                                  [round(x1 / W, 3), round(y1 / H, 3), round(x2 / W, 3), round(y2 / H, 3)]))

        if not dets:
            return _empty("ok — no potholes found", kind)

        confs = [d.confidence for d in dets]
        severity = min(1.0, sum(d.area_ratio for d in dets))
        status = "ok" if kind == "pothole" else "generic YOLO (no pothole weights) — treat as weak signal"
        return DetectResult(
            detected=True, count=len(dets),
            mean_confidence=round(sum(confs) / len(confs), 3),
            max_confidence=round(max(confs), 3),
            severity=round(severity, 3), severity_label=_label(severity),
            detections=dets, method="yolo", model_status=status, model_kind=kind,
        )
    except Exception as e:  # pragma: no cover
        return _empty(f"yolo error: {e}", kind)
