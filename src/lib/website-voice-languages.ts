export const WEBSITE_VOICE_LANGUAGES = [
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "tamil", label: "Tamil" },
  { value: "malayalam", label: "Malayalam" },
  { value: "telugu", label: "Telugu" },
  { value: "bengali", label: "Bengali" },
  { value: "kannada", label: "Kannada" },
  { value: "marathi", label: "Marathi" },
  { value: "gujarati", label: "Gujarati" },
  { value: "punjabi", label: "Punjabi" },
  { value: "tanglish", label: "Tanglish (Tamil + English)" },
  { value: "hinglish", label: "Hinglish (Hindi + English)" },
  { value: "manglish", label: "Manglish (Malayalam + English)" },
  { value: "benglish", label: "Benglish (Bengali + English)" },
] as const;

export type WebsiteVoiceLanguage = (typeof WEBSITE_VOICE_LANGUAGES)[number]["value"];

export function readWebsiteSpeakerMemory(brand: string, language: string) {
  try {
    const items = JSON.parse(localStorage.getItem("makers:website-speakers") || "{}") as Record<string, string>;
    return items[`${brand}:${language}`] || "";
  } catch {
    return "";
  }
}

export function writeWebsiteSpeakerMemory(brand: string, language: string, speaker: string) {
  try {
    const items = JSON.parse(localStorage.getItem("makers:website-speakers") || "{}") as Record<string, string>;
    items[`${brand}:${language}`] = speaker;
    localStorage.setItem("makers:website-speakers", JSON.stringify(items));
  } catch {
    // ignore storage failures
  }
}

export function buildWebsiteStyleProfile(brand: string, language: string) {
  const style = (() => {
    try {
      const items = JSON.parse(localStorage.getItem("makers:website-style") || "{}") as Record<string, string>;
      return items[brand] || "";
    } catch {
      return "";
    }
  })();
  const speaker = readWebsiteSpeakerMemory(brand, language);
  const register = (() => {
    try {
      const items = JSON.parse(localStorage.getItem("makers:website-register") || "{}") as Record<string, string>;
      return items[`${brand}:${language}`] || "";
    } catch {
      return "";
    }
  })();
  return [style, speaker ? `preferred_speaker_${language}:${speaker}` : "", register ? `preferred_register_${language}:${register}` : ""]
    .filter(Boolean)
    .join(" | ");
}
