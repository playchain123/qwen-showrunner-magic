export type TTSProvider = "qwen3-tts-instruct-flash" | "sarvam-bulbul-v3";

export type TTSRoute = {
  provider: TTSProvider;
  normalizedLanguage: string;
  languageCode?: string;
  isCodeSwitched: boolean;
};

export type LocalizationResult = {
  beat_id: string;
  target_language: string;
  localized_script: string;
  script_notes: string;
  register: "formal" | "conversational" | "casual_slang";
};

export type RegionalAuthenticityCritique = {
  naturalness_score: number;
  code_switch_quality: number | null;
  issues: string[];
  verdict: "accept" | "revise";
  revision_note: string | null;
};

const QWEN_SUPPORTED = new Set([
  "chinese",
  "english",
  "japanese",
  "korean",
  "german",
  "french",
  "russian",
  "portuguese",
  "spanish",
  "italian",
]);

const SARVAM_LANGUAGE_CODES: Record<string, string> = {
  tamil: "ta-IN",
  hindi: "hi-IN",
  malayalam: "ml-IN",
  telugu: "te-IN",
  bengali: "bn-IN",
  kannada: "kn-IN",
  marathi: "mr-IN",
  gujarati: "gu-IN",
  punjabi: "pa-IN",
  odia: "od-IN",
  assamese: "as-IN",
  urdu: "ur-IN",
  tanglish: "ta-IN",
  hinglish: "hi-IN",
  manglish: "ml-IN",
  benglish: "bn-IN",
};

const LANGUAGE_ALIASES: Record<string, string> = {
  "en": "english",
  "en-us": "english",
  "en-in": "english",
  "ta": "tamil",
  "ta-in": "tamil",
  "hi": "hindi",
  "hi-in": "hindi",
  "ml": "malayalam",
  "ml-in": "malayalam",
  "te": "telugu",
  "te-in": "telugu",
  "bn": "bengali",
  "bn-in": "bengali",
  "kn": "kannada",
  "kn-in": "kannada",
  "mr": "marathi",
  "mr-in": "marathi",
  "gu": "gujarati",
  "gu-in": "gujarati",
  "pa": "punjabi",
  "pa-in": "punjabi",
  "ur": "urdu",
  "ur-in": "urdu",
};

const CODE_SWITCHED = new Set(["tanglish", "hinglish", "manglish", "benglish"]);

export function normalizeTargetLanguage(language: string | undefined | null) {
  const raw = (language || "english").toLowerCase().trim();
  const compact = raw.replace(/[_\s]+/g, "-");
  return LANGUAGE_ALIASES[compact] || compact.replace(/-/g, "");
}

export function resolveTTSProvider(targetLanguage: string | undefined | null): TTSRoute {
  const normalizedLanguage = normalizeTargetLanguage(targetLanguage);
  if (QWEN_SUPPORTED.has(normalizedLanguage)) {
    return { provider: "qwen3-tts-instruct-flash", normalizedLanguage, isCodeSwitched: false };
  }
  const languageCode = SARVAM_LANGUAGE_CODES[normalizedLanguage];
  if (languageCode) {
    return {
      provider: "sarvam-bulbul-v3",
      normalizedLanguage,
      languageCode,
      isCodeSwitched: CODE_SWITCHED.has(normalizedLanguage),
    };
  }
  throw new Error(`No TTS route configured for language: ${targetLanguage || "unknown"}`);
}

export function chooseSarvamSpeaker(language: string, tone = "", pitch: "low" | "medium" | "high" = "medium") {
  const lower = `${language} ${tone} ${pitch}`.toLowerCase();
  if (/male|man|father|brother|hero|villain|low|deep/.test(lower)) return "arjun";
  if (/young|bright|high|energetic|playful/.test(lower)) return "anushka";
  return "meera";
}

