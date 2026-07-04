export type LibraryProjectType = "short_film" | "ad_video" | "website_video";

export type LibraryScene = {
  title: string;
  videoUrl?: string;
  clipUrl?: string;
  audioUrl?: string;
  posterUrl?: string;
  assetStatus?: "pending" | "generating" | "ready" | "failed";
  motionSpec?: Record<string, unknown>;
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
  continuityPrompt?: string;
  critiqueResult?: QualityResult;
  agentTrace?: AgentTraceItem[];
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
  websiteUrl?: string;
  videoType?: string;
  scenes?: LibraryScene[];
  timeline?: LibraryScene[];
  metadata?: Record<string, unknown>;
};

export type QualityResult = {
  prompt_fidelity_score: number;
  continuity_score: number;
  realism_score: number;
  artifact_flags: string[];
  verdict: "accept" | "refine" | "reject";
  refine_instructions: string | null;
};

export type AgentTraceItem = {
  agent: string;
  status: "complete" | "refine" | "failed";
  model?: string;
  latencyMs?: number;
  note?: string;
  critique?: QualityResult;
};

export type GenerationLogEntry = {
  id: string;
  projectId: string;
  projectType: LibraryProjectType;
  projectTitle: string;
  sceneTitle: string;
  sceneSpec: Record<string, unknown>;
  critiqueResult: QualityResult;
  userAction: "accepted" | "regenerated" | "manually_edited" | "rejected";
  createdAt: string;
};

export type StyleProfile = {
  preferredColorGrade?: string;
  preferredShotBias: Record<string, number>;
  preferredPacing: "fast_cut" | "slow_deliberate" | "mixed";
  preferredLightingMood?: string;
  preferredEasingFamily?: string;
  preferredTransitionStyle?: string;
  preferredMotionEnergy: "minimal" | "bold" | "playful";
  preferredCaptureRatio: number;
  rejectionPatterns: Record<string, number>;
  sampleCount: number;
  updatedAt: string;
};

const LIBRARY_KEY = "makers:library";
const GENERATION_LOG_KEY = "makers:generation-log";

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
  appendGenerationLog(project);
  return next;
}

export function readGenerationLogs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GENERATION_LOG_KEY) || "[]") as GenerationLogEntry[];
    return parsed.filter((entry) => entry && typeof entry.id === "string");
  } catch {
    return [];
  }
}

export function writeSceneReview({
  projectId,
  sceneTitle,
  action,
  edits,
}: {
  projectId: string;
  sceneTitle: string;
  action: GenerationLogEntry["userAction"];
  edits?: Record<string, unknown>;
}) {
  const logs = readGenerationLogs();
  const now = new Date().toISOString();
  const updated = logs.map((entry) =>
    entry.projectId === projectId && entry.sceneTitle === sceneTitle
      ? {
          ...entry,
          id: `${entry.id}-${Date.now()}`,
          userAction: action,
          sceneSpec: edits ? { ...entry.sceneSpec, manualEdits: edits } : entry.sceneSpec,
          createdAt: now,
        }
      : entry,
  );
  localStorage.setItem(GENERATION_LOG_KEY, JSON.stringify(updated.slice(-300)));
  return updated;
}

