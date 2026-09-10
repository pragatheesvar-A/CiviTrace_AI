"""
CIVIA — Civic Intelligence Assistant.

A deliberately **non-generative** assistant: it never free-writes prose. Every
reply is composed from a small reviewed template catalogue, filled only with
values read live from the CivicPulse database. Hallucination is impossible by
construction — the property that matters for a public-sector deployment and the
core novelty claim of this system.

What makes CIVIA more capable than a plain slot-filler:

  * intent + entity extraction on the *first* message, so "report a big pothole
    near Anna Salai" jumps straight to confirmation instead of a 4-question walk;
  * ~14 grounded skills — file, status, explain-priority, area briefing, nearby,
    my-impact, how-to, safety tips, follow-up comment, recurring-spot check …;
  * calibrated intent confidence with a graceful "did you mean" fallback
    (top-2 candidates as quick replies) instead of a flat "out of scope";
  * an evidence-chain explainer that turns the priority model's numeric
    contributions into plain-language reasons.

The FastAPI layer prefetches the DB reads a turn needs and hands CIVIA plain
data; writes (file a report, post a comment) come back as an ``action`` the API
executes.
"""
from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from config import settings
from .text_classifier import classify as classify_text
from .registry import registry

ASSISTANT_NAME = "CIVIA"
ASSISTANT_TAGLINE = "Civic Intelligence Assistant"

CATEGORIES = list(settings.categories)

# --------------------------------------------------------------------------- #
#  Intent catalogue — labelled example utterances (embedded, nearest-neighbour)
# --------------------------------------------------------------------------- #
_INTENTS: dict[str, list[str]] = {
    "report": [
        "i want to report an issue", "there is a pothole", "report a problem",
        "file a complaint", "the streetlight is broken", "garbage not collected",
        "road is damaged", "water logging near my house", "signal not working",
        "raise a new complaint", "log an issue", "new report",
    ],
    "status": [
        "what is the status of my report", "any update on my complaint",
        "track issue 12", "has my pothole been fixed", "status of ticket 4",
        "where is my complaint", "show my reports", "my open issues",
        "whats the status of #1", "status of my report 3", "update on 7",
        "check report 5", "how is my complaint going",
    ],
    "explain": [
        "why is this critical", "why did it get high priority", "explain the priority",
        "how was this verified", "why is the confidence low", "what evidence do you have",
        "how did the ai decide this",
    ],
    "area": [
        "what is the situation in t nagar", "how many issues in mylapore",
        "civic health of this area", "give me an area briefing", "summary for my ward",
        "how bad is my neighbourhood", "situation near me", "situation here",
        "area briefing", "brief me on this area", "overview of my area",
        "how many open issues around here",
    ],
    "nearby": [
        "what issues are near me", "problems in my area", "show nearby complaints",
        "what is happening around here", "issues close to me",
    ],
    "recurring": [
        "is this a recurring problem", "has this happened before here",
        "chronic issue at this spot", "does this keep happening",
    ],
    "impact": [
        "how many points do i have", "my civic score", "what is my rank",
        "how many issues have i reported", "my contribution",
    ],
    "howto": [
        "how do i report flooding", "how does verification work", "how do you check photos",
        "what happens after i report", "how is priority decided", "how do i add a photo",
    ],
    "safety": [
        "is it safe", "safety tips for flooding", "what should i do about a live wire",
        "precautions for open manhole", "how to stay safe near traffic signal",
    ],
    "followup": [
        "add a comment to my report", "post an update on issue 7", "i want to add a note",
        "tell the authority it got worse", "follow up on my complaint",
    ],
    "help": ["what can you do", "help", "how does this work", "who are you", "commands"],
    "cancel": ["cancel", "stop", "never mind", "forget it", "quit", "start over"],
    "affirm": ["yes", "yeah", "correct", "confirm", "that's right", "go ahead", "submit", "file it"],
    "deny": ["no", "nope", "that's wrong", "not correct", "change it", "cancel that"],
    "greet": ["hi", "hello", "hey", "good morning", "namaste", "vanakkam"],
    "thanks": ["thanks", "thank you", "thanks a lot", "great", "appreciate it"],
}

