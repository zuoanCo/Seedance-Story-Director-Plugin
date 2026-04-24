export type StoryVideoMode = "short_film" | "single_clip";
export type MaterialAssetKind = "character" | "prop" | "scene";
export type AssetReuseMode = "workspace_preferred" | "workspace_only" | "task_only";

export type ReferenceAsset = {
  url: string;
  description?: string;
  role?: "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame";
};

export type StoryVideoRequest = {
  mode: StoryVideoMode;
  title?: string;
  text?: string;
  prompt?: string;
  model?: string;
  directorStyle?: string;
  targetMinutes?: number;
  clipDurationSeconds?: number;
  aspectRatio?: string;
  referenceImages?: ReferenceAsset[];
  referenceVideos?: ReferenceAsset[];
  referenceAudios?: ReferenceAsset[];
  generateAudio?: boolean;
  watermark?: boolean;
  workspaceName?: string;
  workspaceDescription?: string;
  assetReuseMode?: AssetReuseMode;
  assetKinds?: MaterialAssetKind[];
  generateAssetPack?: boolean;
  outputDir?: string;
  dryRun?: boolean;
  useFastModel?: boolean;
};

export type StoryMaterialAsset = {
  id: string;
  kind: MaterialAssetKind;
  name: string;
  summary: string;
  visualDescription: string;
  referencePrompt: string;
  seedancePromptHint: string;
  continuityAnchors: string[];
};

export type PersistedStoryMaterialAsset = StoryMaterialAsset & {
  signature: string;
  scope: "task" | "workspace";
  status: "new" | "reused" | "updated" | "task_only";
  revision: number;
  fingerprint: string;
  jsonPath: string;
  briefPath: string;
  workspaceName?: string;
  basedOnAssetId?: string;
};

export type WorkspaceDescriptor = {
  name: string;
  slug: string;
  description?: string;
  rootDir: string;
  assetsDir: string;
  runsDir: string;
  workspaceFilePath: string;
  assetLibraryPath: string;
};

export type WorkspaceAssetLibrary = {
  workspaceName: string;
  workspaceSlug: string;
  updatedAt: string;
  assets: PersistedStoryMaterialAsset[];
};

export type SeedanceDirectorPluginConfig = {
  ark: {
    baseUrl: string;
    apiKey?: string;
    apiKeyEnv: string;
    videoModel: string;
    fastVideoModel: string;
    directorModel?: string;
    directorBaseUrl?: string;
    directorApiKey?: string;
    directorApiKeyEnv?: string;
    pollIntervalMs: number;
    taskTimeoutMs: number;
    maxRetries: number;
  };
  planning: {
    preferredAspectRatio: string;
    defaultClipDurationSeconds: number;
    defaultTargetMinutes: number;
    maxSegmentCount: number;
    enableDirectorModel: boolean;
    continuityMode: "video_reference" | "story_bible";
  };
  rendering: {
    outputDir: string;
    stitchSegments: boolean;
    keepIntermediateFiles: boolean;
    downloadRemoteOutputs: boolean;
    ffmpegPath?: string;
  };
};

export type ResolvedRuntimeContext = {
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
};

export type SegmentPlan = {
  index: number;
  title: string;
  summary: string;
  durationSeconds: number;
  narrativePurpose: string;
  bridgeIn?: string;
  bridgeOut?: string;
  location: string;
  cameraLanguage: string;
  visualStyle: string;
  soundDesign: string;
  assetIds: string[];
  continuityAnchors: string[];
  seedancePrompt: string;
};

export type StoryVideoPlan = {
  title: string;
  mode: StoryVideoMode;
  logline: string;
  styleBible: string[];
  characterBible: string[];
  worldBible: string[];
  totalTargetSeconds: number;
  voiceover?: string;
  musicBrief?: string;
  materialAssets: StoryMaterialAsset[];
  segments: SegmentPlan[];
};

export type CreateTaskPayload = {
  model: string;
  content: Array<Record<string, unknown>>;
  duration: number;
  ratio: string;
  generate_audio: boolean;
  watermark: boolean;
};

export type SeedanceTaskResult = {
  id: string;
  status: string;
  raw: Record<string, unknown>;
  videoUrl?: string;
  previewImageUrl?: string;
  lastFrameUrl?: string;
  error?: string;
};

export type SegmentExecutionResult = {
  plan: SegmentPlan;
  taskId: string;
  status: string;
  remoteVideoUrl?: string;
  previewImageUrl?: string;
  lastFrameUrl?: string;
  localVideoPath?: string;
  metadataPath: string;
};

export type StoryVideoRunManifest = {
  request: StoryVideoRequest;
  configSnapshot: SeedanceDirectorPluginConfig;
  plan: StoryVideoPlan;
  runDir: string;
  planPath: string;
  storyboardPath: string;
  manifestPath: string;
  materialsIndexPath?: string;
  finalVideoPath?: string;
  workspace?: WorkspaceDescriptor;
  assetLibraryPath?: string;
  usedDirectorModel: boolean;
  segmentCount: number;
  materials: PersistedStoryMaterialAsset[];
  segments: SegmentExecutionResult[];
  warnings: string[];
};

export type StoryAssetManifest = {
  request: StoryVideoRequest;
  configSnapshot: SeedanceDirectorPluginConfig;
  plan: StoryVideoPlan;
  runDir: string;
  planPath: string;
  storyboardPath: string;
  manifestPath: string;
  materialsIndexPath: string;
  workspace?: WorkspaceDescriptor;
  assetLibraryPath?: string;
  usedDirectorModel: boolean;
  materials: PersistedStoryMaterialAsset[];
  warnings: string[];
};

export type WorkspaceCreationManifest = {
  workspace: WorkspaceDescriptor;
  created: boolean;
};

export type ProgressReporter = (message: string, details?: Record<string, unknown>) => void | Promise<void>;
