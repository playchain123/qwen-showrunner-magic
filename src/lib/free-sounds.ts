// Free, license-friendly hosted audio for cinematic BGM and SFX beds.
// SoundHelix explicitly permits hotlinking their example MP3s for demos.
// Pixabay/Mixkit CDN links are ambient beds released under Content License.
export type ScoreMood =
  | "cinematic"
  | "dramatic"
  | "action"
  | "emotional"
  | "ambient"
  | "hopeful"
  | "tech"
  | "luxury"
  | "thriller";

export type ScoreProfile = {
  mood: ScoreMood;
  label: string;
  url: string;
};

export const FREE_BGM: Record<ScoreMood, string[]> = {
  cinematic: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3",
  ],
  dramatic: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
  ],
  action: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",
  ],
  emotional: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3",
  ],
  ambient: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3",
  ],
  hopeful: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3",
  ],
  tech: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3",
  ],
  luxury: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3",
  ],
  thriller: [
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
  ],
};

export function pickBgm(mood?: string): string {
  return pickScoreProfile(mood).url;
}

export function pickScoreProfile(input?: string): ScoreProfile {
  const source = input || "";
  const mood = classifyScoreMood(source);
  const choices = FREE_BGM[mood] || FREE_BGM.cinematic;
  return {
    mood,
    label: scoreLabel(mood),
    url: choices[stableIndex(source || mood, choices.length)],
  };
}

export function buildScoreBrief(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(" | ");
}

function classifyScoreMood(input: string): ScoreMood {
  const s = input.toLowerCase();
  if (/luxury|premium|elegant|refined|gold|fashion|beauty|perfume|watch/.test(s)) return "luxury";
  if (/tech|software|startup|saas|ai|developer|code|app|platform|productivity|dashboard/.test(s)) return "tech";
  if (/action|chase|fight|battle|escape|war|race|fast|sports|energetic|punchy|hype/.test(s)) return "action";
  if (/thriller|dark|noir|horror|spy|espionage|mystery|danger|suspense|crime/.test(s)) return "thriller";
  if (/hope|inspir|dream|breakthrough|success|interview|opportunity|motivat|uplift/.test(s)) return "hopeful";
  if (/emotion|sad|love|tender|family|heart|tear|warm|personal|human/.test(s)) return "emotional";
  if (/calm|ambient|soft|meditative|nature|dream|quiet/.test(s)) return "ambient";
  if (/dramatic|cinematic|epic|intense/.test(s)) return "dramatic";
  return "cinematic";
}

function scoreLabel(mood: ScoreMood) {
  const labels: Record<ScoreMood, string> = {
    cinematic: "Cinematic orchestral bed",
    dramatic: "Dramatic film score",
    action: "Action pulse score",
    emotional: "Emotional piano strings",
    ambient: "Ambient atmospheric bed",
    hopeful: "Hopeful inspirational score",
    tech: "Modern tech pulse",
    luxury: "Premium luxury score",
    thriller: "Suspense thriller bed",
  };
  return labels[mood];
}

function stableIndex(value: string, length: number) {
  if (length <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

export const FREE_SFX = {
  whoosh: "https://cdn.pixabay.com/audio/2022/03/15/audio_5f92c4321f.mp3",
  impact: "https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73467.mp3",
};
