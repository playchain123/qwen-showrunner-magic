import type { LibraryProjectType } from "./library";

// §2.2 — Continuity-embedding math. Used by quality-gate.ts to decide
// whether a newly generated hero frame matches the stored character
// reference well enough to accept, or should trigger a refine pass.
export const CONTINUITY_THRESHOLD = 0.82;

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function needsContinuityRefine(current: number[], reference: number[]): boolean {
  return cosineSimilarity(current, reference) < CONTINUITY_THRESHOLD;
}

export type VisualBible = {
  projectType: LibraryProjectType;
  visualStyle: string;
  colorPalette: string;
  lightingStyle: string;
  cameraLanguage: string;
  worldDescription: string;
  continuityRules: string[];
  characters: CharacterContinuityBible[];
  products?: ProductBible[];
};

export type CharacterContinuityBible = {
  id: string;
  name: string;
  ageRange: string;
  genderPresentation: string;
  faceDescription: string;
  hairstyle: string;
  bodyType: string;
  wardrobe: string;
  keyAccessories: string;
  emotionalBaseline: string;
  voiceStyle: string;
  negativeIdentityRules: string[];
};

export type ProductBible = {
  id: string;
  name: string;
  category: string;
  shape: string;
  color: string;
  material: string;
  logoPlacement?: string;
  distinctiveFeatures: string;
  usageRules: string[];
};

type StoryScene = {
  title?: string;
  visual?: string;
  dialogue?: string;
  spoken_line?: string;
  caption?: string;
  video_prompt?: string;
  image_prompt?: string;
  character?: string;
  location?: string;
  color_grade?: string;
  voice_tone?: string;
  duration_seconds?: number;
  reference_image_direction?: string;
  shot_type?: string;
  editing_notes?: string;
};

type ReferenceBrief = { name: string; description?: string };
type BrandAssetBrief = { kind: "product" | "logo" | "model"; name: string };

export type ReferenceType = "character_face" | "full_character" | "style_mood" | "location" | "wardrobe" | "prop";

export type CompiledReference = {
  id: string;
  name: string;
  reference_type: ReferenceType;
  description: string;
  usable_for: {
    character_lock: boolean;
    color_grade_seed: boolean;
    lighting_seed: boolean;
    environment_seed: boolean;
    wardrobe_lock: boolean;
    prop_lock: boolean;
  };
  suggested_injection_points: string[];
  suggested_reference_weight: number;
  risk_flags: string[];
};

export type ProductionPlan = {
  director: {
    core_emotional_beat: string;
    memorable_image: string;
  };
  camera: {
    shot_type: string;
    angle: string;
    lens_mm: number;
    movement: string;
    line_note: string;
  };
  lighting: {
    key_source: string;
    direction_relative_to_camera: string;
    quality: "hard" | "soft" | "mixed";
    color_temp_k: number;
  };
  color: {
    primary_correction_target: string;
    creative_grade: string;
    reference_used: string | null;
  };
  edit: {
    cut_in: "hard" | "J-cut" | "L-cut" | "match-cut" | "dissolve";
    cut_out: "hard" | "J-cut" | "L-cut" | "match-cut" | "dissolve";
    pacing_note: string;
  };
  vfx: {
    required: boolean;
    technique: string | null;
    plate_or_element: string | null;
    compositing_notes: string | null;
  };
  sound: {
    ambience_bed: string;
    hard_effects: string[];
    music_cue: string | null;
    dialogue_ducking_needed: boolean;
  };
  cg_3d: {
    required: boolean;
    matched_lens_mm: number | null;
    matched_lighting_notes: string | null;
  };
};

export type OptimizedScenePrompt = {
  scene_id: string;
  axes: {
    subject_state: string;
    action_vector: string;
    optics: string;
    light_transport: string;
    material_response: string;
    color_science: string;
    entropy_budget: string;
    failure_modes_preempted: string[];
  };
  continuity: {
    character_token: string | null;
    wardrobe_token: string | null;
    product_token: string | null;
    reference_image_weight: number;
    embedding_check_required: boolean;
  };
  references: CompiledReference[];
  production_plan: ProductionPlan;
  positive_prompt: string;
  negative_prompt: string;
  self_critique: {
    fidelity: number;
    realism: number;
    novelty: number;
    revised_after_critique: boolean;
  };
};

export const CONTINUITY_NEGATIVE_PROMPT = [
  "different actor",
  "changed face",
  "changed hairstyle",
  "changed age",
  "changed wardrobe",
  "different product",
  "changed logo",
  "inconsistent character",
  "duplicate person",
  "deformed face",
  "extra fingers",
  "blurry",
  "low quality",
  "black frame",
  "watermark",
  "random text",
  "scene reset",
].join(", ");

export function validateAndRepairScenes<T extends StoryScene>(
  scenes: T[],
  bible: VisualBible,
  defaultDuration: number,
) {
  const mainCharacter = bible.characters[0];
  const mainProduct = bible.products?.[0];
  return scenes.map((scene, index) => {
    const visual = scene.visual || scene.video_prompt || scene.image_prompt || `${bible.worldDescription}, scene ${index + 1}`;
    const spokenLine = normalizeVoiceLine(scene.spoken_line || scene.dialogue || scene.caption, bible.projectType);
    const character = bible.projectType === "short_film"
      ? scene.character || mainCharacter?.name || "Lead character"
      : scene.character || mainProduct?.name || "Hero product";
    const videoPrompt = [
      scene.video_prompt || visual,
      bible.projectType === "short_film"
        ? "Use the same character identity from the Visual Bible. Do not change face, age, hairstyle, body type, wardrobe, or accessories."
        : "Use the same product identity from the Product Bible. Do not change product shape, logo placement, color, packaging, material, or brand appearance.",
      `Continuity context: ${bible.worldDescription}. ${bible.colorPalette}. ${bible.lightingStyle}.`,
    ].join("\n");

    return {
      ...scene,
      title: scene.title || `Scene ${index + 1}`,
      visual,
      character,
      spoken_line: spokenLine,
      dialogue: spokenLine,
      caption: scene.caption || spokenLine,
      video_prompt: videoPrompt,
      image_prompt: scene.image_prompt || visual,
      duration_seconds: Number.isFinite(scene.duration_seconds ?? NaN) ? scene.duration_seconds : defaultDuration,
      reference_image_direction:
        scene.reference_image_direction ||
        (bible.projectType === "short_film"
          ? "Match the Visual Bible character identity exactly."
          : "Match the Product Bible identity exactly."),
    };
  });
}

