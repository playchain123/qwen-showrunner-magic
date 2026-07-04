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
};

type ReferenceBrief = { name: string; description?: string };
type BrandAssetBrief = { kind: "product" | "logo" | "model"; name: string };

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
      `Negative prompt: ${CONTINUITY_NEGATIVE_PROMPT}`,
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
