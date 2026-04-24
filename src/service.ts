import type {
  CreateTaskPayload,
  ProgressReporter,
  ReferenceAsset,
  ResolvedRuntimeContext,
  SeedanceDirectorPluginConfig,
  SegmentExecutionResult,
  SegmentPlan,
  StoryAssetManifest,
  StoryMaterialAsset,
  StoryVideoPlan,
  StoryVideoRequest,
  StoryVideoRunManifest,
  WorkspaceCreationManifest,
} from "./types.js";
import { resolveConfig, requireArkApiKey } from "./config.js";
import { createStoryPlan } from "./director.js";
import { SeedanceClient } from "./seedance-client.js";
import { stitchVideoSegments } from "./stitcher.js";
import {
  applyResolvedAssetsToPlan,
  ensureWorkspaceProject,
  prepareMaterialAssets,
  resolveStorageLayout,
} from "./assets.js";
import { downloadToFile, isHttpsUrl, writeJson, writeText } from "./utils.js";

function normalizeReferenceAssets(items: string[] | ReferenceAsset[] | undefined, defaultRole: ReferenceAsset["role"]): ReferenceAsset[] {
  if (!items || items.length === 0) {
    return [];
  }

  return items.map((item) =>
    typeof item === "string"
      ? { url: item, role: defaultRole }
      : {
          ...item,
          role: item.role || defaultRole,
        }
  );
}

function estimateSegmentCount(request: StoryVideoRequest, config: SeedanceDirectorPluginConfig, clipDurationSeconds: number): number {
  if (request.mode === "single_clip") {
    return 1;
  }

  if (request.targetMinutes && request.targetMinutes > 0) {
    return Math.min(config.planning.maxSegmentCount, Math.max(2, Math.ceil((request.targetMinutes * 60) / clipDurationSeconds)));
  }

  const text = request.text || request.prompt || "";
  const rough = Math.ceil(Math.max(1, text.length) / 80);
  return Math.min(config.planning.maxSegmentCount, Math.max(4, rough));
}

function buildSegmentPrompt(segment: SegmentPlan, materialAssets: Map<string, StoryMaterialAsset>): string {
  const materialHints = (segment.assetIds || [])
    .map((assetId) => materialAssets.get(assetId))
    .filter((asset): asset is StoryMaterialAsset => Boolean(asset))
    .map(
      (asset) =>
        `${asset.kind} ${asset.name}: ${asset.seedancePromptHint} Continuity anchors: ${asset.continuityAnchors.join(", ")}.`
    );

  return [segment.seedancePrompt, materialHints.length > 0 ? `Material continuity bible: ${materialHints.join(" ")}` : ""]
    .filter(Boolean)
    .join(" ");
}

function buildContentForSegment(
  request: StoryVideoRequest,
  segment: SegmentPlan,
  materialAssets: Map<string, StoryMaterialAsset>,
  previousRemoteVideoUrl?: string
): CreateTaskPayload["content"] {
  const content: CreateTaskPayload["content"] = [{ type: "text", text: buildSegmentPrompt(segment, materialAssets) }];

  if (previousRemoteVideoUrl && isHttpsUrl(previousRemoteVideoUrl)) {
    content.push({
      type: "video_url",
      video_url: { url: previousRemoteVideoUrl },
      role: "reference_video",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceImages, "reference_image")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "image_url",
      image_url: { url: asset.url },
      role: asset.role || "reference_image",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceVideos, "reference_video")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "video_url",
      video_url: { url: asset.url },
      role: asset.role || "reference_video",
    });
  }

  for (const asset of normalizeReferenceAssets(request.referenceAudios, "reference_audio")) {
    if (!isHttpsUrl(asset.url)) {
      continue;
    }
    content.push({
      type: "audio_url",
      audio_url: { url: asset.url },
      role: asset.role || "reference_audio",
    });
  }

  return content;
}

