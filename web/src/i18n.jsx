// Lightweight i18n — the reporting flow + voice UI are localised.
// (Full-app translation is out of scope for the prototype; strings not in the
//  dictionary fall back to English.)
import { getLang } from "./api.jsx";

const STRINGS = {
  "en-IN": {},
  "ta-IN": {
    "Report": "புகார்",
    "An Issue.": "ஒரு பிரச்சினை.",
    "Submit issue": "புகாரை சமர்ப்பி",
    "Submitting…": "சமர்ப்பிக்கிறது…",
    "Photo": "புகைப்படம்", "Details": "விவரங்கள்", "Place": "இடம்", "Review": "சரிபார்",
    "What kind of problem?": "என்ன வகையான பிரச்சினை?",
    "Title": "தலைப்பு",
    "Description": "விவரம்",
    "Where is it?": "இது எங்கே?",
    "Use GPS": "GPS பயன்படுத்து",
    "Add a photo of the problem": "பிரச்சினையின் புகைப்படத்தைச் சேர்",
    "Speak your report": "உங்கள் புகாரைப் பேசுங்கள்",
    "Listening…": "கேட்கிறது…",
    "Tap the mic and describe the problem": "மைக்கைத் தட்டி பிரச்சினையை விவரிக்கவும்",
    "We understood": "நாங்கள் புரிந்துகொண்டது",
    "Category": "வகை", "Severity": "தீவிரம்",
    "low": "குறைவு", "medium": "நடுத்தரம்", "high": "அதிகம்",
    "Language": "மொழி",
    "Roads": "சாலைகள்", "Water": "தண்ணீர்", "Waste": "கழிவு", "Electricity": "மின்சாரம்",
    "Safety": "பாதுகாப்பு", "Flooding": "வெள்ளம்", "Traffic": "போக்குவரத்து",
  },
};

export function t(key) {
  const l = getLang();
  return (STRINGS[l] && STRINGS[l][key]) || key;
}