export function buildStyleProfile(logs = readGenerationLogs()): StyleProfile {
  const accepted = logs.filter((entry) => entry.userAction === "accepted" || entry.userAction === "manually_edited");
  const shotCounts: Record<string, number> = {};
  const rejectionPatterns: Record<string, number> = {};
  const gradeCounts: Record<string, number> = {};
  const transitionCounts: Record<string, number> = {};
  const easingCounts: Record<string, number> = {};
  let screenCapture = 0;
  let websiteTotal = 0;

  for (const entry of logs) {
    for (const flag of entry.critiqueResult.artifact_flags || []) {
      rejectionPatterns[flag] = (rejectionPatterns[flag] || 0) + 1;
    }
  }
  for (const entry of accepted) {
    const spec = entry.sceneSpec;
    const shot = stringField(spec.shotType) || stringField(spec.productionMethod) || "cinematic";
    shotCounts[shot] = (shotCounts[shot] || 0) + 1;
    const grade = stringField(spec.colorGrade);
    if (grade) gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
    const transition = stringField(spec.transitionOut) || stringField(spec.editingNotes);
    if (transition) transitionCounts[transition] = (transitionCounts[transition] || 0) + 1;
    const easing = stringField(spec.easingFamily);
    if (easing) easingCounts[easing] = (easingCounts[easing] || 0) + 1;
    if (entry.projectType === "website_video") {
      websiteTotal++;
      if (shot === "screen_capture") screenCapture++;
    }
  }

  const totalShots = Object.values(shotCounts).reduce((sum, count) => sum + count, 0) || 1;
  const preferredShotBias = Object.fromEntries(Object.entries(shotCounts).map(([key, value]) => [key, Number((value / totalShots).toFixed(2))]));
  return {
    preferredColorGrade: mode(gradeCounts),
    preferredShotBias,
    preferredPacing: inferPacing(accepted),
    preferredLightingMood: inferLightingMood(mode(gradeCounts)),
    preferredEasingFamily: mode(easingCounts),
    preferredTransitionStyle: mode(transitionCounts),
    preferredMotionEnergy: inferMotionEnergy(accepted),
    preferredCaptureRatio: websiteTotal ? Number((screenCapture / websiteTotal).toFixed(2)) : 0,
    rejectionPatterns,
    sampleCount: accepted.length,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLibraryProject(raw: Record<string, unknown>): LibraryProject | null {
  const scenes = normalizeScenes(raw.scenes);
  const timeline = normalizeScenes(raw.timeline);
  const typed = raw.type === "ad_video" || raw.type === "short_film" || raw.type === "website_video";
  const type: LibraryProjectType = typed
    ? raw.type
    : raw.websiteUrl || raw.videoType
    ? "website_video"
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
      : type === "website_video"
      ? `${typeof raw.websiteUrl === "string" && raw.websiteUrl.trim() ? raw.websiteUrl : "Website"} Video`
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
    websiteUrl: stringField(raw.websiteUrl),
    videoType: stringField(raw.videoType),
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
    clipUrl: stringField(scene.clipUrl),
    audioUrl: stringField(scene.audioUrl),
    posterUrl: stringField(scene.posterUrl),
    assetStatus: normalizeAssetStatus(scene.assetStatus),
    motionSpec: isRecord(scene.motionSpec) ? scene.motionSpec : undefined,
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
    continuityPrompt: stringField(scene.continuityPrompt),
    critiqueResult: isQualityResult(scene.critiqueResult) ? scene.critiqueResult : undefined,
    agentTrace: Array.isArray(scene.agentTrace) ? scene.agentTrace.filter(isRecord).map(normalizeTrace) : undefined,
  }));
}

function normalizeAssetStatus(value: unknown): LibraryScene["assetStatus"] {
  return value === "pending" || value === "generating" || value === "ready" || value === "failed" ? value : undefined;
}

function appendGenerationLog(project: LibraryProject) {
  try {
    const existing = readGenerationLogs();
    const scenes = [...(project.scenes || []), ...(project.timeline && !project.scenes?.length ? project.timeline : [])];
    const now = new Date().toISOString();
    const next: GenerationLogEntry[] = scenes.map((scene, index) => {
      const critique = scene.critiqueResult || createDefaultCritique(project, scene);
      return {
        id: `${project.id}-${index}-${Date.now()}`,
        projectId: project.id,
        projectType: project.type,
        projectTitle: project.title,
        sceneTitle: scene.title,
        sceneSpec: {
          title: scene.title,
          visual: scene.visual,
          shotType: scene.shotType,
          colorGrade: scene.colorGrade,
          editingNotes: scene.editingNotes,
          productionMethod: scene.shotType,
          transitionOut: scene.editingNotes,
          durationSeconds: scene.durationSeconds,
          hasVideo: Boolean(scene.videoUrl),
          hasAudio: Boolean(scene.audioUrl),
          continuityPrompt: scene.continuityPrompt,
        },
        critiqueResult: critique,
        userAction: critique.verdict === "accept" ? "accepted" : "regenerated",
        createdAt: now,
      };
    });
    localStorage.setItem(GENERATION_LOG_KEY, JSON.stringify([...existing, ...next].slice(-300)));
  } catch {
    // learning log is best-effort
  }
}