_REJECT_SIM = 0.34
_MAYBE_SIM = 0.42   # between reject and this → offer "did you mean"

# --------------------------------------------------------------------------- #
#  Curated knowledge (reviewed text — never model-generated)
# --------------------------------------------------------------------------- #
_HOWTO = {
    "Roads": "Roads: add a clear photo of the road surface. CIVIA runs a CLIP scene "
             "check, then a YOLOv8 pothole detector — 2+ confident detections or a "
             "large damaged area auto-escalates priority.",
    "Flooding": "Flooding: photo of the standing water + your GPS point. We fuse the "
                "water-scene score with live rainfall (last 24 h + 6 h forecast at "
                "your coordinates). Several nearby reports raise confidence further.",
    "Traffic": "Traffic & signals: photo of the junction/signal. A CLIP classifier "
               "confirms it shows a signal or intersection; multiple reports at the "
               "same junction escalate it as a public-safety issue.",
    "Water": "Water: describe the leak/supply problem and pin the location. Text is "
             "classified by a MiniLM model; nearby corroborating reports strengthen it.",
    "Waste": "Waste: a photo helps. Verified by scene + text classifier; repeat "
             "reports at one bin/spot cluster together and rise up the queue.",
    "Electricity": "Electricity: mention poles/wires/lights and the exact spot. "
                   "Hazard words like 'live wire' or 'sparking' push it to critical "
                   "immediately via the rule safety-net.",
    "Safety": "Safety: open manholes, sharp edges, unsafe stretches. Hazard keywords "
              "and proximity to schools/children raise priority automatically.",
}
_SAFETY = {
    "Flooding": "Do not walk or drive through moving water — 15 cm can knock you down, "
                "30 cm floats a car. Stay away from submerged electrical fittings and "
                "report from a dry vantage point.",
    "Electricity": "Never touch a fallen or sparking wire or anything it contacts. "
                   "Keep 10 m clearance, keep others back, and call the electricity "
                   "board emergency line in parallel with this report.",
    "Traffic": "At a dead signal treat it as an all-way stop. Do not direct traffic "
               "yourself. Report from the footpath, not the carriageway.",
    "Safety": "Mark the hazard if you safely can (a branch, a bag), keep children away, "
              "and note it in the description so responders prioritise it.",
    "Roads": "Photograph from the footpath, facing traffic-aware. For a large cave-in, "
             "warn oncoming vehicles only from a safe position.",
    "Water": "Avoid contact if the water may be mixed with sewage. Report contamination "
             "as urgent so supply can be isolated.",
    "Waste": "Avoid direct contact, especially with medical or construction waste. "
             "Note if it is blocking a road or drain — that raises priority.",
}
_TEMPLATES = {
    "greet": "Namaste — I'm {name}, your {tagline}. I can file a report with you, "
             "track one, explain how the AI graded it, or brief you on any area. "
             "Everything I say comes straight from the CivicPulse database.",
    "help": "Here's what I can do — all grounded in real data:\n"
            "• File a report (I'll pre-fill from what you tell me)\n"
            "• Status of your reports — “status of #7”\n"
            "• Explain a grade — “why is #3 critical?”\n"
            "• Area briefing — “situation in Mylapore”\n"
            "• Issues near you · Recurring-spot check\n"
            "• Your civic impact · How verification works · Safety tips\n"
            "• Add a follow-up note to your report",
    "out_of_scope": "I stick to civic reports and this city's data. Try “report a "
                    "pothole”, “status of my reports”, or “situation near me”.",
    "maybe": "I'm not sure I caught that. Did you mean:",
    "ask_category": "What kind of problem is it?",
    "ask_title": "Give it a short title.",
    "ask_description": "Briefly — what do you see, and how urgent does it feel?",
    "ask_location": "Where is it? A street or landmark (or say “use my location”).",
    "confirm": "Ready to file:\n• Category: {category}\n• Title: {title}\n"
               "• Description: {description}\n• Location: {address}\nShall I submit it?",
    "cancelled": "Cancelled — nothing was filed.",
    "no_reports": "You haven't filed any reports yet.",
    "not_your_report": "I can only show details of reports you filed.",
    "thanks": "Anytime. Your reports make the city measurably better.",
    "filed": "Filed as report #{id} · priority {priority}. {note}",
}


