import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import type {
  SeedanceDirectorPluginConfig,
  StoryMaterialAsset,
  StoryVideoPlan,
  StoryVideoRequest,
} from "./types.js";
import { chunkByCount, estimateSentenceSplits } from "./utils.js";

function buildSystemPrompt(): string {
  return [
    "You are a world-class short film director and AI-video screenwriter.",
    "You are optimizing specifically for Seedance 2.0 text-to-video generation.",
    "Return JSON only.",
    "Create a filmable plan that preserves story continuity across many 4-15 second segments.",
    "Also create a reusable material asset pack for characters, props, and scenes whenever the story needs them.",
    "Every segment must have a clear bridge_in or bridge_out idea when needed.",
    "Each segment should reference the material asset ids it depends on.",
    "Prompts must be visually concrete: subject, environment, motion, lens language, lighting, mood, continuity anchors, and what should stay consistent.",
    "Do not invent impossible continuity jumps unless the user asked for surrealism.",
    "Keep prompts compact but richly visual. Avoid markdown."
  ].join(" ");
}

function buildUserPrompt(
  request: StoryVideoRequest,
  segmentCount: number,
  clipDurationSeconds: number,
  aspectRatio: string,
  existingAssets: StoryMaterialAsset[]
): string {
  const baseText = request.mode === "single_clip" ? request.prompt || request.text || "" : request.text || request.prompt || "";
  const references = [
    ...(request.referenceImages || []).map((asset, index) => `Image ${index + 1}: ${asset.description || asset.url}`),
    ...(request.referenceVideos || []).map((asset, index) => `Video ${index + 1}: ${asset.description || asset.url}`),
    ...(request.referenceAudios || []).map((asset, index) => `Audio ${index + 1}: ${asset.description || asset.url}`),
  ];

  return JSON.stringify(
    {
      title: request.title,
      mode: request.mode,
      inputText: baseText,
      directorStyle: request.directorStyle || "cinematic realism, coherent narrative continuity, emotionally grounded performances",
      targetMinutes: request.targetMinutes,
      desiredSegmentCount: segmentCount,
      clipDurationSeconds,
      aspectRatio,
      generateAudio: request.generateAudio ?? false,
      workspaceName: request.workspaceName,
      assetReuseMode: request.assetReuseMode,
      requestedAssetKinds: request.assetKinds || ["character", "prop", "scene"],
      references,
      existingWorkspaceAssets: existingAssets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        summary: asset.summary,
        visualDescription: asset.visualDescription,
        referencePrompt: asset.referencePrompt,
        seedancePromptHint: asset.seedancePromptHint,
        continuityAnchors: asset.continuityAnchors,
      })),
      responseShape: {
        title: "string",
        logline: "string",
        styleBible: ["string"],
        characterBible: ["string"],
        worldBible: ["string"],
        totalTargetSeconds: "number",
        voiceover: "string or omitted",
        musicBrief: "string or omitted",
        materialAssets: [
          {
            id: "string",
            kind: "character | prop | scene",
            name: "string",
            summary: "string",
            visualDescription: "string",
            referencePrompt: "string",
            seedancePromptHint: "string",
            continuityAnchors: ["string"]
          }
        ],
        segments: [
          {
            index: "number",
            title: "string",
            summary: "string",
            durationSeconds: "number between 4 and 15",
            narrativePurpose: "string",
            bridgeIn: "string or omitted",
            bridgeOut: "string or omitted",
            location: "string",
            cameraLanguage: "string",
            visualStyle: "string",
            soundDesign: "string",
            assetIds: ["string"],
            continuityAnchors: ["string"],
            seedancePrompt: "string"
          }
        ]
      }
    },
    null,
    2
  );
}