export function inferRegister(tone = ""): LocalizationResult["register"] {
  const lower = tone.toLowerCase();
  if (/formal|corporate|enterprise|official/.test(lower)) return "formal";
  if (/slang|youth|funny|casual|street|viral/.test(lower)) return "casual_slang";
  return "conversational";
}

export function buildLocalizationPrompt({
  beatId,
  sourceLine,
  targetLanguage,
  brandVoiceTone,
  clientStyleProfile = "",
}: {
  beatId: string;
  sourceLine: string;
  targetLanguage: string;
  brandVoiceTone: string;
  clientStyleProfile?: string;
}) {
  return [
    "You are the Localization Script Compiler.",
    "Produce a line a real native speaker would actually say out loud, not a literal translation.",
    `beat_id: ${beatId}`,
    `target_language: ${targetLanguage}`,
    `brand_voice_tone: ${brandVoiceTone}`,
    `client_style_profile: ${clientStyleProfile || "none"}`,
    `source_vo_line: ${sourceLine}`,
    "",
    "Rules for code-switched modes such as tanglish, hinglish, manglish, benglish:",
    "- Keep brand/product names, technical/business terms, numbers, and common product UI words in English.",
    "- Use the regional language for connectors, verbs, emotion, emphasis, and natural spoken rhythm.",
    "- Do not split the line into separate English and regional lines.",
    "- Do not produce 100% fully translated text in a code-switched mode.",
    "",
    "Rules for pure regional languages:",
    "- Use the native script by default unless the style profile clearly prefers romanized text.",
    "- Avoid textbook/literary phrasing unless the register is formal.",
    "- Keep claims exactly aligned with source_vo_line.",
    "",
    "Return ONLY strict JSON:",
    '{"beat_id":string,"target_language":string,"localized_script":string,"script_notes":string,"register":"formal"|"conversational"|"casual_slang"}',
  ].join("\n");
}

export function critiqueRegionalScript({
  localizedScript,
  targetLanguage,
  register,
  sourceLine,
}: {
  localizedScript: string;
  targetLanguage: string;
  register: LocalizationResult["register"];
  sourceLine: string;
}): RegionalAuthenticityCritique {
  const language = normalizeTargetLanguage(targetLanguage);
  const isCodeSwitched = CODE_SWITCHED.has(language);
  const issues: string[] = [];
  const asciiWords = localizedScript.match(/[A-Za-z][A-Za-z0-9'-]*/g) || [];
  const sourceBrandish = sourceLine.match(/[A-Z][A-Za-z0-9'-]*/g) || [];
  const hasRegionalScript = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(localizedScript);
  if (isCodeSwitched) {
    if (asciiWords.length === 0) issues.push("code-switched script retained no English brand or product terms");
    if (!hasRegionalScript && !/[a-z]+(da|la|hai|ho|che|alle|illa|pann|kar|karo|aanu)\b/i.test(localizedScript)) {
      issues.push("code-switched script has no clear regional phrasing");
    }
  }
  if (!isCodeSwitched && language !== "english" && !hasRegionalScript) {
    issues.push("regional language script is romanized; verify this is intentional");
  }
  if (register !== "formal" && /(therefore|hence|moreover|consequently|utilize|endeavour)/i.test(localizedScript)) {
    issues.push("textbook-formal phrasing in conversational register");
  }
  if (sourceBrandish.length > 0 && !sourceBrandish.some((term) => localizedScript.includes(term))) {
    issues.push("brand or product term may have been translated or dropped");
  }
  const naturalness_score = Math.max(0.55, 0.94 - issues.length * 0.16);
  const code_switch_quality = isCodeSwitched ? Math.max(0.5, 0.9 - issues.length * 0.2) : null;
  return {
    naturalness_score: Number(naturalness_score.toFixed(2)),
    code_switch_quality: code_switch_quality == null ? null : Number(code_switch_quality.toFixed(2)),
    issues,
    verdict: naturalness_score >= 0.8 && issues.length === 0 ? "accept" : "revise",
    revision_note: issues.length ? issues.join("; ") : null,
  };
}
