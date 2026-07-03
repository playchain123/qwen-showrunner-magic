// Free, license-friendly hosted audio for cinematic BGM and SFX beds.
// SoundHelix explicitly permits hotlinking their example MP3s for demos.
// Pixabay/Mixkit CDN links are ambient beds released under Content License.
export const FREE_BGM: Record<string, string[]> = {
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
};

export function pickBgm(mood?: string): string {
  const s = (mood || "").toLowerCase();
  if (/action|chase|fight|battle|epic/.test(s)) return random(FREE_BGM.action);
  if (/emotion|sad|love|tender|hope/.test(s)) return random(FREE_BGM.emotional);
  if (/thriller|dark|dramatic|noir|horror/.test(s)) return random(FREE_BGM.dramatic);
  if (/calm|ambient|soft|meditative|dream/.test(s)) return random(FREE_BGM.ambient);
  return random(FREE_BGM.cinematic);
}
function random<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export const FREE_SFX = {
  whoosh: "https://cdn.pixabay.com/audio/2022/03/15/audio_5f92c4321f.mp3",
  impact: "https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73467.mp3",
};