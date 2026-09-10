"""
AI Resolution Verification  (heuristic prototype).

When an authority uploads an AFTER photo, this compares it with the BEFORE
evidence and produces a Resolution Confidence (0-100) plus a plain checklist:

  ✓ Same location            (report coordinates unchanged; authority-supplied)
  ✓ Original problem detected before   (the BEFORE photo passed the vision gate /
                                        detector for this category)
  ✓ Problem reduced / removed after    (AFTER photo: fewer / no detections, or a
                                        clearly different frame)
  ✓ After evidence is relevant         (AFTER photo passes the scene gate)

Honesty: this is NOT a trained "is-it-fixed" model. It is a transparent rule
combination over the existing CLIP scene gate, the YOLO detector and a
perceptual-hash difference. Confidence numbers are illustrative — "Not Yet
Measured". Low confidence -> Human Review, never an automatic close.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

MODEL_VERSION = "resolution-verify/heuristic-v1 (prototype, not measured)"


@dataclass
class ResolutionResult:
    confidence: int                        # 0-100
    status: str                            # "ai_verified" | "needs_human_review" | "not_fixed"
    same_location: bool
    problem_before: bool
    problem_after: bool
    after_relevant: bool
    checklist: list[dict] = field(default_factory=list)
    note: str = ""
    model_version: str = MODEL_VERSION

    def dict(self) -> dict:
        return asdict(self)


def _row(label, ok, detail=""):
    return {"label": label, "status": "pass" if ok else "warn", "detail": detail}


def verify(
    *,
    category: str,
    same_location: bool,
    before_scene_pass: Optional[bool],
    before_detections: int,
    after_scene_pass: Optional[bool],
    after_detections: int,
    frames_identical: bool,
    after_scene_score: float = 0.0,
) -> ResolutionResult:
    checklist: list[dict] = []

    checklist.append(_row("Same location", same_location,
                          "authority confirmed the fix is at the report's coordinates"
                          if same_location else "location not confirmed"))

    problem_before = bool(before_scene_pass) or before_detections > 0
    checklist.append(_row("Original problem detected before", problem_before,
                          f"{before_detections} detection(s) in the original photo"
                          if before_detections else "before-photo passed the scene check"
                          if before_scene_pass else "no strong before-evidence on record"))

    # "problem reduced / removed after"
    if frames_identical:
        problem_after_gone = False
        after_detail = "AFTER photo is near-identical to the BEFORE photo"
    elif before_detections > 0:
        problem_after_gone = after_detections < before_detections
        after_detail = f"detections {before_detections} → {after_detections}"
    else:
        problem_after_gone = not bool(after_scene_pass) or after_detections == 0
        after_detail = "no defect detected in the AFTER photo"
    checklist.append(_row("Problem reduced / removed after", problem_after_gone, after_detail))

    after_relevant = bool(after_scene_pass) and not frames_identical
    checklist.append(_row("After evidence is relevant", after_relevant,
                          f"AFTER photo scene match {round(after_scene_score * 100)}%"
                          if after_scene_pass else "AFTER photo did not pass the scene check"))

    passed = sum(1 for c in checklist if c["status"] == "pass")
    confidence = int(round(100 * passed / len(checklist)))
    # weight the two decisive checks a little
    if not problem_after_gone:
        confidence = min(confidence, 40)
    if frames_identical:
        confidence = min(confidence, 20)

    if not problem_after_gone and not after_relevant:
        status = "not_fixed"
        note = "The AFTER evidence does not show the problem being resolved."
    elif confidence >= 70 and problem_after_gone and after_relevant and same_location:
        status = "ai_verified"
        note = "AFTER evidence is consistent with the problem being resolved."
    else:
        status = "needs_human_review"
        note = "Resolution evidence is unclear — a human reviewer should confirm."

    return ResolutionResult(
        confidence=confidence, status=status, same_location=same_location,
        problem_before=problem_before, problem_after=not problem_after_gone,
        after_relevant=after_relevant, checklist=checklist, note=note,
    )