export function buildOptimizedScenePrompt({
  scene,
  bible,
  sceneIndex,
  sceneCount,
  previousVisual,
  nextVisual,
  referenceWeight = 0.75,
  references = [],
  userStyleProfile = "",
}: {
  scene: StoryScene;
  bible: VisualBible;
  sceneIndex: number;
  sceneCount: number;
  previousVisual?: string;
  nextVisual?: string;
  referenceWeight?: number;
  references?: CompiledReference[];
  userStyleProfile?: string;
}): OptimizedScenePrompt {
  const character = findCharacterBible(bible, scene.character);
  const product = bible.products?.[0];
  const sceneText = [
    scene.title,
    scene.visual,
    scene.video_prompt,
    scene.location,
    scene.reference_image_direction,
    scene.editing_notes,
  ].filter(Boolean).join(" ");
  const subjectState = bible.projectType === "ad_video" && product
    ? `${product.name} locked as hero product: ${product.shape}; ${product.color}; ${product.material}; ${product.distinctiveFeatures}; positioned for a clear commercial reveal.`
    : character
      ? `${formatCharacterLock(character)}; pose and expression follow the scene action without changing identity.`
      : `Primary subject follows the Visual Bible identity lock; pose and expression: ${scene.character || scene.visual || "story lead"}.`;
  const actionVector = inferActionVector(sceneText);
  const optics = inferOptics(scene.shot_type, sceneText, bible.cameraLanguage);
  const lightTransport = `${bible.lightingStyle}; key source is motivated by the scene location, with secondary bounce light from ${inferBounceSource(sceneText)} so shadows keep physical depth.`;
  const materialResponse = bible.projectType === "ad_video" && product
    ? `${product.material} shows controlled specular highlights, edge reflections, true product scale, and no warped packaging or logo drift.`
    : `${character?.wardrobe || "wardrobe fabric"} shows fabric weave and fold logic; skin keeps natural micro-texture and subsurface warmth; practical surfaces catch believable grazing highlights.`;
  const styleReference = references.find((ref) => ref.usable_for.color_grade_seed || ref.usable_for.lighting_seed);
  const colorScience = scene.color_grade
    ? `${scene.color_grade}; highlights roll off before clipping, shadows keep detail, midtones preserve skin/product color identity.`
    : `${bible.colorPalette}; highlights roll off before clipping, shadows keep detail, midtone contrast supports continuity${styleReference ? `, informed by reference ${styleReference.name}` : ""}.`;
  const entropyBudget = inferEntropyBudget(sceneText);
  const failureModes = buildFailureModes(scene, bible, Boolean(character), Boolean(product));
  const continuity = buildContinuityState({
    bible,
    character,
    product,
    previousVisual,
    nextVisual,
    referenceWeight,
  });
  const effectiveReferenceWeight = references.length
    ? Math.max(continuity.reference_image_weight, ...references.map((ref) => ref.suggested_reference_weight))
    : continuity.reference_image_weight;
  continuity.reference_image_weight = Number(Math.min(0.95, effectiveReferenceWeight).toFixed(2));
  const identityRule = bible.projectType === "ad_video"
    ? "Use the same product identity from the Product Bible. Do not change product shape, logo placement, color, packaging, material, or brand appearance."
    : "Use the same character identity from the Visual Bible. Do not change face, age, hairstyle, body type, wardrobe, or accessories.";
  const novelty = inferNoveltyInjection(sceneIndex, sceneText, bible.projectType);
  const productionPlan = buildProductionPlan({
    scene,
    bible,
    sceneIndex,
    sceneCount,
    previousVisual,
    nextVisual,
    references,
    userStyleProfile,
    optics,
    colorScience,
    lightTransport,
  });
  const positivePrompt = [
    `Scene ${sceneIndex + 1} of ${sceneCount}: ${scene.visual || scene.video_prompt || scene.title}.`,
    formatProductionPlan(productionPlan),
    references.length ? `Reference routing: ${formatReferenceRouting(references)}` : "",
    identityRule,
    `Subject state: ${subjectState}`,
    `Action vector: ${actionVector}`,
    `Optics: ${optics}`,
    `Light transport: ${lightTransport}`,
    `Material response: ${materialResponse}`,
    `Color science: ${colorScience}`,
    `Controlled imperfection: ${entropyBudget}`,
    `Novel motivated deviation: ${novelty}`,
    previousVisual ? `Match incoming continuity from previous shot: ${previousVisual}` : "",
    nextVisual ? `End motion should lead into next shot: ${nextVisual}` : "",
    scene.spoken_line ? `Lip-sync exactly to this short line with natural delivery: "${scene.spoken_line}"` : "",
    "No black frames, no fade to black, no title card, no watermark, seamless edit-ready plate.",
  ].filter(Boolean).join(" ");

  return {
    scene_id: slugId(scene.title || `scene-${sceneIndex + 1}`),
    axes: {
      subject_state: subjectState,
      action_vector: actionVector,
      optics,
      light_transport: lightTransport,
      material_response: materialResponse,
      color_science: colorScience,
      entropy_budget: entropyBudget,
      failure_modes_preempted: failureModes,
    },
    continuity,
    references,
    production_plan: productionPlan,
    positive_prompt: positivePrompt,
    negative_prompt: unique([...failureModes, ...CONTINUITY_NEGATIVE_PROMPT.split(", ")]).join(", "),
    self_critique: {
      fidelity: 0.92,
      realism: 0.9,
      novelty: 0.86,
      revised_after_critique: false,
    },
  };
}