@dataclass
class Session:
    id: str
    state: str = "IDLE"
    slots: dict = field(default_factory=dict)
    last_intent: str = ""
    updated: float = field(default_factory=time.time)


# --------------------------------------------------------------------------- #
_NUM_RE = re.compile(r"#?\s*(\d{1,6})")
_LOC_RE = re.compile(r"\b(?:at|near|on|in|by|opposite|behind)\s+([A-Za-z0-9'\.\- ]{3,60})", re.I)


class Assistant:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._proto = None

    # ------------------------------------------------ intent detection
    def _intent(self, text: str) -> tuple[str, float, list[str]]:
        t = text.strip().lower()
        enc = registry.text_encoder()
        if enc is None:
            for name, ex in _INTENTS.items():
                if any(e in t or t in e for e in ex):
                    return name, 1.0, []
            if any(w in t for w in ("pothole", "garbage", "light", "wire", "drain",
                                    "water", "flood", "signal", "report", "complaint")):
                return "report", 0.6, []
            return "out_of_scope", 0.0, []

        import numpy as np
        if self._proto is None:
            self._proto = {k: enc.encode(v, normalize_embeddings=True) for k, v in _INTENTS.items()}
        q = enc.encode([t], normalize_embeddings=True)[0]
        scored = sorted(
            ((name, float(np.max(mat @ q))) for name, mat in self._proto.items()),
            key=lambda x: -x[1],
        )
        best, best_s = scored[0]
        # a report number in the message strongly disambiguates these skills
        has_num = bool(_NUM_RE.search(t))
        if has_num:
            for n, sc in scored[:3]:
                if n in ("status", "explain", "followup") and sc >= _REJECT_SIM:
                    return n, round(sc, 3), []
        if best_s < _REJECT_SIM:
            return "out_of_scope", round(best_s, 3), []
        if best_s < _MAYBE_SIM:
            cands = [n for n, _ in scored[:2] if n not in ("affirm", "deny", "greet", "thanks")]
            return "maybe", round(best_s, 3), cands
        return best, round(best_s, 3), []

    # ------------------------------------------------ entity extraction
    def _extract(self, text: str) -> dict:
        out: dict = {}
        m = _NUM_RE.search(text)
        if m:
            out["issue_id"] = int(m.group(1))
        tl = text.lower()
        cat = next((c for c in CATEGORIES if c.lower() in tl), None)
        if not cat:
            _kw = {"Roads": ("pothole", "road", "asphalt", "speed breaker"),
                   "Water": ("water pipe", "pipeline", "water supply", "leak", "tap"),
                   "Waste": ("garbage", "trash", "waste", "bin", "dump"),
                   "Electricity": ("streetlight", "street light", "wire", "pole", "transformer", "power cut"),
                   "Safety": ("manhole", "unsafe", "hazard", "sharp", "stray dog"),
                   "Flooding": ("flood", "waterlogg", "water logging", "inundat"),
                   "Traffic": ("signal", "traffic light", "junction")}
            cat = next((c for c, ks in _kw.items() if any(k in tl for k in ks)), None)
        if not cat:
            try:
                tr = classify_text(text)
                if tr.confidence >= 0.4:
                    cat = tr.category
            except Exception:
                pass
        if cat:
            out["category"] = cat
        lm = _LOC_RE.search(text)
        if lm:
            out["address"] = lm.group(1).strip().rstrip(".")
        return out

    # ------------------------------------------------ sessions
    def _session(self, sid: Optional[str]) -> Session:
        now = time.time()
        for k in [k for k, s in self._sessions.items() if now - s.updated > 3600]:
            self._sessions.pop(k, None)
        if sid and sid in self._sessions:
            return self._sessions[sid]
        s = Session(id=sid or uuid.uuid4().hex)
        self._sessions[s.id] = s
        return s

    # ------------------------------------------------ main entry
    def handle(self, *, session_id: Optional[str], text: str, user_id: int,
               ctx: dict) -> dict:
        """`ctx` carries prefetched DB data:
           mine:list, nearby:list, area:dict|None, issue:dict|None (by id in text),
           impact:dict, user_latlng:tuple|None
        """
        s = self._session(session_id)
        s.updated = time.time()
        text = (text or "").strip()
        intent, conf, cands = self._intent(text)
        ent = self._extract(text)

        def reply(msg, quick=None, action=None):
            return {
                "session_id": s.id, "reply": msg, "state": s.state,
                "quick_replies": quick or [], "action": action,
                "intent": intent, "intent_confidence": conf, "assistant": ASSISTANT_NAME,
            }

        if intent == "cancel":
            s.state, s.slots = "IDLE", {}
            return reply(_TEMPLATES["cancelled"], quick=["Report an issue", "My reports", "Help"])

        # ---------------- report slot-filling in progress ----------------
        if s.state == "ASK_CATEGORY":
            cat = ent.get("category") or classify_text(text).category
            s.slots["category"] = cat
            s.state = "ASK_TITLE"
            return reply(f"Got it — {cat}. " + _TEMPLATES["ask_title"])
        if s.state == "ASK_TITLE":
            if len(text) < 3:
                return reply("A few words as a title, please.")
            s.slots["title"] = text[:200]
            s.state = "ASK_DESCRIPTION"
            return reply(_TEMPLATES["ask_description"])
        if s.state == "ASK_DESCRIPTION":
            s.slots["description"] = text[:2000]
            s.state = "ASK_LOCATION"
            return reply(_TEMPLATES["ask_location"], quick=["Use my location"])
        if s.state == "ASK_LOCATION":
            if text.lower() in ("use my location", "my location", "gps", "here") and ctx.get("user_latlng"):
                s.slots["address"] = ent.get("address") or "Current GPS location"
            else:
                s.slots["address"] = text[:255]
            s.state = "CONFIRM"
            return reply(_TEMPLATES["confirm"].format(**{**s.slots, "description": s.slots.get("description", "—")}),
                         quick=["Yes, file it", "No, cancel"])
        if s.state == "CONFIRM":
            if intent == "affirm":
                lat, lng = ctx.get("user_latlng") or (13.0604, 80.2496)
                payload = {**s.slots, "lat": lat, "lng": lng}
                s.state, s.slots = "IDLE", {}
                return reply("Filing now…", action={"type": "create_issue", "payload": payload})
            if intent == "deny":
                s.state, s.slots = "IDLE", {}
                return reply(_TEMPLATES["cancelled"], quick=["Start over", "My reports"])
            return reply("Please answer yes or no.", quick=["Yes, file it", "No, cancel"])

        # ---------------- follow-up comment flow ----------------
        if s.state == "ASK_COMMENT":
            iid = s.slots.get("issue_id")
            s.state, s.slots = "IDLE", {}
            return reply("Adding your note…",
                         action={"type": "add_comment", "issue_id": iid, "body": text[:1000]})

        # ---------------- top-level skills ----------------
        if intent == "maybe":
            pretty = {"report": "File a report", "status": "Check a status",
                      "explain": "Explain a grade", "area": "Area briefing",
                      "nearby": "Issues near me", "impact": "My civic impact",
                      "howto": "How it works", "safety": "Safety tips",
                      "recurring": "Recurring-spot check", "followup": "Add a note"}
            qs = [pretty.get(c, c.title()) for c in cands] or ["Help"]
            return reply(_TEMPLATES["maybe"], quick=qs + ["Something else"])

        if intent == "greet":
            return reply(_TEMPLATES["greet"].format(name=ASSISTANT_NAME, tagline=ASSISTANT_TAGLINE),
                         quick=["Report an issue", "Situation near me", "My impact"])
        if intent == "thanks":
            return reply(_TEMPLATES["thanks"], quick=["Report an issue", "My reports"])
        if intent == "help":
            return reply(_TEMPLATES["help"],
                         quick=["Report an issue", "Situation near me", "How verification works"])

        if intent == "report":
            s.state = "ASK_CATEGORY"
            s.slots = {k: ent[k] for k in ("category", "address") if k in ent}
            if "title" not in s.slots and len(text.split()) >= 4:
                s.slots["title"] = re.sub(r"^\s*(report|file|log|raise|there is|there's)\b[:,]?\s*", "",
                                          text, flags=re.I)[:200] or text[:200]
            # advance past any slot we already extracted
            if s.slots.get("category"):
                s.state = "ASK_TITLE" if "title" not in s.slots else "ASK_DESCRIPTION"
                msg = f"Got it — {s.slots['category']}. "
                msg += _TEMPLATES["ask_description"] if s.state == "ASK_DESCRIPTION" else _TEMPLATES["ask_title"]
                return reply(msg)
            return reply(_TEMPLATES["ask_category"], quick=CATEGORIES)

        if intent == "status":
            iid = ent.get("issue_id")
            mine = ctx.get("mine") or []
            if iid:
                rec = ctx.get("issue")
                if not rec:
                    return reply(f"No report #{iid} found.")
                if rec.get("reporter_id") != user_id:
                    return reply(_TEMPLATES["not_your_report"])
                eta = rec.get("eta_days")
                return reply(
                    f"#{rec['id']} — “{rec['title']}”\n"
                    f"Status: {rec['status']} · priority {rec['priority']}\n"
                    f"AI confidence: {round((rec.get('verification_confidence') or 0)*100)}/100 "
                    f"({rec.get('verification_method')})\n"
                    f"Authenticity: {round((rec.get('authenticity_score') or 0)*100)}/100"
                    + (f"\nEstimated fix: ~{round(eta)} day(s)" if eta else "")
                    + ("\n⚠ Flagged as a recurring / chronic spot." if rec.get("recurrence") else ""),
                    quick=["Explain this grade", "Add a note", "My reports"])
            if not mine:
                return reply(_TEMPLATES["no_reports"], quick=["Report an issue"])
            lines = [f"#{r['id']} {r['title']} — {r['status']} ({r['priority']})" for r in mine[:6]]
            return reply("Your recent reports:\n" + "\n".join(lines),
                         quick=[f"Status of #{mine[0]['id']}", "Report an issue"])

        if intent == "explain":
            rec = ctx.get("issue") or (ctx.get("mine") or [None])[0]
            if not rec:
                return reply("Tell me which report — e.g. “explain #4”.")
            pe = rec.get("priority_explanation") or {}
            contrib = pe.get("contributions") or {}
            top = sorted(contrib.items(), key=lambda kv: -abs(kv[1]))[:3]
            nice = {"vision_conf": "photo detection confidence", "detections": "number of detections",
                    "severity": "size of the damage", "text_conf": "text-classifier confidence",
                    "cluster_size": "how many citizens reported it", "upvotes": "community upvotes",
                    "reporter_trust": "reporter's track record", "ward_weight": "area vulnerability",
                    "hazard_category": "hazard category"}
            reasons = ", ".join(f"{nice.get(k, k)}" for k, v in top if v > 0)
            if not reasons:
                reasons = (f"a verified {rec.get('verification_method', 'photo')} match at "
                           f"{round((rec.get('verification_confidence') or 0)*100)}% confidence"
                           + (f" and {rec.get('detection_count')} detection(s)"
                              if rec.get('detection_count') else "")
                           + (f", plus {rec['cluster_count']} clustered citizen reports"
                              if rec.get('cluster_count', 1) > 1 else ""))
            ov = pe.get("rule_overrides") or []
            msg = (f"#{rec['id']} is **{rec['priority']}** (score {round((rec.get('priority_score') or 0)*100)}/100).\n"
                   f"Method: {pe.get('method', 'model+rules')}.\n"
                   f"Main drivers: {reasons}.")
            if ov:
                msg += "\nRule safety-net: " + "; ".join(ov) + "."
            msg += f"\nVerification: {rec.get('verification_note', '—')}"
            return reply(msg, quick=["My reports", "Situation near me"])

        if intent == "area":
            a = ctx.get("area")
            if not a:
                return reply("I need a place or your location for that — try “situation in <area>”.")
            bc = a.get("by_category") or {}
            hot = sorted(bc.items(), key=lambda kv: -kv[1])[:3]
            hot_s = ", ".join(f"{k} {v}" for k, v in hot if v) or "nothing significant"
            return reply(
                f"Within {a['radius_m']} m of {a.get('label', 'here')}:\n"
                f"• {a['open']} open · {a['resolved']} resolved\n"
                f"• Priority: {a['critical']} critical, {a['high']} high\n"
                f"• Most reported: {hot_s}\n"
                + (f"• Typical fix time here: ~{a['avg_fix_days']} days\n" if a.get("avg_fix_days") else "")
                + (f"• {a['recurring']} chronic/recurring spot(s)" if a.get("recurring") else "• No chronic spots flagged"),
                quick=["Issues near me", "Report an issue"])

        if intent == "nearby":
            items = ctx.get("nearby") or []
            if not ctx.get("user_latlng"):
                return reply("Enable location or name a landmark and I'll list what's reported there.")
            if not items:
                return reply("Nothing reported within ~1.5 km of you right now.")
            lines = [f"• {r['title']} — {r['priority']}, {r['distance_m']} m ({r['status']})" for r in items[:6]]
            return reply("Reported near you:\n" + "\n".join(lines),
                         quick=["Area briefing", "Report an issue"])

        if intent == "recurring":
            items = [r for r in (ctx.get("nearby") or []) if r.get("recurrence")]
            a = ctx.get("area") or {}
            if items:
                return reply("Yes — near you: " + "; ".join(f"“{r['title']}” (#{r['id']})" for r in items[:3])
                             + ". These spots have been fixed before and flagged as chronic.")
            if a.get("recurring"):
                return reply(f"This area has {a['recurring']} spot(s) flagged as recurring — "
                             "problems the city has had to fix more than once here.")
            return reply("No recurring/chronic spots flagged near here right now.")

        if intent == "impact":
            im = ctx.get("impact") or {}
            return reply(
                f"Your civic impact:\n"
                f"• {im.get('points', 0)} points"
                + (f" · rank #{im['rank']}" if im.get("rank") else "") + "\n"
                f"• {im.get('reported', 0)} reports filed · {im.get('resolved', 0)} resolved\n"
                f"• Trust score: {round((im.get('trust') or 0.5)*100)}/100 "
                f"({im.get('valid', 0)} confirmed, {im.get('invalid', 0)} rejected)",
                quick=["My reports", "Report an issue"])

        if intent == "howto":
            cat = ent.get("category")
            if cat and cat in _HOWTO:
                return reply(_HOWTO[cat], quick=["Safety tips", "Report an issue"])
            return reply(
                "After you submit: photo → CLIP scene check → detector/rainfall/text model → "
                "a 0–100 confidence score. In parallel we run duplicate & recurring-spot "
                "detection and an authenticity check (reused-photo, reporter trust, "
                "corroboration). A hybrid model then sets priority, with a rule safety-net "
                "that can only raise it. Ask “how do I report flooding” for a category.",
                quick=[f"How to report {c}" for c in ("Flooding", "Traffic", "Roads")])

        if intent == "safety":
            cat = ent.get("category")
            if cat and cat in _SAFETY:
                return reply(_SAFETY[cat] + "\n\nThis is general guidance — call 112 for an emergency.",
                             quick=["Report an issue", "Emergency help"])
            return reply("Tell me the hazard type — e.g. “safety tips for flooding / live wire / open manhole”.",
                         quick=["Flooding", "Electricity", "Safety"])

        if intent == "followup":
            iid = ent.get("issue_id") or ((ctx.get("mine") or [{}])[0].get("id"))
            if not iid:
                return reply("Which report? e.g. “add a note to #5”.")
            rec = ctx.get("issue")
            if rec and rec.get("reporter_id") != user_id:
                return reply(_TEMPLATES["not_your_report"])
            s.state = "ASK_COMMENT"
            s.slots = {"issue_id": iid}
            return reply(f"What should I add to report #{iid}?")

        return reply(_TEMPLATES["out_of_scope"], quick=["Report an issue", "Situation near me", "Help"])


assistant = Assistant()