function createDefaultCritique(project: LibraryProject, scene: LibraryScene): QualityResult {
  const artifactFlags = [
    !scene.visual && !scene.videoUrl ? "missing_visual_spec" : "",
    project.type !== "website_video" && !scene.videoUrl ? "missing_rendered_video" : "",
    !scene.spokenLine && !scene.caption ? "missing_voice_line" : "",
  ].filter(Boolean);
  const promptScore = scene.visual || scene.videoUrl ? 0.88 : 0.68;
  const continuityScore = scene.continuityPrompt || project.metadata?.visualBible || project.metadata?.websiteVideoPlan ? 0.9 : 0.78;
  const realismScore = scene.videoUrl || project.type === "website_video" ? 0.86 : 0.76;
  const accept = promptScore >= 0.8 && continuityScore >= 0.8 && realismScore >= 0.8 && artifactFlags.length === 0;
  return {
    prompt_fidelity_score: promptScore,
    continuity_score: continuityScore,
    realism_score: realismScore,
    artifact_flags: artifactFlags,
    verdict: accept ? "accept" : "refine",
    refine_instructions: accept ? null : `Repair ${artifactFlags.join(", ") || "quality gap"} before final delivery.`,
  };
}

function isQualityResult(value: unknown): value is QualityResult {
  if (!isRecord(value)) return false;
  return typeof value.prompt_fidelity_score === "number" &&
    typeof value.continuity_score === "number" &&
    typeof value.realism_score === "number" &&
    Array.isArray(value.artifact_flags) &&
    (value.verdict === "accept" || value.verdict === "refine" || value.verdict === "reject");
}

function normalizeTrace(value: Record<string, unknown>): AgentTraceItem {
  return {
    agent: stringField(value.agent) || "Agent",
    status: value.status === "failed" || value.status === "refine" ? value.status : "complete",
    model: stringField(value.model),
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : undefined,
    note: stringField(value.note),
    critique: isQualityResult(value.critique) ? value.critique : undefined,
  };
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

function mode(counts: Record<string, number>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function inferPacing(logs: GenerationLogEntry[]): StyleProfile["preferredPacing"] {
  const avgDuration = logs.reduce((sum, entry) => sum + (typeof entry.sceneSpec.durationSeconds === "number" ? entry.sceneSpec.durationSeconds : 0), 0) / Math.max(1, logs.length);
  if (avgDuration && avgDuration <= 6) return "fast_cut";
  if (avgDuration >= 12) return "slow_deliberate";
  return "mixed";
}

function inferLightingMood(grade?: string) {
  if (!grade) return undefined;
  if (/dark|noir|shadow|thriller/i.test(grade)) return "low-key cinematic";
  if (/warm|gold|sunset|amber/i.test(grade)) return "warm motivated";
  if (/clean|white|minimal|product/i.test(grade)) return "clean commercial";
  return grade;
}

function inferMotionEnergy(logs: GenerationLogEntry[]): StyleProfile["preferredMotionEnergy"] {
  const hasLaunch = logs.some((entry) => /launch|hook|cta|wipe|fast/i.test(`${entry.projectTitle} ${entry.sceneSpec.editingNotes || ""}`));
  const hasManual = logs.some((entry) => /manual|guide|chapter|steady/i.test(`${entry.projectTitle} ${entry.sceneSpec.editingNotes || ""}`));
  if (hasLaunch) return "bold";
  if (hasManual) return "minimal";
  return "playful";
}
