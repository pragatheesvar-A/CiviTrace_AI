"""
Spoken-report NLU  (multilingual, heuristic prototype).

Turns a free-text sentence — typed or dictated, in English, Tamil, or
romanised "Tanglish" — into structured report fields:

    category · severity · a short title · a cleaned description · detected language

How it works (kept transparent on purpose):
  * language is guessed from the Unicode block (Tamil vs Latin) + a few marker words;
  * category comes from a multilingual keyword/phrase map, with the existing
    MiniLM text classifier used as a tie-breaker / booster for Latin-script text;
  * severity is a keyword heuristic ("romba", "urgent", "children", "danger", …).

This is NOT a trained model. Speech-to-text itself is done by the browser's
Web Speech API on the device — we never claim an ASR accuracy figure.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Optional

try:
    from .text_classifier import classify as _classify
except Exception:  # pragma: no cover
    _classify = None

MODEL_VERSION = "nlu/multilingual-heuristic-v1 (prototype, device ASR)"

_TAMIL_RE = re.compile("[஀-௿]")          # Tamil block
_DEVANAGARI_RE = re.compile("[ऀ-ॿ]")     # Hindi/Marathi
_TELUGU_RE = re.compile("[ఀ-౿]")
_KANNADA_RE = re.compile("[ಀ-೿]")
_MALAYALAM_RE = re.compile("[ഀ-ൿ]")

# category -> keyword list (english | tamil script | romanised tamil)
_KW: dict[str, list[str]] = {
    "Waste": [
        "garbage", "trash", "rubbish", "waste", "litter", "dump", "dustbin", "bin overflow",
        "sewage smell", "dead animal", "toilet dirty",
        "குப்பை", "கழிவு", "கழிவுநீர்", "கழிப்பறை",
        "kuppai", "kupai", "kuppa", "saakadai", "chakkadai", "kazhivu",
        "कूड़ा", "कचरा", "गंदगी",
    ],
    "Roads": [
        "pothole", "road", "asphalt", "tar road", "speed breaker", "broken road", "road damage",
        "சாலை", "பள்ளம்", "ரோடு",
        "salai", "pallam", "rodu", "road-la pallam", "kuழி",
        "सड़क", "गड्ढा",
    ],
    "Water": [
        "water", "pipeline", "pipe leak", "tap", "drinking water", "water supply", "tanker",
        "no water", "water line", "sewage water",
        "தண்ணீர்", "குழாய்", "கசிவு",
        "thanni", "tanni", "thanneer", "kuzhai", "kuzhaai", "water varala",
        "पानी", "नल", "पाइप लाइन",
    ],
    "Electricity": [
        "street light", "streetlight", "light not working", "current", "power cut", "wire",
        "electric pole", "transformer", "shock", "spark",
        "மின்சாரம்", "விளக்கு", "கம்பம்", "மின்கம்பி",
        "minsaram", "current illa", "light eriyala", "vilakku", "kambam", "kambi",
        "बिजली", "स्ट्रीट लाइट", "खंभा",
    ],
    "Safety": [
        "manhole", "open manhole", "unsafe", "danger", "sharp", "stray dog", "dark", "hazard",
        "collapsed wall", "broken bench",
        "ஆபத்து", "மேன்ஹோல்", "பாதுகாப்பு", "நாய்",
        "aabathu", "aabaththu", "manhole open", "naai", "bayama", "safety illa",
    ],
    "Flooding": [
        "flood", "flooding", "water logging", "waterlogged", "rain water", "inundated",
        "knee deep water", "submerged",
        "வெள்ளம்", "நீர் தேங்கி", "மழைநீர்",
        "vellam", "thanni thengudhu", "thanni nikkudhu", "mazhai neer", "water thengudhu",
    ],
    "Traffic": [
        "traffic signal", "signal", "traffic light", "junction", "intersection", "signal not working",
        "signal off", "traffic jam signal",
        "சிக்னல்", "போக்குவரத்து", "சந்திப்பு",
        "signal velaiseiyala", "signal off", "junction la signal illa",
    ],
}

# severity cue words -> weight
_HIGH = [
    "urgent", "emergency", "danger", "dangerous", "very bad", "serious", "immediately", "accident",
    "children", "child", "school", "hospital", "elderly", "blind", "fell", "injured", "risk",
    "romba", "romba mosam", "romba", "avசரம்", "avasaram", "aabathu", "kuzhandhai", "kuழந்தை",
    "பள்ளி", "மருத்துவமனை", "விபத்து", "ஆபத்து",
    "knee deep", "waist deep", "overflowing everywhere", "spreading",
]
_MED = [
    "bad", "big", "large", "many days", "since", "week", "not collected", "overflow", "leaking",
    "konjam periya", "romba naala", "naala achu", "week aachu", "periya", "adhigama",
    "நிறைய", "பெரிய",
]


@dataclass
class ParsedReport:
    category: str
    severity: str            # low | medium | high
    title: str
    description: str
    language: str            # "ta" | "en" | "ta-Latn" | "mixed"
    confidence: float        # 0..1  (heuristic — how many strong cues were found)
    matched: list            # cue words that fired, for transparency
    model_version: str = MODEL_VERSION

    def dict(self) -> dict:
        return asdict(self)


def detect_language(text: str) -> str:
    for rx, code in ((_TAMIL_RE, "ta"), (_DEVANAGARI_RE, "hi"), (_TELUGU_RE, "te"),
                     (_KANNADA_RE, "kn"), (_MALAYALAM_RE, "ml")):
        if rx.search(text):
            return "mixed" if re.search(r"[a-zA-Z]{3,}", text) else code
    tanglish_markers = ("romba", "kuppai", "kupai", "thanni", "tanni", "illa", "aagudhu",
                        "aidhu", "pannu", "irukku", "nikkudhu", "thengudhu", "aachu",
                        "salai", "vellam", "pallam", "eduka", "velaiseiyala")
    if any(m in text.lower() for m in tanglish_markers):
        return "ta-Latn"
    return "en"


def _score_categories(text: str) -> tuple[dict[str, float], list[str]]:
    t = text.lower()
    scores: dict[str, float] = {c: 0.0 for c in _KW}
    matched: list[str] = []
    for cat, kws in _KW.items():
        for kw in kws:
            if kw.lower() in t:
                scores[cat] += 1.0 + 0.3 * (len(kw.split()) - 1)
                matched.append(kw)
    return scores, matched


def parse(text: str, *, default_category: str = "Roads") -> ParsedReport:
    text = (text or "").strip()
    lang = detect_language(text)
    scores, matched = _score_categories(text)

    # booster: MiniLM classifier for Latin-script input
    if _classify and lang in ("en", "ta-Latn", "mixed"):
        try:
            tc = _classify(text)
            if tc.confidence >= 0.4:
                scores[tc.category] = scores.get(tc.category, 0) + 1.5 * tc.confidence
        except Exception:
            pass

    # disambiguation: standing/rain water on a road is Flooding, not Water(supply)
    tl0 = text.lower()
    flood_cues = ("theng", "logging", "logged", "knee deep", "waist deep", "flood", "vellam",
                  "நீர் தேங்கி", "வெள்ளம்", "மழைநீர்", "rain water", "mazhai", "water nikkudhu",
                  "water thengudhu", "road la thanni")
    if any(c in tl0 for c in flood_cues):
        scores["Flooding"] = scores.get("Flooding", 0) + 2.5
        if "road" in tl0 or "salai" in tl0 or "street" in tl0:
            scores["Flooding"] += 1.0
    # signal/junction words clearly mean Traffic even next to a hazard word
    if any(c in tl0 for c in ("signal", "சிக்னல்", "traffic light", "junction", "சந்திப்")):
        scores["Traffic"] = scores.get("Traffic", 0) + 2.0

    best = max(scores, key=scores.get) if scores else default_category
    top = scores.get(best, 0.0)
    category = best if top > 0 else default_category

    tl = text.lower()
    hi = [w for w in _HIGH if w in tl]
    md = [w for w in _MED if w in tl]
    if hi:
        severity = "high"
    elif md:
        severity = "medium"
    else:
        severity = "medium" if top >= 2 else "low"

    # title = first ~7 words, description = the whole utterance, lightly cleaned
    words = re.sub(r"\s+", " ", text).split()
    title = " ".join(words[:8]).rstrip(".,")
    if not title:
        title = f"{category} issue reported by voice"
    description = text if len(text) > len(title) else text

    conf = min(1.0, 0.25 + 0.2 * top + (0.25 if hi else 0.0) + (0.1 if md else 0.0))

    return ParsedReport(
        category=category, severity=severity, title=title[:200],
        description=description[:2000], language=lang,
        confidence=round(conf, 2), matched=(matched + hi + md)[:8],
    )
