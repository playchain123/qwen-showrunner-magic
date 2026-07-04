export type LibraryProjectType = "short_film" | "ad_video";

export type LibraryScene = {
  title: string;
  videoUrl?: string;
  audioUrl?: string;
  posterUrl?: string;
  visual?: string;
  location?: string;
  caption?: string;
  spokenLine?: string;
  character?: string;
  shotType?: string;
  language?: string;
  voiceTone?: string;
  pitch?: "low" | "medium" | "high";
  bgm?: string;
  sfx?: string;
  durationSeconds?: number;
  colorGrade?: string;
  editingNotes?: string;
  referenceImageDirection?: string;
};

export type LibraryProject = {
  id: string;
  type: LibraryProjectType;
  title: string;
  createdAt: string;
  updatedAt?: string;
  posterUrl?: string;
  finalVideoUrl?: string;
  sceneVideos?: string[];
  durationSeconds?: number;
  logline?: string;
  genre?: string;
  tone?: string;
  brandName?: string;
  productPitch?: string;
  cta?: string;
  adTone?: string;
  scenes?: LibraryScene[];
  timeline?: LibraryScene[];
  metadata?: Record<string, unknown>;
};

const LIBRARY_KEY = "makers:library";

export function readLibraryProjects() {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
  return parsed.map(normalizeLibraryProject).filter(Boolean) as LibraryProject[];
}

export function saveLibraryProject(project: LibraryProject, limit = 50) {
  const existing = readLibraryProjects();
  const next = [
    project,
    ...existing.filter((item) => !(item.id === project.id && item.type === project.type)),
  ].slice(0, limit);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  return next;
}

function normalizeLibraryProject(raw: Record<string, unknown>): LibraryProject | null {
  const scenes = normalizeScenes(raw.scenes);
  const timeline = normalizeScenes(raw.timeline);
  const typed = raw.type === "ad_video" || raw.type === "short_film";
  const type: LibraryProjectType = typed
    ? raw.type
    : raw.brandName || raw.productPitch || raw.cta || raw.adTone
    ? "ad_video"
    : "short_film";
  const projectScenes = scenes.length ? scenes : timeline;
  const sceneVideos = Array.isArray(raw.sceneVideos)
    ? raw.sceneVideos.filter((url): url is string => typeof url === "string" && url.length > 0)
    : projectScenes.map((scene) => scene.videoUrl).filter((url): url is string => Boolean(url));
  const createdAt = normalizeDate(raw.createdAt);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : `${type}-${createdAt}`;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : type === "ad_video"
      ? `${typeof raw.brandName === "string" && raw.brandName.trim() ? raw.brandName : "Untitled Brand"} Ad`
      : "Untitled Film";

  if (!id || !title) return null;

  return {
    id,
    type,
    title,
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    posterUrl: stringField(raw.posterUrl) || projectScenes.find((scene) => scene.posterUrl)?.posterUrl,
    finalVideoUrl: stringField(raw.finalVideoUrl) || sceneVideos[0],
    sceneVideos,
    durationSeconds:
      typeof raw.durationSeconds === "number"
        ? raw.durationSeconds
        : projectScenes.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0) || undefined,
    logline: stringField(raw.logline),
    genre: stringField(raw.genre),
    tone: stringField(raw.tone),
    brandName: stringField(raw.brandName),
    productPitch: stringField(raw.productPitch),
    cta: stringField(raw.cta),
    adTone: stringField(raw.adTone),
    scenes: projectScenes,
    timeline,
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  };
}

function normalizeScenes(value: unknown): LibraryScene[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((scene) => ({
    title: stringField(scene.title) || "Untitled shot",
    videoUrl: stringField(scene.videoUrl),
    audioUrl: stringField(scene.audioUrl),
    posterUrl: stringField(scene.posterUrl),
    visual: stringField(scene.visual),
    location: stringField(scene.location),
    caption: stringField(scene.caption),
    spokenLine: stringField(scene.spokenLine),
    character: stringField(scene.character),
    shotType: stringField(scene.shotType),
    language: stringField(scene.language),
    voiceTone: stringField(scene.voiceTone),
    pitch: scene.pitch === "low" || scene.pitch === "medium" || scene.pitch === "high" ? scene.pitch : undefined,
    bgm: stringField(scene.bgm),
    sfx: stringField(scene.sfx),
    durationSeconds: typeof scene.durationSeconds === "number" ? scene.durationSeconds : undefined,
    colorGrade: stringField(scene.colorGrade),
    editingNotes: stringField(scene.editingNotes),
    referenceImageDirection: stringField(scene.referenceImageDirection),
  }));
}

function normalizeDate(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