export function formatOptimizedScenePrompt(optimized: OptimizedScenePrompt, purpose: "image" | "video") {
  return [
    `OPTIMIZED ${purpose.toUpperCase()} PROMPT`,
    optimized.positive_prompt,
    formatProductionPlan(optimized.production_plan),
    optimized.references.length ? `Reference routing: ${formatReferenceRouting(optimized.references)}` : "",
    `Axes: subject=${optimized.axes.subject_state}; action=${optimized.axes.action_vector}; optics=${optimized.axes.optics}; light=${optimized.axes.light_transport}; material=${optimized.axes.material_response}; color=${optimized.axes.color_science}; entropy=${optimized.axes.entropy_budget}.`,
    `Continuity tokens: character=${optimized.continuity.character_token || "none"}; wardrobe=${optimized.continuity.wardrobe_token || "none"}; product=${optimized.continuity.product_token || "none"}; reference_image_weight=${optimized.continuity.reference_image_weight}.`,
    `Negative prompt: ${optimized.negative_prompt}`,
  ].filter(Boolean).join("\n");
}

export function compileReferenceImages(references: ReferenceBrief[]): CompiledReference[] {
  return references.map((reference, index) => compileReference({
    id: `ref-${index + 1}`,
    name: reference.name,
    description: reference.description || "",
  }));
}

export function compileBrandAssetReferences(assets: BrandAssetBrief[]): CompiledReference[] {
  return assets.map((asset, index) => compileReference({
    id: `${asset.kind}-${index + 1}`,
    name: asset.name,
    description:
      asset.kind === "product"
        ? "uploaded product reference for prop and product identity lock"
        : asset.kind === "logo"
          ? "uploaded brand logo reference for product/logo lock"
          : "uploaded brand talent reference for full character identity lock",
    forcedType: asset.kind === "product" || asset.kind === "logo" ? "prop" : "full_character",
  }));
}

export function formatReferenceRouting(references: CompiledReference[]) {
  return references.map((ref) => {
    const uses = [
      ref.usable_for.character_lock ? "character_lock" : "",
      ref.usable_for.color_grade_seed ? "color_grade_seed" : "",
      ref.usable_for.lighting_seed ? "lighting_seed" : "",
      ref.usable_for.environment_seed ? "environment_seed" : "",
      ref.usable_for.wardrobe_lock ? "wardrobe_lock" : "",
      ref.usable_for.prop_lock ? "prop_lock" : "",
    ].filter(Boolean).join("/");
    return `${ref.name}: ${ref.reference_type}, weight ${ref.suggested_reference_weight}, use ${uses || "context only"}, inject ${ref.suggested_injection_points.join("+")}${ref.risk_flags.length ? `, risks ${ref.risk_flags.join("/")}` : ""}`;
  }).join(" | ");
}

export function buildShortFilmVisualBible({
  prompt,
  title,
  tone,
  scenes,
  references,
}: {
  prompt: string;
  title: string;
  tone: string;
  scenes: StoryScene[];
  references: ReferenceBrief[];
}): VisualBible {
  const colorPalette = firstMeaningful(scenes.map((scene) => scene.color_grade), `${tone || "cinematic"} unified film grade`);
  const worldDescription = [
    title,
    prompt,
    unique(scenes.map((scene) => scene.location).filter(Boolean) as string[]).join(", "),
  ].filter(Boolean).join(" - ");
  const characters = buildCharactersFromScenes(scenes, references);

  return {
    projectType: "short_film",
    visualStyle: `${tone || "dramatic"} grounded cinematic short film, realistic human performances, one coherent production design`,
    colorPalette,
    lightingStyle: inferLighting(`${prompt} ${tone} ${colorPalette}`),
    cameraLanguage: "35mm cinematic language with motivated camera moves, connected eyelines, match cuts, and no random angle changes",
    worldDescription,
    continuityRules: [
      "Treat every shot as part of one film, not separate generated clips.",
      "Keep each named character's face, age, body type, hairstyle, wardrobe, accessories, and emotional baseline identical in every scene.",
      "Keep locations geographically connected with matching weather, time of day, color grade, and production design.",
      "Use storyboard stills as the canonical identity plate before animation.",
      "No character swaps, no wardrobe resets, no unexplained lighting changes, no random new props.",
      "Every video prompt must preserve the previous shot's visual state and lead naturally into the next shot.",
    ],
    characters,
  };
}

export function buildAdVisualBible({
  brand,
  pitch,
  toneLabel,
  toneDescription,
  assets,
  scenes,
}: {
  brand: string;
  pitch: string;
  toneLabel: string;
  toneDescription: string;
  assets: BrandAssetBrief[];
  scenes: StoryScene[];
}): VisualBible {
  const productAssets = assets.filter((asset) => asset.kind === "product");
  const modelAssets = assets.filter((asset) => asset.kind === "model");
  const logoAssets = assets.filter((asset) => asset.kind === "logo");
  const products: ProductBible[] = [
    {
      id: slugId(brand || "product"),
      name: brand || "Hero product",
      category: pitch || "advertised product",
      shape: "preserve the uploaded/reference product silhouette exactly; if no upload exists, use one consistent hero-product silhouette",
      color: inferProductColor(`${brand} ${pitch} ${toneDescription}`),
      material: inferProductMaterial(pitch),
      logoPlacement: logoAssets.length ? "subtle, consistent, readable logo placement from uploaded logo reference" : "no random logo placement unless visible in reference",
      distinctiveFeatures: productAssets.length
        ? `Match uploaded product references: ${productAssets.map((asset) => asset.name).join(", ")}`
        : `Create one distinctive ${brand || "brand"} product identity and repeat it exactly.`,
      usageRules: [
        "Product shape, color, material, logo placement, and scale must remain identical in every shot.",
        "Do not invent alternate product versions, extra logos, different packaging, or changed colors.",
        "Every shot must either show the hero product clearly or preserve its world/brand context.",
      ],
    },
  ];

  return {
    projectType: "ad_video",
    visualStyle: `${toneLabel} cinematic commercial, premium product continuity, one connected campaign film`,
    colorPalette: firstMeaningful(scenes.map((scene) => scene.color_grade), `${toneLabel} brand palette; ${toneDescription}`),
    lightingStyle: inferLighting(`${toneLabel} ${toneDescription}`),
    cameraLanguage: "commercial-grade product cinematography with clean hero reveals, consistent lensing, smooth motion, and edit-ready match cuts",
    worldDescription: `${brand} campaign world - ${pitch} - ${toneDescription}`,
    continuityRules: [
      "Treat this as one brand film, not isolated ad clips.",
      "The hero product must keep the exact same silhouette, color, material, logo, and scale across every shot.",
      "Talent, hands, wardrobe, set styling, and lighting must remain consistent where repeated.",
      "Use the storyboard/product still as the canonical plate before animation.",
      "No random packaging swaps, color changes, fake logos, distorted product geometry, or sudden location style changes.",
    ],
    characters: modelAssets.length
      ? modelAssets.map((asset, index) => buildCharacter(`talent-${index + 1}`, asset.name, "brand talent", scenes[index]))
      : [],
    products,
  };
}

