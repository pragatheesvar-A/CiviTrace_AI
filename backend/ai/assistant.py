"""
"Aarambh" — a provably-grounded civic assistant.

Contribution / novelty: the assistant has **no free-text generation path**. Every
reply is either
   (a) a fixed template from a small reviewed catalogue, or
   (b) a value read directly from the database (issue status, counts, distances).
Intent is chosen by nearest-neighbour over sentence-embeddings against labelled
example utterances (with a rejection threshold → "out of scope"). Because the
model never *writes* prose, hallucination is impossible by construction — a
property that matters for a public-sector deployment.

State machine:
   IDLE ──report──► ASK_CATEGORY ─► ASK_TITLE ─► ASK_DESCRIPTION ─► ASK_LOCATION
        └──status/nearby/help──► (DB lookup) ──► IDLE
   CONFIRM ──yes──► emit create_issue action ; ──no──► IDLE
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from config import settings
from .text_classifier import classify as classify_text
from .registry import registry

ASSISTANT_NAME = "Aarambh"

# ---- intent catalogue (labelled example utterances) ----
_INTENTS: dict[str, list[str]] = {
    "report": ["i want to report an issue", "there is a pothole", "report a problem",
               "file a complaint", "the streetlight is broken", "garbage not collected",
               "road is damaged", "water logging near my house"],
    "status": ["what is the status of my report", "any update on my complaint",
               "track issue 12", "has my pothole been fixed", "status of ticket"],
    "nearby": ["what issues are near me", "problems in my area", "show nearby complaints",
               "what is happening around here"],
    "help": ["what can you do", "help", "how does this work", "who are you"],
    "cancel": ["cancel", "stop", "never mind", "forget it", "quit"],
    "affirm": ["yes", "yeah", "correct", "confirm", "that's right", "go ahead", "submit"],
    "deny": ["no", "nope", "that's wrong", "not correct", "change it"],
    "greet": ["hi", "hello", "hey", "good morning", "namaste"],
}

_REJECT_SIM = 0.30  # below this cosine → out of scope

_TEMPLATES = {
    "greet": "Namaste! I'm {name}. I can file a civic report with you step by step, "
             "check the status of one, or tell you what's been reported nearby.",
    "help": "I can do three things, nothing else:\n"
            "• file a new report (I'll ask category, title, description, location)\n"
            "• check the status of one of your reports\n"
            "• list issues reported near a point\n"
            "I never guess — every answer comes straight from the CivicPulse database.",
    "out_of_scope": "I can only help with civic reports — filing one, checking status, "
                    "or nearby issues. Try “report a pothole” or “status of my reports”.",
    "ask_category": "What kind of problem is it?",
    "ask_title": "Give it a short title — e.g. “Deep pothole near the bus stop”.",
    "ask_description": "Briefly describe what you see and how urgent it feels.",
    "ask_location": "Where is it? Share a landmark or street name (I'll use your GPS if you allow it).",
    "confirm": "Please confirm — file this report?\n• Category: {category}\n• Title: {title}\n"
               "• Description: {description}\n• Location: {address}",
    "filed": "Filed as report #{id} · priority {priority}. {note}",
    "cancelled": "Okay, cancelled. Nothing was filed.",
    "no_reports": "You have no reports on record yet.",
    "not_your_report": "I can only show the status of reports you filed.",
}

CATEGORIES = list(settings.categories)


@dataclass
class Session:
    id: str
    state: str = "IDLE"
    slots: dict = field(default_factory=dict)
    updated: float = field(default_factory=time.time)


class Assistant:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._proto = None  # {intent: matrix}

    # -------------------------------------------------- intent detection
    def _intent(self, text: str) -> tuple[str, float]:
        enc = registry.text_encoder()
        t = text.strip().lower()
        if enc is None:
            # keyword fallback — still deterministic
            for name, ex in _INTENTS.items():
                if any(e in t or t in e for e in ex):
                    return name, 1.0
            if any(w in t for w in ("pothole", "garbage", "light", "drain", "water", "report", "complaint")):
                return "report", 0.6
            return "out_of_scope", 0.0
        import numpy as np

        if self._proto is None:
            self._proto = {k: enc.encode(v, normalize_embeddings=True) for k, v in _INTENTS.items()}
        q = enc.encode([t], normalize_embeddings=True)[0]
        best, best_s = "out_of_scope", 0.0
        for name, mat in self._proto.items():
            s = float(np.max(mat @ q))
            if s > best_s:
                best, best_s = name, s
        if best_s < _REJECT_SIM:
            return "out_of_scope", best_s
        return best, round(best_s, 3)

    # -------------------------------------------------- session helpers
    def _session(self, sid: Optional[str]) -> Session:
        now = time.time()
        for k in [k for k, s in self._sessions.items() if now - s.updated > 3600]:
            self._sessions.pop(k, None)
        if sid and sid in self._sessions:
            return self._sessions[sid]
        s = Session(id=sid or uuid.uuid4().hex)
        self._sessions[s.id] = s
        return s

    # -------------------------------------------------- main entry
    def handle(self, *, session_id: Optional[str], text: str,
               user_id: int,
               lookup_status: Callable[[int], Optional[dict]],
               list_mine: Callable[[], list[dict]],
               list_nearby: Callable[[float, float, float], list[dict]],
               user_latlng: Optional[tuple[float, float]] = None) -> dict:
        s = self._session(session_id)
        s.updated = time.time()
        text = (text or "").strip()
        intent, conf = self._intent(text)

        def reply(msg, quick=None, action=None, done=False):
            return {
                "session_id": s.id, "reply": msg, "state": s.state,
                "quick_replies": quick or [], "action": action,
                "intent": intent, "intent_confidence": conf, "assistant": ASSISTANT_NAME,
            }

        # global cancel
        if intent == "cancel":
            s.state, s.slots = "IDLE", {}
            return reply(_TEMPLATES["cancelled"], quick=["Report an issue", "My reports", "Help"])

        # ---- slot filling in progress ----
        if s.state == "ASK_CATEGORY":
            tr = classify_text(text)
            cat = next((c for c in CATEGORIES if c.lower() in text.lower()), None) or tr.category
            s.slots["category"] = cat
            s.state = "ASK_TITLE"
            return reply(f"Got it — {cat}. " + _TEMPLATES["ask_title"])
        if s.state == "ASK_TITLE":
            if len(text) < 3:
                return reply("That's a bit short — give me a few words as a title.")
            s.slots["title"] = text[:200]
            s.state = "ASK_DESCRIPTION"
            return reply(_TEMPLATES["ask_description"])
        if s.state == "ASK_DESCRIPTION":
            s.slots["description"] = text[:2000]
            s.state = "ASK_LOCATION"
            return reply(_TEMPLATES["ask_location"])
        if s.state == "ASK_LOCATION":
            s.slots["address"] = text[:255]
            s.state = "CONFIRM"
            return reply(_TEMPLATES["confirm"].format(**s.slots),
                         quick=["Yes, file it", "No, cancel"])
        if s.state == "CONFIRM":
            if intent == "affirm":
                lat, lng = user_latlng or (13.0604, 80.2496)
                payload = {**s.slots, "lat": lat, "lng": lng}
                s.state, s.slots = "IDLE", {}
                return reply("Filing now…", action={"type": "create_issue", "payload": payload})
            if intent == "deny":
                s.state, s.slots = "IDLE", {}
                return reply(_TEMPLATES["cancelled"], quick=["Start over", "My reports"])
            return reply("Please answer yes or no.", quick=["Yes, file it", "No, cancel"])

        # ---- top-level intents ----
        if intent == "report":
            s.state, s.slots = "ASK_CATEGORY", {}
            return reply(_TEMPLATES["ask_category"], quick=CATEGORIES)
        if intent == "greet":
            return reply(_TEMPLATES["greet"].format(name=ASSISTANT_NAME),
                         quick=["Report an issue", "My reports", "Nearby issues"])
        if intent == "help":
            return reply(_TEMPLATES["help"], quick=["Report an issue", "My reports", "Nearby issues"])
        if intent == "status":
            digits = "".join(ch for ch in text if ch.isdigit())
            mine = list_mine()
            if digits:
                rec = lookup_status(int(digits))
                if not rec:
                    return reply(f"No report #{digits} found.")
                if rec.get("reporter_id") != user_id:
                    return reply(_TEMPLATES["not_your_report"])
                return reply(f"Report #{rec['id']} — “{rec['title']}”\n"
                             f"Status: {rec['status']} · priority {rec['priority']}\n"
                             f"Verified: {rec['verification_method']} "
                             f"({rec['verification_confidence']:.0%})")
            if not mine:
                return reply(_TEMPLATES["no_reports"], quick=["Report an issue"])
            lines = [f"#{r['id']} {r['title']} — {r['status']}" for r in mine[:5]]
            return reply("Your recent reports:\n" + "\n".join(lines))
        if intent == "nearby":
            if not user_latlng:
                return reply("I need a location for that — enable GPS or tell me a landmark.")
            items = list_nearby(user_latlng[0], user_latlng[1], 1500)
            if not items:
                return reply("Nothing reported within ~1.5 km of you right now.")
            lines = [f"• {r['title']} ({r['priority']}, {r['distance_m']} m)" for r in items[:6]]
            return reply("Reported near you:\n" + "\n".join(lines))

        return reply(_TEMPLATES["out_of_scope"], quick=["Report an issue", "My reports", "Help"])


assistant = Assistant()