function normalizeMaterialAssets(rawAssets: unknown, fallbackAssets: StoryMaterialAsset[]): StoryMaterialAsset[] {
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) {
    return fallbackAssets;
  }

  return rawAssets
    .map((asset, index) => {
      const record = asset && typeof asset === "object" ? (asset as Record<string, unknown>) : {};
      const kind = record.kind === "character" || record.kind === "prop" || record.kind === "scene" ? record.kind : "prop";
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : `Asset ${index + 1}`;
      return {
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `${kind}-${index + 1}`,
        kind,
        name,
        summary: typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : `${name} reference asset`,
        visualDescription:
          typeof record.visualDescription === "string" && record.visualDescription.trim()
            ? record.visualDescription.trim()
            : `${name} visual reference`,
        referencePrompt:
          typeof record.referencePrompt === "string" && record.referencePrompt.trim()
            ? record.referencePrompt.trim()
            : `${name} image reference prompt`,
        seedancePromptHint:
          typeof record.seedancePromptHint === "string" && record.seedancePromptHint.trim()
            ? record.seedancePromptHint.trim()
            : `${name} continuity prompt`,
        continuityAnchors: Array.isArray(record.continuityAnchors)
          ? record.continuityAnchors.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [],
      } satisfies StoryMaterialAsset;
    })
    .filter(Boolean);
}

function buildFallbackMaterialAssets(request: StoryVideoRequest, aspectRatio: string, existingAssets: StoryMaterialAsset[]): StoryMaterialAsset[] {
  if (existingAssets.length > 0) {
    return existingAssets.slice(0, 6);
  }

  const sourceText = request.text || request.prompt || "cinematic story";
  const style = request.directorStyle || "cinematic realism";
  const mainCharacter: StoryMaterialAsset = {
    id: "character-main",
    kind: "character",
    name: "Main Character",
    summary: "Primary protagonist used as the continuity anchor across the video.",
    visualDescription: `${style} protagonist design derived from the story. Keep face, age impression, wardrobe silhouette, and emotional bearing stable.`,
    referencePrompt: `${style}, character concept sheet, full body plus portrait, grounded wardrobe, production-ready continuity reference, aspect ratio ${aspectRatio}, based on: ${sourceText}`,
    seedancePromptHint: "Keep the main protagonist's face, age impression, hairstyle, wardrobe silhouette, and emotional state consistent.",
    continuityAnchors: ["same face and age impression", "same wardrobe silhouette", "same emotional progression"],
  };

  const primaryScene: StoryMaterialAsset = {
    id: "scene-primary",
    kind: "scene",
    name: "Primary Scene",
    summary: "Primary environment that visually grounds the story world.",
    visualDescription: `${style} environment reference derived from the story, preserving architecture, weather, texture language, and lighting logic.`,
    referencePrompt: `${style}, wide environmental concept, production design bible, consistent lighting, aspect ratio ${aspectRatio}, based on: ${sourceText}`,
    seedancePromptHint: "Preserve the same world-building logic, location layout, weather cues, and lighting direction unless the story explicitly changes them.",
    continuityAnchors: ["same production design language", "same light direction", "same weather logic"],
  };

  const keyProp: StoryMaterialAsset = {
    id: "prop-key",
    kind: "prop",
    name: "Key Prop",
    summary: "Story-critical object that can be reused in multiple shots if needed.",
    visualDescription: `${style} prop reference derived from the story, tactile detail, production-ready surface texture and scale.`,
    referencePrompt: `${style}, hero prop reference, isolated and contextual views, grounded material details, based on: ${sourceText}`,
    seedancePromptHint: "If the story uses a signature object, preserve its material, scale, wear marks, and silhouette consistently.",
    continuityAnchors: ["same material finish", "same scale", "same identifying marks"],
  };

  return [mainCharacter, primaryScene, keyProp];
}