export function formatVisualBible(bible: VisualBible) {
  const characters = bible.characters.map((character) => [
    `${character.name} (${character.id})`,
    `age/gender: ${character.ageRange}, ${character.genderPresentation}`,
    `face: ${character.faceDescription}`,
    `hair/body: ${character.hairstyle}; ${character.bodyType}`,
    `wardrobe/accessories: ${character.wardrobe}; ${character.keyAccessories}`,
    `voice/emotion: ${character.voiceStyle}; ${character.emotionalBaseline}`,
    `never: ${character.negativeIdentityRules.join("; ")}`,
  ].join(" | ")).join("\n");
  const products = (bible.products || []).map((product) => [
    `${product.name} (${product.id})`,
    `category: ${product.category}`,
    `shape/color/material: ${product.shape}; ${product.color}; ${product.material}`,
    product.logoPlacement ? `logo: ${product.logoPlacement}` : "",
    `features: ${product.distinctiveFeatures}`,
    `rules: ${product.usageRules.join("; ")}`,
  ].filter(Boolean).join(" | ")).join("\n");

  return [
    `VISUAL BIBLE`,
    `Project type: ${bible.projectType}`,
    `Visual style: ${bible.visualStyle}`,
    `Color palette: ${bible.colorPalette}`,
    `Lighting: ${bible.lightingStyle}`,
    `Camera: ${bible.cameraLanguage}`,
    `World: ${bible.worldDescription}`,
    `Global continuity rules: ${bible.continuityRules.join(" ")}`,
    characters ? `Character identity locks:\n${characters}` : "",
    products ? `Product identity locks:\n${products}` : "",
  ].filter(Boolean).join("\n");
}

export function formatSceneContinuity({
  bible,
  sceneCharacter,
  previousVisual,
  nextVisual,
}: {
  bible: VisualBible;
  sceneCharacter?: string;
  previousVisual?: string;
  nextVisual?: string;
}) {
  const character = findCharacterBible(bible, sceneCharacter);
  return [
    formatVisualBible(bible),
    character ? `ACTIVE CHARACTER LOCK: ${formatCharacterLock(character)}` : "",
    "Use the same character identity from the Visual Bible. Do not change face, age, hairstyle, body type, wardrobe, or accessories.",
    previousVisual ? `MATCH FROM PREVIOUS SHOT: ${previousVisual}` : "",
    nextVisual ? `MOTION LEADS INTO NEXT SHOT: ${nextVisual}` : "",
    `SHARED NEGATIVE PROMPT: ${CONTINUITY_NEGATIVE_PROMPT}`,
    "Generate a continuity-safe plate: same identity, same wardrobe/product state, same grade, no black frames, no fade to black, no title card, no watermark.",
  ].filter(Boolean).join("\n");
}

export function formatProductContinuity(bible: VisualBible) {
  const product = bible.products?.[0];
  if (!product) return formatVisualBible(bible);
  return [
    formatVisualBible(bible),
    `ACTIVE PRODUCT LOCK: ${product.name}; ${product.shape}; ${product.color}; ${product.material}; ${product.distinctiveFeatures}`,
    "Use the same product identity from the Product Bible. Do not change product shape, logo placement, color, packaging, material, or brand appearance.",
    `PRODUCT NEGATIVE RULES: ${product.usageRules.join(" ")}`,
    `SHARED NEGATIVE PROMPT: ${CONTINUITY_NEGATIVE_PROMPT}`,
  ].join("\n");
}

export function findCharacterBible(bible: VisualBible, name?: string) {
  if (!name) return undefined;
  const normalized = name.toLowerCase();
  return bible.characters.find((character) =>
    normalized.includes(character.name.toLowerCase()) || character.name.toLowerCase().includes(normalized),
  );
}

export function formatCharacterLock(character: CharacterContinuityBible) {
  return [
    `${character.name}: ${character.ageRange}, ${character.genderPresentation}`,
    character.faceDescription,
    character.hairstyle,
    character.bodyType,
    character.wardrobe,
    character.keyAccessories,
    `voice: ${character.voiceStyle}`,
    `never change: ${character.negativeIdentityRules.join("; ")}`,
  ].join(" | ");
}

function compileReference({
  id,
  name,
  description,
  forcedType,
}: {
  id: string;
  name: string;
  description: string;
  forcedType?: ReferenceType;
}): CompiledReference {
  const text = `${name} ${description}`.toLowerCase();
  const referenceType = forcedType || inferReferenceType(text);
  const riskFlags = inferReferenceRisks(text);
  const cappedForWatermark = riskFlags.includes("watermark_present");
  const weight = cappedForWatermark ? 0.6 : referenceWeightForType(referenceType);
  const usableFor = {
    character_lock: referenceType === "character_face" || referenceType === "full_character",
    color_grade_seed: referenceType === "style_mood",
    lighting_seed: referenceType === "style_mood" || referenceType === "location",
    environment_seed: referenceType === "location",
    wardrobe_lock: referenceType === "wardrobe" || referenceType === "full_character",
    prop_lock: referenceType === "prop",
  };
  const injectionPoints = [
    usableFor.character_lock ? "cinematographer.continuity_anchor" : "",
    usableFor.character_lock ? "video_producer.i2v_reference_frame" : "",
    usableFor.color_grade_seed ? "colorist.creative_grade" : "",
    usableFor.lighting_seed ? "cinematographer.lighting_mood" : "",
    usableFor.environment_seed ? "cinematographer.environment" : "",
    usableFor.wardrobe_lock ? "continuity.wardrobe_token" : "",
    usableFor.prop_lock ? "subject.action_prop_lock" : "",
  ].filter(Boolean);

  return {
    id,
    name,
    reference_type: referenceType,
    description: [
      description || `Reference image ${name} classified as ${referenceType}.`,
      cappedForWatermark ? "Avoid reproducing the watermark region." : "",
    ].filter(Boolean).join(" "),
    usable_for: usableFor,
    suggested_injection_points: injectionPoints.length ? injectionPoints : ["production.context_only"],
    suggested_reference_weight: weight,
    risk_flags: riskFlags,
  };
}