function createStoryboard(plan: StoryVideoPlan): string {
  const lines: string[] = [
    `# ${plan.title}`,
    "",
    `Logline: ${plan.logline}`,
    "",
    "## Style Bible",
    ...plan.styleBible.map((item) => `- ${item}`),
    "",
    "## Character Bible",
    ...plan.characterBible.map((item) => `- ${item}`),
    "",
    "## World Bible",
    ...plan.worldBible.map((item) => `- ${item}`),
    "",
    "## Material Assets",
  ];

  for (const asset of plan.materialAssets) {
    lines.push("");
    lines.push(`### ${asset.name}`);
    lines.push(`- Kind: ${asset.kind}`);
    lines.push(`- Summary: ${asset.summary}`);
    lines.push(`- Visual: ${asset.visualDescription}`);
    lines.push(`- Reference Prompt: ${asset.referencePrompt}`);
    lines.push(`- Seedance Hint: ${asset.seedancePromptHint}`);
    lines.push(`- Continuity: ${asset.continuityAnchors.join("; ")}`);
  }

  lines.push("");
  lines.push("## Segments");

  for (const segment of plan.segments) {
    lines.push("");
    lines.push(`### ${segment.index}. ${segment.title}`);
    lines.push(`- Duration: ${segment.durationSeconds}s`);
    lines.push(`- Purpose: ${segment.narrativePurpose}`);
    lines.push(`- Summary: ${segment.summary}`);
    lines.push(`- Location: ${segment.location}`);
    lines.push(`- Camera: ${segment.cameraLanguage}`);
    lines.push(`- Style: ${segment.visualStyle}`);
    lines.push(`- Sound: ${segment.soundDesign}`);
    lines.push(`- Assets: ${segment.assetIds.join(", ") || "none"}`);
    if (segment.bridgeIn) {
      lines.push(`- Bridge In: ${segment.bridgeIn}`);
    }
    if (segment.bridgeOut) {
      lines.push(`- Bridge Out: ${segment.bridgeOut}`);
    }
    lines.push(`- Continuity: ${segment.continuityAnchors.join("; ")}`);
    lines.push("");
    lines.push(segment.seedancePrompt);
  }

  if (plan.voiceover) {
    lines.push("");
    lines.push("## Voiceover");
    lines.push(plan.voiceover);
  }

  if (plan.musicBrief) {
    lines.push("");
    lines.push("## Music Brief");
    lines.push(plan.musicBrief);
  }

  return `${lines.join("\n")}\n`;
}

function buildResolvedRequest(request: StoryVideoRequest): StoryVideoRequest {
  return {
    ...request,
    generateAudio: request.generateAudio ?? false,
    watermark: request.watermark ?? true,
    generateAssetPack: request.generateAssetPack ?? request.mode === "short_film",
  };
}

