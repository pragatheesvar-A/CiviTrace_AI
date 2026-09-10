"""
Evidence Trust Score + Multimodal Consistency  (heuristic prototype).

This module fuses the signals CivicPulse can actually observe about a report
into two citizen-facing outputs:

  * Evidence Trust Score (0-100) — how well the attached evidence supports the
    claim.  Signals: photo relevance (CLIP scene gate), text↔image consistency
    (classifier agreement), GPS/location plausibility, timestamp sanity,
    reused-image detection (perceptual hash), nearby corroborating reports, and
    a sensor cross-check when a relevant sensor value is available.

  * Multimodal Consistency (HIGH / MEDIUM / LOW) — whether those channels agree
    with each other, with plain-language conflict reasons.

Design rules (important for the research prototype and for fairness):
  * Nothing here is a trained classifier — it is a transparent weighted rule
    system.  Weights are hand-set, NOT tuned on a labelled set.  Treat every
    number as "Not Yet Measured".
  * The system never auto-rejects a citizen for AI uncertainty.  Low trust or
    low consistency routes the report to the Human Review Queue instead.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

MODEL_VERSION = "evidence-trust/heuristic-v1 (prototype, not measured)"

# weights sum to 1.0 — hand-set, not learned
_W = {
    "photo_relevance": 0.26,
    "text_image": 0.16,
    "gps": 0.16,
    "timestamp": 0.06,
    "novel_image": 0.14,
    "nearby_support": 0.12,
    "sensor": 0.10,
}


@dataclass
class EvidenceResult:
    trust_score: int                       # 0-100
    verdict: str                           # "trusted" | "needs_human_review"
    consistency: str                       # "high" | "medium" | "low"
    checklist: list[dict] = field(default_factory=list)   # {key,label,status,detail}
    conflicts: list[str] = field(default_factory=list)
    recommended_action: str = "auto_accept"   # auto_accept | human_review | request_more_evidence
    model_version: str = MODEL_VERSION
    note: str = ""

    def dict(self) -> dict:
        return asdict(self)


def _row(key, label, status, detail=""):
    return {"key": key, "label": label, "status": status, "detail": detail}


def assess(
    *,
    has_photo: bool,
    scene_pass: Optional[bool],
    scene_score: float = 0.0,
    detections: int = 0,
    text_agrees: Optional[bool] = None,
    novel_image: Optional[bool] = None,
    gps_provided: bool = True,
    gps_plausible: Optional[bool] = None,
    address_matches: Optional[bool] = None,
    timestamp_ok: bool = True,
    nearby_support: int = 0,
    reporter_trust: float = 0.5,
    sensor: Optional[dict] = None,          # {"type","value","unit","supports": bool|None}
) -> EvidenceResult:
    checklist: list[dict] = []
    conflicts: list[str] = []
    parts: dict[str, float] = {}

    # ---- photo relevance -------------------------------------------------
    if has_photo:
        if scene_pass is True:
            parts["photo_relevance"] = min(1.0, 0.7 + 0.3 * scene_score)
            checklist.append(_row("photo_relevance", "Photo matches the reported issue",
                                  "pass", f"scene match {round(scene_score * 100)}%"
                                  + (f", {detections} object(s) detected" if detections else "")))
        elif scene_pass is False:
            parts["photo_relevance"] = 0.15
            checklist.append(_row("photo_relevance", "Photo may not match the reported issue",
                                  "warn", f"scene match only {round(scene_score * 100)}%"))
            conflicts.append("Photo does not clearly show the reported type of problem")
        else:
            parts["photo_relevance"] = 0.5
            checklist.append(_row("photo_relevance", "Photo relevance not assessed",
                                  "info", "no vision model for this category"))
    else:
        parts["photo_relevance"] = 0.35
        checklist.append(_row("photo_relevance", "No photo attached",
                              "info", "text-only report — weaker evidence, still accepted"))

    # ---- text <-> image consistency ------------------------------------
    if text_agrees is None:
        parts["text_image"] = 0.5
        checklist.append(_row("text_image", "Text/description consistency not assessed", "info"))
    elif text_agrees:
        parts["text_image"] = 1.0
        checklist.append(_row("text_image", "Description matches the evidence", "pass"))
    else:
        parts["text_image"] = 0.2
        checklist.append(_row("text_image", "Description may not match the evidence", "warn",
                              "classifier disagrees with the chosen category"))
        conflicts.append("Written description does not clearly match the photo / category")

    # ---- GPS / location ----------------------------------------------------
    if not gps_provided:
        parts["gps"] = 0.4
        checklist.append(_row("gps", "Location not shared precisely", "info"))
    else:
        loc_ok = (gps_plausible is not False) and (address_matches is not False)
        if loc_ok:
            parts["gps"] = 1.0 if (gps_plausible and address_matches) else 0.8
            checklist.append(_row("gps", "Location is consistent", "pass"))
        else:
            parts["gps"] = 0.25
            checklist.append(_row("gps", "Location looks inconsistent", "warn",
                                  "coordinates and stated address disagree"
                                  if address_matches is False else "coordinates look implausible"))
            conflicts.append("Reported location is inconsistent with the coordinates")

    # ---- timestamp -------------------------------------------------------
    parts["timestamp"] = 1.0 if timestamp_ok else 0.3
    checklist.append(_row("timestamp", "Report time is plausible" if timestamp_ok
                          else "Report timestamp looks unusual",
                          "pass" if timestamp_ok else "warn",
                          "photo-embedded capture time is not read yet (Not Yet Measured)"))

    # ---- reused / duplicate image --------------------------------------
    if not has_photo:
        parts["novel_image"] = 0.5
    elif novel_image is False:
        parts["novel_image"] = 0.0
        checklist.append(_row("novel_image", "Possible reused / duplicate image", "warn",
                              "near-identical to an image already in the system"))
        conflicts.append("Photo appears to be a reused or duplicated image")
    else:
        parts["novel_image"] = 1.0
        checklist.append(_row("novel_image", "No suspicious duplicate evidence", "pass"))

    # ---- nearby corroboration ----------------------------------------
    ns = min(nearby_support, 3) / 3
    parts["nearby_support"] = 0.4 + 0.6 * ns
    if nearby_support > 0:
        checklist.append(_row("nearby_support", f"{nearby_support} nearby report(s) support this",
                              "pass"))
    else:
        checklist.append(_row("nearby_support", "No other nearby reports yet", "info"))

    # ---- sensor cross-check (Prototype: rainfall only) ---------------
    if sensor and sensor.get("supports") is not None:
        if sensor["supports"]:
            parts["sensor"] = 1.0
            checklist.append(_row("sensor", f"{sensor.get('type', 'sensor').title()} data supports the report",
                                  "pass", f"{sensor.get('value')}{sensor.get('unit', '')} (Prototype)"))
        else:
            parts["sensor"] = 0.2
            checklist.append(_row("sensor", f"{sensor.get('type', 'sensor').title()} data does not support the report",
                                  "warn", f"{sensor.get('value')}{sensor.get('unit', '')} (Prototype)"))
            conflicts.append(f"{sensor.get('type', 'Sensor').title()} reading does not support the report")
    else:
        parts["sensor"] = 0.5
        checklist.append(_row("sensor", "No relevant sensor available", "info",
                              "sensor integration is Simulated / Prototype"))

    # small reporter-history nudge (does not dominate)
    trust = 0.0
    for k, w in _W.items():
        trust += w * parts.get(k, 0.5)
    trust = 0.9 * trust + 0.1 * max(0.0, min(1.0, reporter_trust))
    score = int(round(max(0.0, min(1.0, trust)) * 100))

    # ---- consistency verdict ----------------------------------------
    hard_conflict = any(
        c.startswith(("Photo does not", "Written description", "Reported location")) for c in conflicts
    )
    if len(conflicts) >= 2 or hard_conflict:
        consistency = "low"
    elif conflicts:
        consistency = "medium"
    else:
        consistency = "high"

    needs_review = (
        score < 45
        or consistency == "low"
        or (has_photo and scene_pass is False)
        or (novel_image is False)
    )
    verdict = "needs_human_review" if needs_review else "trusted"
    if needs_review:
        rec = "request_more_evidence" if (not has_photo and score < 40) else "human_review"
    else:
        rec = "auto_accept"

    note = (
        "Evidence looks consistent." if verdict == "trusted"
        else "Evidence is uncertain — routed to human review (the citizen is not penalised)."
    )
    return EvidenceResult(
        trust_score=score, verdict=verdict, consistency=consistency,
        checklist=checklist, conflicts=conflicts, recommended_action=rec, note=note,
    )