function buildProductionPlan({
  scene,
  bible,
  sceneIndex,
  sceneCount,
  previousVisual,
  nextVisual,
  references,
  userStyleProfile,
  optics,
  colorScience,
  lightTransport,
}: {
  scene: StoryScene;
  bible: VisualBible;
  sceneIndex: number;
  sceneCount: number;
  previousVisual?: string;
  nextVisual?: string;
  references: CompiledReference[];
  userStyleProfile: string;
  optics: string;
  colorScience: string;
  lightTransport: string;
}): ProductionPlan {
  const text = `${scene.visual || ""} ${scene.video_prompt || ""} ${scene.editing_notes || ""}`.toLowerCase();
  const lens = inferLensMm(optics);
  const styleRef = references.find((ref) => ref.usable_for.color_grade_seed || ref.usable_for.lighting_seed);
  const environmentRef = references.find((ref) => ref.usable_for.environment_seed);
  const movement = inferCameraMovement(text);
  const angle = inferCameraAngle(text, sceneIndex);
  const cutIn = sceneIndex === 0 ? "hard" : /dialogue|spoken|voice/.test(text) ? "J-cut" : "match-cut";
  const cutOut = sceneIndex + 1 >= sceneCount ? "L-cut" : nextVisual ? "match-cut" : "hard";
  const hasVfx = /smoke|rain|fire|explosion|magic|screen|hologram|particle|dust/.test(text);
  const hasCg = /spaceship|robot|creature|3d|cg|product render/.test(text);
  return {
    director: {
      core_emotional_beat: inferEmotionalBeat(text, bible.projectType),
      memorable_image: scene.visual || scene.title || bible.worldDescription,
    },
    camera: {
      shot_type: scene.shot_type || inferShotType(text),
      angle,
      lens_mm: lens,
      movement,
      line_note: previousVisual
        ? `Stay on the same side of the action line established by the prior shot; preserve screen direction from "${previousVisual.slice(0, 120)}".`
        : "Establish the action line clearly before movement begins; keep screen direction stable for later cuts.",
    },
    lighting: {
      key_source: inferKeySource(text, environmentRef),
      direction_relative_to_camera: inferLightDirection(text),
      quality: inferLightQuality(text),
      color_temp_k: inferColorTemp(text, bible.lightingStyle),
    },
    color: {
      primary_correction_target: "balanced exposure, protected highlights, readable face/product detail, stable black level across the sequence",
      creative_grade: `${colorScience}${userStyleProfile ? `; user taste memory: ${userStyleProfile.slice(0, 180)}` : ""}`,
      reference_used: styleRef?.name || null,
    },
    edit: {
      cut_in: cutIn,
      cut_out: cutOut,
      pacing_note: scene.editing_notes || (bible.projectType === "ad_video" ? "fast commercial pacing with clean hero-product readability" : "cut on action or emotion so continuity feels intentional"),
    },
    vfx: {
      required: hasVfx,
      technique: hasVfx ? inferVfxTechnique(text) : null,
      plate_or_element: hasVfx ? "generated clean plate plus tracked atmosphere/particle layer" : null,
      compositing_notes: hasVfx ? "match light wrap, depth order, grain, and motion blur to the plate; keep render budget bounded" : null,
    },
    sound: {
      ambience_bed: inferAmbience(text),
      hard_effects: inferHardEffects(text),
      music_cue: scene.bgm || (bible.projectType === "ad_video" ? "premium short-form ad pulse under dialogue" : "restrained cinematic score under dialogue"),
      dialogue_ducking_needed: Boolean(scene.spoken_line || scene.dialogue),
    },
    cg_3d: {
      required: hasCg,
      matched_lens_mm: hasCg ? lens : null,
      matched_lighting_notes: hasCg ? `CG light must match ${lightTransport}; lens must match ${lens}mm.` : null,
    },
  };
}

function formatProductionPlan(plan: ProductionPlan) {
  return [
    `Production crew plan: Director beat: ${plan.director.core_emotional_beat}; memorable image: ${plan.director.memorable_image}.`,
    `DP camera: ${plan.camera.shot_type}, ${plan.camera.angle}, ${plan.camera.lens_mm}mm, ${plan.camera.movement}; 180-degree rule: ${plan.camera.line_note}`,
    `Lighting: ${plan.lighting.key_source}, ${plan.lighting.direction_relative_to_camera}, ${plan.lighting.quality}, ${plan.lighting.color_temp_k}K.`,
    `Colorist: ${plan.color.primary_correction_target}; creative grade: ${plan.color.creative_grade}${plan.color.reference_used ? `; reference: ${plan.color.reference_used}` : ""}.`,
    `Editor: ${plan.edit.cut_in} in, ${plan.edit.cut_out} out; ${plan.edit.pacing_note}.`,
    plan.vfx.required ? `VFX: ${plan.vfx.technique}; ${plan.vfx.compositing_notes}` : "VFX: no extra effect unless already visible in the scene; keep render budget focused on identity and continuity.",
    `Sound: ambience ${plan.sound.ambience_bed}; hard effects ${plan.sound.hard_effects.join(", ") || "none"}; music ${plan.sound.music_cue || "none"}; dialogue ducking ${plan.sound.dialogue_ducking_needed ? "yes" : "no"}.`,
    plan.cg_3d.required ? `CG/3D: match ${plan.cg_3d.matched_lens_mm}mm lens; ${plan.cg_3d.matched_lighting_notes}` : "",
  ].filter(Boolean).join(" ");
}

function inferReferenceType(text: string): ReferenceType {
  if (/face|portrait|headshot|selfie|actor|character/.test(text)) return "character_face";
  if (/full.?body|costume|person|model|talent/.test(text)) return "full_character";
  if (/wardrobe|outfit|dress|shirt|jacket|costume/.test(text)) return "wardrobe";
  if (/location|room|street|house|forest|city|beach|desert|office|interior|exterior/.test(text)) return "location";
  if (/style|mood|grade|lighting|look|cinematic|film still|color/.test(text)) return "style_mood";
  if (/product|logo|prop|object|device|shoe|bottle|watch|phone|packaging/.test(text)) return "prop";
  return "full_character";
}