function normalizePlan(
  raw: StoryVideoPlan,
  request: StoryVideoRequest,
  segmentCount: number,
  clipDurationSeconds: number,
  aspectRatio: string,
  existingAssets: StoryMaterialAsset[]
): StoryVideoPlan {
  const segments = Array.isArray(raw.segments) ? raw.segments : [];
  const fallbackAssets = buildFallbackMaterialAssets(request, aspectRatio, existingAssets);
  const materialAssets = normalizeMaterialAssets((raw as StoryVideoPlan & { materialAssets?: unknown }).materialAssets, fallbackAssets);
  const assetIds = new Set(materialAssets.map((asset) => asset.id));
  const defaultSegmentAssetIds = materialAssets.slice(0, 3).map((asset) => asset.id);

  return {
    title: raw.title || request.title || "Untitled Seedance Story",
    mode: request.mode,
    logline: raw.logline || "A short cinematic adaptation generated from the user's story.",
    styleBible: Array.isArray(raw.styleBible) && raw.styleBible.length > 0 ? raw.styleBible : ["cinematic realism", "clear visual continuity"],
    characterBible: Array.isArray(raw.characterBible) && raw.characterBible.length > 0 ? raw.characterBible : ["Keep protagonist identity, age impression, wardrobe silhouette, and emotional arc consistent."],
    worldBible: Array.isArray(raw.worldBible) && raw.worldBible.length > 0 ? raw.worldBible : ["Preserve the same world logic, time of day progression, and production design language."],
    totalTargetSeconds: Math.max(clipDurationSeconds * segmentCount, raw.totalTargetSeconds || 0),
    voiceover: raw.voiceover,
    musicBrief: raw.musicBrief,
    materialAssets,
    segments: segments.map((segment, index) => ({
      index: index + 1,
      title: segment.title || `Segment ${index + 1}`,
      summary: segment.summary || "",
      durationSeconds: Math.min(15, Math.max(4, Math.round(segment.durationSeconds || clipDurationSeconds))),
      narrativePurpose: segment.narrativePurpose || segment.summary || `Advance the story beat for segment ${index + 1}.`,
      bridgeIn: segment.bridgeIn,
      bridgeOut: segment.bridgeOut,
      location: segment.location || "story-driven cinematic environment",
      cameraLanguage: segment.cameraLanguage || "cinematic medium shot with motivated motion",
      visualStyle: segment.visualStyle || request.directorStyle || "cinematic realism",
      soundDesign: segment.soundDesign || "subtle ambient sound cues matching the location",
      assetIds: Array.isArray(segment.assetIds)
        ? segment.assetIds.filter((item): item is string => typeof item === "string" && assetIds.has(item))
        : defaultSegmentAssetIds,
      continuityAnchors: Array.isArray(segment.continuityAnchors) && segment.continuityAnchors.length > 0
        ? segment.continuityAnchors
        : ["keep protagonist appearance consistent", "preserve wardrobe and lighting continuity"],
      seedancePrompt: segment.seedancePrompt || "",
    })),
  };
}