async function planStoryAssetsAndStorage(params: {
  request: StoryVideoRequest;
  rawConfig: unknown;
  runtime?: ResolvedRuntimeContext;
  progress?: ProgressReporter;
}): Promise<{
  request: StoryVideoRequest;
  config: SeedanceDirectorPluginConfig;
  clipDurationSeconds: number;
  aspectRatio: string;
  plan: StoryVideoPlan;
  usedDirectorModel: boolean;
  runDir: string;
  planPath: string;
  storyboardPath: string;
  manifestPath: string;
  materialsIndexPath: string;
  segmentsDir: string;
  finalDir: string;
  workspace?: StoryVideoRunManifest["workspace"];
  assetLibraryPath?: string;
  materials: StoryVideoRunManifest["materials"];
}> {
  const rootDir = params.request.outputDir || params.runtime?.workspaceDir || process.cwd();
  const config = resolveConfig(params.rawConfig, { rootDir });
  const request = buildResolvedRequest(params.request);
  const clipDurationSeconds = Math.min(15, Math.max(4, Math.round(request.clipDurationSeconds || config.planning.defaultClipDurationSeconds)));
  const aspectRatio = request.aspectRatio || config.planning.preferredAspectRatio;
  const segmentCount = estimateSegmentCount(request, config, clipDurationSeconds);
  const title = request.title || (request.mode === "single_clip" ? "single-video-test" : "seedance-story-video");
  const layout = await resolveStorageLayout({
    config,
    request,
    title,
  });

  params.progress?.("planning_story_video", {
    title,
    segmentCount,
    clipDurationSeconds,
    aspectRatio,
    workspaceName: layout.workspace?.name,
  });

  const { plan: rawPlan, usedDirectorModel } = await createStoryPlan(request, config, {
    segmentCount,
    clipDurationSeconds,
    aspectRatio,
    existingAssets: layout.workspaceLibrary.assets,
  });

  const preparedMaterials = request.generateAssetPack
    ? await prepareMaterialAssets({
        request,
        plan: rawPlan,
        layout,
      })
    : {
        materials: [],
        materialsIndexPath: layout.materialsIndexPath,
        assetIdMap: new Map<string, string>(),
        workspace: layout.workspace,
        assetLibraryPath: layout.workspace?.assetLibraryPath,
      };

  const plan = request.generateAssetPack
    ? applyResolvedAssetsToPlan({
        plan: rawPlan,
        materials: preparedMaterials.materials,
        assetIdMap: preparedMaterials.assetIdMap,
      })
    : rawPlan;

  await writeJson(layout.planPath, plan);
  await writeText(layout.storyboardPath, createStoryboard(plan));

  return {
    request,
    config,
    clipDurationSeconds,
    aspectRatio,
    plan,
    usedDirectorModel,
    runDir: layout.runDir,
    planPath: layout.planPath,
    storyboardPath: layout.storyboardPath,
    manifestPath: layout.manifestPath,
    materialsIndexPath: preparedMaterials.materialsIndexPath,
    segmentsDir: layout.segmentsDir,
    finalDir: layout.finalDir,
    workspace: preparedMaterials.workspace,
    assetLibraryPath: preparedMaterials.assetLibraryPath,
    materials: preparedMaterials.materials,
  };
}

export async function createWorkspacePipeline(params: {
  workspaceName: string;
  workspaceDescription?: string;
  outputDir?: string;
  rawConfig: unknown;
  runtime?: ResolvedRuntimeContext;
}): Promise<WorkspaceCreationManifest> {
  const rootDir = params.outputDir || params.runtime?.workspaceDir || process.cwd();
  const config = resolveConfig(params.rawConfig, { rootDir });

  return ensureWorkspaceProject({
    config,
    workspaceName: params.workspaceName,
    workspaceDescription: params.workspaceDescription,
  });
}

export async function runStoryAssetPipeline(params: {
  request: StoryVideoRequest;
  rawConfig: unknown;
  runtime?: ResolvedRuntimeContext;
  progress?: ProgressReporter;
}): Promise<StoryAssetManifest> {
  const prepared = await planStoryAssetsAndStorage(params);
  const warnings: string[] = [];

  const manifest: StoryAssetManifest = {
    request: prepared.request,
    configSnapshot: prepared.config,
    plan: prepared.plan,
    runDir: prepared.runDir,
    planPath: prepared.planPath,
    storyboardPath: prepared.storyboardPath,
    manifestPath: prepared.manifestPath,
    materialsIndexPath: prepared.materialsIndexPath,
    workspace: prepared.workspace,
    assetLibraryPath: prepared.assetLibraryPath,
    usedDirectorModel: prepared.usedDirectorModel,
    materials: prepared.materials,
    warnings,
  };

  await writeJson(prepared.manifestPath, manifest);
  return manifest;
}