function inferReferenceRisks(text: string) {
  const risks: string[] = [];
  if (/low.?res|small|blurry|blur/.test(text)) risks.push("low_resolution");
  if (/occlud|covered|partial|side/.test(text)) risks.push("partial_face_occlusion");
  if (/watermark|stock|logo overlay/.test(text)) risks.push("watermark_present");
  return risks;
}

function referenceWeightForType(type: ReferenceType) {
  if (type === "character_face" || type === "full_character") return 0.9;
  if (type === "wardrobe" || type === "prop") return 0.85;
  if (type === "location") return 0.75;
  return 0.65;
}

function inferLensMm(optics: string) {
  const match = optics.match(/(\d{2,3})mm/);
  return match ? Number(match[1]) : 35;
}

function inferShotType(text: string) {
  if (/close|face|eyes/.test(text)) return "close-up";
  if (/wide|establish|landscape/.test(text)) return "wide establishing shot";
  if (/product|insert|hand|logo/.test(text)) return "insert/product detail";
  if (/run|fight|chase|action/.test(text)) return "medium action tracking shot";
  return "medium shot";
}

function inferCameraAngle(text: string, sceneIndex: number) {
  if (/power|threat|dominant|hero/.test(text)) return "low angle";
  if (/vulnerable|alone|small|watched/.test(text)) return "high angle";
  if (/unease|panic|disorient|nightmare/.test(text)) return "subtle dutch angle";
  return sceneIndex === 0 ? "eye-level establishing angle" : "eye-level continuity angle";
}

function inferCameraMovement(text: string) {
  if (/run|chase|follow|walk/.test(text)) return "tracking/dolly movement following the subject vector";
  if (/reveal|turn|discover/.test(text)) return "slow dolly-in timed to the reveal";
  if (/product|logo|insert/.test(text)) return "controlled macro push-in with rack focus";
  if (/panic|fight|urgent/.test(text)) return "restrained handheld movement with readable subject framing";
  return "subtle motivated dolly or locked-off frame with natural breathing";
}

function inferKeySource(text: string, environmentRef?: CompiledReference) {
  if (environmentRef) return `motivated source from location reference ${environmentRef.name}`;
  if (/night|neon|street/.test(text)) return "practical neon/streetlight";
  if (/room|interior|office/.test(text)) return "window or practical lamp";
  if (/sun|desert|outdoor|forest/.test(text)) return "sun or sky source";
  if (/product|studio|ad/.test(text)) return "large softbox/product key";
  return "motivated practical source visible or implied in the scene";
}

function inferLightDirection(text: string) {
  if (/silhouette|mystery/.test(text)) return "back/three-quarter back relative to camera";
  if (/reveal|face|dialogue/.test(text)) return "three-quarter front, slightly above eye line";
  return "side/front three-quarter, consistent with camera position";
}

function inferLightQuality(text: string): "hard" | "soft" | "mixed" {
  if (/noir|shadow|sun|desert|harsh/.test(text)) return "hard";
  if (/luxury|beauty|soft|romance|emotional/.test(text)) return "soft";
  return "mixed";
}

function inferColorTemp(text: string, lightingStyle: string) {
  const lower = `${text} ${lightingStyle}`.toLowerCase();
  if (/warm|sunset|gold|lamp/.test(lower)) return 3200;
  if (/night|blue|moon|cold|cyber/.test(lower)) return 5600;
  return 4300;
}

function inferEmotionalBeat(text: string, projectType: LibraryProjectType) {
  if (projectType === "ad_video") return /cta|reveal|logo/.test(text) ? "convert attention into desire and action" : "make the product feel emotionally necessary";
  if (/fear|panic|danger/.test(text)) return "hold tension while preserving character identity";
  if (/love|tender|memory/.test(text)) return "make the relationship readable through a small human gesture";
  if (/fight|chase|revenge/.test(text)) return "turn motion into a clear dramatic choice";
  return "advance the story through one clear emotional beat";
}

function inferVfxTechnique(text: string) {
  if (/screen|hologram/.test(text)) return "motion-tracked screen/composite replacement";
  if (/rain|smoke|dust|particle/.test(text)) return "tracked atmospheric particle layer";
  if (/fire|explosion/.test(text)) return "composited practical-style element with light wrap";
  return "light compositing with depth-matched plate treatment";
}

function inferAmbience(text: string) {
  if (/street|city|neon/.test(text)) return "distant traffic, wet street tone, soft electrical hum";
  if (/forest|outdoor/.test(text)) return "wind, distant natural ambience, low environmental bed";
  if (/room|office|interior/.test(text)) return "room tone, subtle air movement, practical hum";
  if (/product|studio|ad/.test(text)) return "clean studio air, polished whooshes, restrained low-end pulse";
  return "location-matched room tone and cinematic low ambience";
}

function inferHardEffects(text: string) {
  const effects: string[] = [];
  if (/door/.test(text)) effects.push("door movement");
  if (/foot|walk|run|chase/.test(text)) effects.push("footsteps");
  if (/rain/.test(text)) effects.push("rain hits");
  if (/product|logo|device|shoe|bottle/.test(text)) effects.push("product handling");
  if (/fight|hit|impact/.test(text)) effects.push("impact Foley");
  return effects;
}

function buildContinuityState({
  bible,
  character,
  product,
  previousVisual,
  nextVisual,
  referenceWeight,
}: {
  bible: VisualBible;
  character?: CharacterContinuityBible;
  product?: ProductBible;
  previousVisual?: string;
  nextVisual?: string;
  referenceWeight: number;
}): OptimizedScenePrompt["continuity"] {
  const emotionallyContinuous = Boolean(previousVisual && nextVisual);
  const sameLocation = previousVisual && nextVisual ? sharedLocationHint(previousVisual, nextVisual) : false;
  const weighted = Math.min(0.95, Math.max(0.6, referenceWeight + (sameLocation ? 0.1 : 0) + (emotionallyContinuous ? 0.15 : 0)));
  return {
    character_token: character ? formatCharacterLock(character) : null,
    wardrobe_token: character ? character.wardrobe : null,
    product_token: product ? `${product.name}; ${product.shape}; ${product.color}; ${product.material}; ${product.logoPlacement || "logo locked by reference"}` : null,
    reference_image_weight: Number(weighted.toFixed(2)),
    embedding_check_required: bible.projectType === "short_film" || Boolean(product),
  };
}