function fallbackPlan(
  request: StoryVideoRequest,
  segmentCount: number,
  clipDurationSeconds: number,
  aspectRatio: string,
  existingAssets: StoryMaterialAsset[]
): StoryVideoPlan {
  const text = request.mode === "single_clip" ? request.prompt || request.text || "" : request.text || request.prompt || "";
  const sentences = estimateSentenceSplits(text);
  const source = sentences.length > 0 ? [...sentences] : [text];
  while (source.length < segmentCount) {
    source.push(source[source.length - 1] || text);
  }
  const groups = chunkByCount(source, segmentCount);
  const style = request.directorStyle || "cinematic realism, grounded acting, coherent production design";
  const materialAssets = buildFallbackMaterialAssets(request, aspectRatio, existingAssets);
  const defaultAssetIds = materialAssets.slice(0, 3).map((asset) => asset.id);

  const segments = groups.map((group, index) => {
    const beat = group.join(" ").trim();
    const bridgeIn = index === 0 ? "Open on a clear establishing image." : "Continue directly from the previous segment without changing protagonist identity or wardrobe.";
    const bridgeOut = index === groups.length - 1 ? "Land on a visually resolved final image." : "End on a visual action that can flow into the next shot.";

    return {
      index: index + 1,
      title: `Segment ${index + 1}`,
      summary: beat,
      durationSeconds: clipDurationSeconds,
      narrativePurpose: beat || `Advance the story through segment ${index + 1}.`,
      bridgeIn,
      bridgeOut,
      location: "cinematic environment inferred from the story",
      cameraLanguage: index === 0 ? "strong establishing shot, then gentle push-in" : "motivated follow-through from the previous segment",
      visualStyle: style,
      soundDesign: request.generateAudio ? "natural ambience that matches the scene" : "designed for later post-produced soundscape",
      assetIds: defaultAssetIds,
      continuityAnchors: [
        "same protagonist face and body language",
        "same wardrobe silhouette and palette",
        `keep aspect ratio ${aspectRatio}`
      ],
      seedancePrompt: [
        `${style}.`,
        `Aspect ratio ${aspectRatio}.`,
        bridgeIn,
        beat || text,
        index > 0 ? "Continue seamlessly from the previous shot. Preserve character identity, costume, lens language, lighting direction, and motion rhythm." : "",
        bridgeOut,
        "No abrupt scene jump, no extra characters unless the story requires them, no text overlay, no broken anatomy."
      ]
        .filter(Boolean)
        .join(" "),
    };
  });

  return {
    title: request.title || "Untitled Seedance Story",
    mode: request.mode,
    logline: text.slice(0, 160),
    styleBible: [style, "consistent character continuity", "clean visual bridge between segments"],
    characterBible: ["Keep the main character's face, age impression, hairstyle, wardrobe, and emotional arc stable."],
    worldBible: ["Preserve the same location logic, weather logic, and light progression unless the story explicitly shifts."],
    totalTargetSeconds: segmentCount * clipDurationSeconds,
    voiceover: request.mode === "short_film" ? text : undefined,
    musicBrief: request.generateAudio ? "Use restrained cinematic ambience that does not fight the cut points." : "Silent assembly first; music can be added in post.",
    materialAssets,
    segments,
  };
}

export async function createStoryPlan(
  request: StoryVideoRequest,
  config: SeedanceDirectorPluginConfig,
  options: { segmentCount: number; clipDurationSeconds: number; aspectRatio: string; existingAssets?: StoryMaterialAsset[] }
): Promise<{ plan: StoryVideoPlan; usedDirectorModel: boolean }> {
  const existingAssets = options.existingAssets || [];
  const fallback = fallbackPlan(request, options.segmentCount, options.clipDurationSeconds, options.aspectRatio, existingAssets);
  const shouldUseDirector = config.planning.enableDirectorModel && Boolean(config.ark.directorModel) && Boolean(config.ark.directorApiKey);

  if (!shouldUseDirector) {
    return { plan: fallback, usedDirectorModel: false };
  }

  try {
    const client = new OpenAI({
      apiKey: config.ark.directorApiKey,
      baseURL: config.ark.directorBaseUrl || config.ark.baseUrl,
    });

    const completion = await client.chat.completions.create({
      model: config.ark.directorModel!,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(request, options.segmentCount, options.clipDurationSeconds, options.aspectRatio, existingAssets) },
      ],
    });

    const rawText = completion.choices[0]?.message?.content;
    if (!rawText) {
      return { plan: fallback, usedDirectorModel: false };
    }

    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonrepair(cleaned)) as StoryVideoPlan;
    const plan = normalizePlan(parsed, request, options.segmentCount, options.clipDurationSeconds, options.aspectRatio, existingAssets);

    if (plan.segments.length === 0) {
      return { plan: fallback, usedDirectorModel: false };
    }

    return { plan, usedDirectorModel: true };
  } catch {
    return { plan: fallback, usedDirectorModel: false };
  }
}