export async function runStoryVideoPipeline(params: {
  request: StoryVideoRequest;
  rawConfig: unknown;
  runtime?: ResolvedRuntimeContext;
  progress?: ProgressReporter;
}): Promise<StoryVideoRunManifest> {
  const prepared = await planStoryAssetsAndStorage(params);
  const warnings: string[] = [];
  const materialAssets = new Map(prepared.plan.materialAssets.map((asset) => [asset.id, asset]));

  const manifest: StoryVideoRunManifest = {
    request: prepared.request,
    configSnapshot: prepared.config,
    plan: prepared.plan,
    runDir: prepared.runDir,
    planPath: prepared.planPath,
    storyboardPath: prepared.storyboardPath,
    manifestPath: prepared.manifestPath,
    materialsIndexPath: prepared.materialsIndexPath,
    workspace: prepared.workspace,
    assetLibraryPath: prepared.assetLibraryPath,
    usedDirectorModel: prepared.usedDirectorModel,
    segmentCount: prepared.plan.segments.length,
    materials: prepared.materials,
    segments: [],
    warnings,
  };

  if (prepared.request.dryRun) {
    await writeJson(prepared.manifestPath, manifest);
    return manifest;
  }

  const apiKey = requireArkApiKey(prepared.config);
  const client = new SeedanceClient(prepared.config, apiKey);
  let previousRemoteVideoUrl: string | undefined;

  for (const segment of prepared.plan.segments) {
    params.progress?.("creating_segment", {
      segment: segment.index,
      title: segment.title,
      assetIds: segment.assetIds,
    });

    const payload: CreateTaskPayload = {
      model: prepared.request.model || (prepared.request.useFastModel ? prepared.config.ark.fastVideoModel : prepared.config.ark.videoModel),
      content: buildContentForSegment(
        prepared.request,
        segment,
        materialAssets,
        prepared.config.planning.continuityMode === "video_reference" ? previousRemoteVideoUrl : undefined
      ),
      duration: segment.durationSeconds,
      ratio: prepared.aspectRatio,
      generate_audio: Boolean(prepared.request.generateAudio),
      watermark: Boolean(prepared.request.watermark),
    };

    const created = await client.createTask(payload);
    params.progress?.("polling_segment", {
      segment: segment.index,
      taskId: created.id,
    });
    const result = await client.waitForTask(created.id);
    const metadataPath = `${prepared.segmentsDir}/segment-${String(segment.index).padStart(2, "0")}.json`;
    let localVideoPath: string | undefined;

    if (result.videoUrl && prepared.config.rendering.downloadRemoteOutputs) {
      localVideoPath = `${prepared.segmentsDir}/segment-${String(segment.index).padStart(2, "0")}.mp4`;
      await downloadToFile(result.videoUrl, localVideoPath);
    }

    previousRemoteVideoUrl = result.videoUrl || previousRemoteVideoUrl;

    const segmentResult: SegmentExecutionResult = {
      plan: segment,
      taskId: created.id,
      status: result.status,
      remoteVideoUrl: result.videoUrl,
      previewImageUrl: result.previewImageUrl,
      lastFrameUrl: result.lastFrameUrl,
      localVideoPath,
      metadataPath,
    };

    await writeJson(metadataPath, {
      requestPayload: payload,
      created,
      result,
      segment,
    });
    manifest.segments.push(segmentResult);
  }

  const localSegmentFiles = manifest.segments
    .map((item) => item.localVideoPath)
    .filter((item): item is string => Boolean(item));

  if (prepared.config.rendering.stitchSegments && localSegmentFiles.length > 0) {
    const finalVideoPath = `${prepared.finalDir}/${prepared.plan.title.replace(/[\\/:*?"<>|]+/g, "-")}.mp4`;
    try {
      const stitched = await stitchVideoSegments({
        inputFiles: localSegmentFiles,
        outputFile: finalVideoPath,
        ffmpegPath: prepared.config.rendering.ffmpegPath,
        hasAudio: Boolean(prepared.request.generateAudio),
      });
      if (stitched.stitched) {
        manifest.finalVideoPath = stitched.outputFile;
      } else if (stitched.reason) {
        warnings.push(stitched.reason);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  await writeJson(prepared.manifestPath, manifest);
  return manifest;
}