function inferActionVector(text: string) {
  const lower = text.toLowerCase();
  if (/run|chase|sprint|rush/.test(lower)) return "subject moves laterally through frame at high speed, 70% through the motion, slight motion blur on limbs, camera tracks with deceleration into the cut";
  if (/reach|grab|touch|hold/.test(lower)) return "hand motion extends toward the object, 70% completed, decelerating at contact while eye-line locks to the target";
  if (/turn|look|reveal/.test(lower)) return "subject rotates head and shoulders into a reveal, slow controlled motion, eye-line settles just before the cut";
  if (/walk|enter|approach/.test(lower)) return "subject advances toward camera at steady walking pace, weight transfers naturally from back foot to front foot";
  if (/product|logo|brand|shoe|device|bottle/.test(lower)) return "product reveal moves from partial occlusion to clear hero framing, camera settles as the logo/material catches light";
  return "single readable action beat with clear direction, midpoint, and deceleration before the edit point";
}

function inferOptics(shotType: string | undefined, text: string, cameraLanguage: string) {
  const lower = `${shotType || ""} ${text}`.toLowerCase();
  if (/close|face|eyes/.test(lower)) return `tight close-up on a 50mm lens, shallow depth of field, subtle handheld breathing, ${cameraLanguage}`;
  if (/wide|establish/.test(lower)) return `wide establishing frame on a 28mm lens, slow dolly or crane movement, readable geography, ${cameraLanguage}`;
  if (/insert|product|logo|hand/.test(lower)) return `clean insert on a 70mm macro/product lens, controlled rack focus, stable hero composition, ${cameraLanguage}`;
  if (/action|chase|run/.test(lower)) return `medium tracking shot on a 35mm lens, camera vector follows the subject with natural motion blur, ${cameraLanguage}`;
  return `medium cinematic frame on a 35mm lens, motivated camera move, shallow but usable depth of field, ${cameraLanguage}`;
}

function inferBounceSource(text: string) {
  const lower = text.toLowerCase();
  if (/night|street|neon/.test(lower)) return "wet pavement and nearby practical neon";
  if (/room|interior|home|office/.test(lower)) return "nearby wall paint and practical lamp spill";
  if (/forest|outdoor|sun|desert/.test(lower)) return "ground/sand/foliage bounce under the key light";
  if (/product|studio|ad|brand/.test(lower)) return "white product cards and the surrounding set surface";
  return "the nearest environment surface visible in the frame";
}

function inferEntropyBudget(text: string) {
  const lower = text.toLowerCase();
  if (/action|run|chase|fight/.test(lower)) return "slight imperfect framing and motion blur only on fast-moving limbs, with the face/product remaining readable";
  if (/close|emotion|cry|fear|love/.test(lower)) return "tiny asymmetry in eye-line, natural skin texture, small focus fall-off behind the face";
  if (/product|logo|brand/.test(lower)) return "micro dust, realistic reflection roll-off, tiny camera settle, product edges remain exact";
  return "subtle handheld breathing, natural fabric wrinkles, imperfect but intentional focus fall-off";
}

function inferNoveltyInjection(sceneIndex: number, text: string, projectType: LibraryProjectType) {
  const lower = text.toLowerCase();
  if (projectType === "ad_video") {
    if (sceneIndex === 0) return "begin with the product partly revealed through a motivated foreground obstruction instead of a flat packshot";
    return "let one environment reflection reveal brand context while the product silhouette stays locked";
  }
  if (/noir|thriller|detective/.test(lower)) return "use a practical reflection or doorway edge as a motivated frame-within-frame instead of a default centered hero shot";
  if (/romance|love|memory/.test(lower)) return "hold a tactile prop detail for continuity before returning to the face, avoiding a generic beauty close-up";
  if (/action|chase/.test(lower)) return "stage the action through a real spatial obstacle so the movement feels blocked, not randomly generated";
  return sceneIndex % 2 === 0
    ? "include one motivated foreground layer that reveals depth without hiding identity"
    : "use a small practical light source in frame to justify the grade and avoid generic cinematic lighting";
}

function buildFailureModes(scene: StoryScene, bible: VisualBible, hasCharacter: boolean, hasProduct: boolean) {
  const text = `${scene.visual || ""} ${scene.video_prompt || ""} ${scene.reference_image_direction || ""}`.toLowerCase();
  const failures = [
    "black frame",
    "watermark",
    "random text",
    "low quality",
    "blurry",
    "scene reset",
  ];
  if (bible.projectType === "short_film" || hasCharacter) {
    failures.push("different actor", "changed face", "changed age", "changed hairstyle", "changed wardrobe", "inconsistent character", "duplicate person", "deformed face", "extra fingers");
  }
  if (bible.projectType === "ad_video" || hasProduct) {
    failures.push("different product", "changed logo", "changed product shape", "changed packaging", "wrong brand color", "warped logo", "unreadable product geometry");
  }
  if (/night|dark|shadow/.test(text)) failures.push("crushed shadows hiding identity", "unmotivated light direction");
  if (/close|face|eyes/.test(text)) failures.push("waxy skin", "asymmetric eyes", "face shape drift");
  if (/hand|hold|grab|product/.test(text)) failures.push("malformed hands", "extra fingers touching product", "floating object");
  if (/logo|text|sign/.test(text)) failures.push("misspelled logo text", "random lettering");
  return unique(failures);
}

function sharedLocationHint(a: string, b: string) {
  const left = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 4));
  return b.toLowerCase().split(/[^a-z0-9]+/).some((token) => left.has(token));
}

function buildCharactersFromScenes(scenes: StoryScene[], references: ReferenceBrief[]) {
  const names = unique(
    scenes
      .map((scene) => scene.character?.trim())
      .filter((name): name is string => Boolean(name))
      .flatMap((name) => name.split(/,| and /i).map((part) => part.trim()).filter(Boolean)),
  ).slice(0, 3);

  if (names.length) {
    return names.map((name, index) => buildCharacter(`char-${index + 1}`, name, references[index]?.description || scenes[index]?.reference_image_direction || "", scenes[index]));
  }

  return [
    buildCharacter("char-1", references[0]?.name || "Lead character", references[0]?.description || "main protagonist", scenes[0]),
  ];
}

function buildCharacter(id: string, name: string, descriptor: string, scene?: StoryScene): CharacterContinuityBible {
  const visual = `${descriptor} ${scene?.visual || ""} ${scene?.video_prompt || ""} ${scene?.reference_image_direction || ""}`;
  return {
    id,
    name: cleanName(name),
    ageRange: inferAge(visual),
    genderPresentation: inferGenderPresentation(visual),
    faceDescription: inferFace(visual),
    hairstyle: inferHair(visual),
    bodyType: inferBody(visual),
    wardrobe: inferWardrobe(visual),
    keyAccessories: inferAccessories(visual),
    emotionalBaseline: scene?.voice_tone || inferEmotion(visual),
    voiceStyle: scene?.voice_tone || "natural cinematic dialogue, grounded and human",
    negativeIdentityRules: [
      "do not change face structure",
      "do not change age",
      "do not change hairstyle",
      "do not change wardrobe colors",
      "do not change body type",
      "do not replace with a different actor",
    ],
  };
}

function inferLighting(text: string) {
  const lower = text.toLowerCase();
  if (/night|noir|shadow|dark/.test(lower)) return "low-key cinematic lighting with controlled shadows and consistent practical highlights";
  if (/warm|sunset|gold/.test(lower)) return "warm golden-hour motivated lighting, consistent soft contrast";
  if (/luxury|premium/.test(lower)) return "soft premium commercial lighting with clean highlights and controlled reflections";
  return "cinematic motivated lighting, stable contrast, consistent scene-to-scene exposure";
}

function inferProductColor(text: string) {
  const lower = text.toLowerCase();
  if (/black|carbon|noir/.test(lower)) return "black / carbon dominant colorway";
  if (/white|clean|minimal/.test(lower)) return "white / clean neutral colorway";
  if (/gold|luxury/.test(lower)) return "dark neutral with gold accent palette";
  return "one consistent brand colorway from first generated product frame";
}

function inferProductMaterial(text: string) {
  const lower = text.toLowerCase();
  if (/shoe|athletic|running|carbon/.test(lower)) return "technical fabric, rubber, carbon-fiber performance materials";
  if (/watch|phone|device|tech/.test(lower)) return "brushed metal, glass, and polished industrial surfaces";
  if (/cosmetic|bottle|perfume/.test(lower)) return "glass, gloss label, premium packaging material";
  return "consistent premium material from the product brief";
}

function inferAge(text: string) {
  const lower = text.toLowerCase();
  if (/child|kid|young boy|young girl/.test(lower)) return "child";
  if (/teen/.test(lower)) return "teen";
  if (/elder|old|aged|70|80/.test(lower)) return "elder";
  if (/50|middle/.test(lower)) return "middle-aged adult";
  return "adult";
}

function inferGenderPresentation(text: string) {
  const lower = text.toLowerCase();
  if (/woman|female|girl|mother|sister|queen|wife/.test(lower)) return "feminine";
  if (/man|male|boy|father|brother|king|husband/.test(lower)) return "masculine";
  return "unspecified, preserve from first reference frame";
}

function inferFace(text: string) {
  const lower = text.toLowerCase();
  if (/detective|weathered|scar|rugged/.test(lower)) return "weathered realistic face, grounded features, no beauty-filter changes";
  if (/young|soft|tender/.test(lower)) return "youthful realistic face, soft natural features, consistent skin tone";
  return "distinct realistic face from first reference frame, consistent skin tone, facial structure, and expression language";
}

function inferHair(text: string) {
  const lower = text.toLowerCase();
  if (/hood|helmet|cap|hat/.test(lower)) return "headwear/covered hair preserved exactly";
  if (/long/.test(lower)) return "long hairstyle preserved exactly";
  if (/short/.test(lower)) return "short hairstyle preserved exactly";
  return "same hairstyle, hair color, hairline, and grooming in every shot";
}

function inferBody(text: string) {
  const lower = text.toLowerCase();
  if (/athletic|runner|warrior|fighter/.test(lower)) return "athletic build preserved across shots";
  if (/thin|slender/.test(lower)) return "slender build preserved across shots";
  if (/heavy|large|broad/.test(lower)) return "broad build preserved across shots";
  return "same height, build, posture, and silhouette in every shot";
}

function inferWardrobe(text: string) {
  const lower = text.toLowerCase();
  if (/suit/.test(lower)) return "same suit cut, shirt, and color palette every scene";
  if (/uniform|armor|helmet/.test(lower)) return "same uniform/armor/helmet design every scene";
  if (/coat|jacket/.test(lower)) return "same coat/jacket, fabric, color, and fit every scene";
  return "one locked wardrobe established in first frame; same colors, fabric, fit, and layering every scene";
}

function inferAccessories(text: string) {
  const lower = text.toLowerCase();
  const items = [];
  if (/ring/.test(lower)) items.push("ring");
  if (/watch/.test(lower)) items.push("watch");
  if (/glasses/.test(lower)) items.push("glasses");
  if (/weapon|gun|sword/.test(lower)) items.push("story prop/weapon");
  return items.length ? `${items.join(", ")} preserved exactly` : "no random accessories; preserve only established props";
}

function inferEmotion(text: string) {
  const lower = text.toLowerCase();
  if (/fear|terror|panic/.test(lower)) return "tense, fearful restraint";
  if (/love|tender|warm/.test(lower)) return "tender but grounded";
  if (/rage|angry|revenge/.test(lower)) return "controlled intensity";
  return "grounded cinematic seriousness";
}

function firstMeaningful(values: Array<string | undefined>, fallback: string) {
  return values.find((value) => value && value.trim()) || fallback;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function cleanName(name: string) {
  return name.replace(/^#?\d+\s*/, "").trim() || "Character";
}

function slugId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function normalizeVoiceLine(value: string | undefined, projectType: LibraryProjectType) {
  const cleaned = (value || "").replace(/^[^:]{1,32}:\s*/, "").replace(/\s+/g, " ").trim();
  const fallback = projectType === "ad_video" ? "Discover what moves you." : "We finish this together.";
  const words = (cleaned || fallback).split(/\s+/).slice(0, projectType === "ad_video" ? 12 : 10);
  return words.join(" ");
}
