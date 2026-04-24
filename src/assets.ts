import path from "node:path";
import { access } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  AssetReuseMode,
  PersistedStoryMaterialAsset,
  SeedanceDirectorPluginConfig,
  StoryMaterialAsset,
  StoryVideoPlan,
  StoryVideoRequest,
  WorkspaceAssetLibrary,
  WorkspaceCreationManifest,
  WorkspaceDescriptor,
} from "./types.js";
import { ensureDir, nowStamp, readJson, slugify, writeJson, writeText } from "./utils.js";

type StorageLayout = {
  runDir: string;
  planPath: string;
  storyboardPath: string;
  manifestPath: string;
  materialsIndexPath: string;
  materialsDir: string;
  segmentsDir: string;
  finalDir: string;
  workspace?: WorkspaceDescriptor;
  workspaceLibrary: WorkspaceAssetLibrary;
};

type MaterialPreparationResult = {
  materials: PersistedStoryMaterialAsset[];
  materialsIndexPath: string;
  assetIdMap: Map<string, string>;
  workspace?: WorkspaceDescriptor;
  assetLibraryPath?: string;
};

function promptFingerprint(asset: StoryMaterialAsset): string {
  const hash = createHash("sha1");
  hash.update(
    JSON.stringify({
      kind: asset.kind,
      name: asset.name,
      visualDescription: asset.visualDescription,
      referencePrompt: asset.referencePrompt,
      seedancePromptHint: asset.seedancePromptHint,
      continuityAnchors: asset.continuityAnchors,
    })
  );
  return hash.digest("hex");
}

function assetSignature(asset: Pick<StoryMaterialAsset, "kind" | "name">): string {
  return `${asset.kind}:${slugify(asset.name)}`;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function buildCanonicalAssetId(asset: Pick<StoryMaterialAsset, "kind" | "name">): string {
  return `${asset.kind}-${slugify(asset.name)}`;
}

function normalizeMaterialAsset(asset: StoryMaterialAsset): StoryMaterialAsset {
  const name = asset.name?.trim() || asset.id || asset.kind;
  return {
    id: asset.id?.trim() || buildCanonicalAssetId({ kind: asset.kind, name }),
    kind: asset.kind,
    name,
    summary: asset.summary?.trim() || `${name} reference asset`,
    visualDescription: asset.visualDescription?.trim() || asset.summary?.trim() || `${name} visual reference`,
    referencePrompt: asset.referencePrompt?.trim() || asset.visualDescription?.trim() || `${name} visual reference prompt`,
    seedancePromptHint: asset.seedancePromptHint?.trim() || asset.visualDescription?.trim() || `${name} continuity prompt`,
    continuityAnchors: uniqueStrings(asset.continuityAnchors || []),
  };
}

function createMaterialBrief(asset: PersistedStoryMaterialAsset): string {
  return [
    `# ${asset.name}`,
    "",
    `- Kind: ${asset.kind}`,
    `- Scope: ${asset.scope}`,
    `- Status: ${asset.status}`,
    `- Revision: ${asset.revision}`,
    asset.workspaceName ? `- Workspace: ${asset.workspaceName}` : "",
    asset.basedOnAssetId ? `- Based On: ${asset.basedOnAssetId}` : "",
    "",
    "## Summary",
    asset.summary,
    "",
    "## Visual Description",
    asset.visualDescription,
    "",
    "## Reference Prompt",
    asset.referencePrompt,
    "",
    "## Seedance Prompt Hint",
    asset.seedancePromptHint,
    "",
    "## Continuity Anchors",
    ...asset.continuityAnchors.map((item) => `- ${item}`),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function defaultWorkspaceLibrary(workspace: WorkspaceDescriptor): WorkspaceAssetLibrary {
  return {
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    updatedAt: new Date().toISOString(),
    assets: [],
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function buildWorkspaceDescriptor(baseOutputDir: string, name: string, description?: string): WorkspaceDescriptor {
  const slug = slugify(name);
  const rootDir = path.join(baseOutputDir, "workspaces", slug);
  const assetsDir = path.join(rootDir, "assets");
  const runsDir = path.join(assetsDir, "runs");
  return {
    name,
    slug,
    description,
    rootDir,
    assetsDir,
    runsDir,
    workspaceFilePath: path.join(rootDir, "workspace.json"),
    assetLibraryPath: path.join(assetsDir, "asset-library.json"),
  };
}

export async function ensureWorkspaceProject(params: {
  config: SeedanceDirectorPluginConfig;
  workspaceName: string;
  workspaceDescription?: string;
}): Promise<WorkspaceCreationManifest> {
  const workspace = buildWorkspaceDescriptor(params.config.rendering.outputDir, params.workspaceName, params.workspaceDescription);
  const existed = await pathExists(workspace.workspaceFilePath);

  await ensureDir(workspace.assetsDir);
  await ensureDir(workspace.runsDir);

  await writeJson(workspace.workspaceFilePath, {
    name: workspace.name,
    slug: workspace.slug,
    description: params.workspaceDescription,
    rootDir: workspace.rootDir,
    assetsDir: workspace.assetsDir,
    runsDir: workspace.runsDir,
    assetLibraryPath: workspace.assetLibraryPath,
    updatedAt: new Date().toISOString(),
    createdAt: existed && (await pathExists(workspace.workspaceFilePath))
      ? undefined
      : new Date().toISOString(),
  });

  if (!(await pathExists(workspace.assetLibraryPath))) {
    await writeJson(workspace.assetLibraryPath, defaultWorkspaceLibrary(workspace));
  }

  return {
    workspace,
    created: !existed,
  };
}

async function loadWorkspaceLibrary(workspace?: WorkspaceDescriptor): Promise<WorkspaceAssetLibrary> {
  if (!workspace) {
    return {
      workspaceName: "",
      workspaceSlug: "",
      updatedAt: new Date().toISOString(),
      assets: [],
    };
  }

  if (!(await pathExists(workspace.assetLibraryPath))) {
    const emptyLibrary = defaultWorkspaceLibrary(workspace);
    await writeJson(workspace.assetLibraryPath, emptyLibrary);
    return emptyLibrary;
  }

  return readJson<WorkspaceAssetLibrary>(workspace.assetLibraryPath);
}

export async function resolveStorageLayout(params: {
  config: SeedanceDirectorPluginConfig;
  request: StoryVideoRequest;
  title: string;
}): Promise<StorageLayout> {
  const runSlug = `${slugify(params.title)}-${nowStamp()}`;

  let workspace: WorkspaceDescriptor | undefined;
  if (params.request.workspaceName?.trim()) {
    const created = await ensureWorkspaceProject({
      config: params.config,
      workspaceName: params.request.workspaceName.trim(),
      workspaceDescription: params.request.workspaceDescription,
    });
    workspace = created.workspace;
  }

  const runDir = workspace
    ? path.join(workspace.runsDir, runSlug)
    : path.join(params.config.rendering.outputDir, "assets", "tasks", runSlug);
  const materialsDir = path.join(runDir, "materials");
  const segmentsDir = path.join(runDir, "segments");
  const finalDir = path.join(runDir, "final");

  await ensureDir(runDir);
  await ensureDir(materialsDir);
  await ensureDir(segmentsDir);
  await ensureDir(finalDir);

  return {
    runDir,
    planPath: path.join(runDir, "plan.json"),
    storyboardPath: path.join(runDir, "storyboard.md"),
    manifestPath: path.join(runDir, "manifest.json"),
    materialsIndexPath: path.join(runDir, "materials.json"),
    materialsDir,
    segmentsDir,
    finalDir,
    workspace,
    workspaceLibrary: await loadWorkspaceLibrary(workspace),
  };
}

function buildMaterialPaths(rootDir: string, asset: StoryMaterialAsset): { jsonPath: string; briefPath: string } {
  const dir = path.join(rootDir, `${asset.kind}s`);
  const fileBase = buildCanonicalAssetId(asset);
  return {
    jsonPath: path.join(dir, `${fileBase}.json`),
    briefPath: path.join(dir, `${fileBase}.md`),
  };
}

async function persistMaterialFile(rootDir: string, asset: PersistedStoryMaterialAsset): Promise<void> {
  await writeJson(asset.jsonPath, asset);
  await writeText(asset.briefPath, createMaterialBrief(asset));
}

function createMaterialIndex(materials: PersistedStoryMaterialAsset[], workspace?: WorkspaceDescriptor): string {
  const lines = [
    "# Material Assets",
    "",
    workspace ? `Workspace: ${workspace.name}` : "Workspace: task-only",
    "",
  ];

  for (const asset of materials) {
    lines.push(`## ${asset.name}`);
    lines.push(`- Kind: ${asset.kind}`);
    lines.push(`- Scope: ${asset.scope}`);
    lines.push(`- Status: ${asset.status}`);
    lines.push(`- Revision: ${asset.revision}`);
    lines.push(`- JSON: ${asset.jsonPath}`);
    lines.push(`- Brief: ${asset.briefPath}`);
    lines.push(`- Summary: ${asset.summary}`);
    lines.push(`- Continuity: ${asset.continuityAnchors.join("; ")}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function mergeAssetData(base: StoryMaterialAsset, incoming: StoryMaterialAsset): StoryMaterialAsset {
  return {
    ...base,
    ...incoming,
    continuityAnchors: uniqueStrings([...(base.continuityAnchors || []), ...(incoming.continuityAnchors || [])]),
  };
}

function effectiveReuseMode(request: StoryVideoRequest): AssetReuseMode {
  if (!request.workspaceName?.trim()) {
    return "task_only";
  }
  return request.assetReuseMode || "workspace_preferred";
}

function filterPlannedAssets(request: StoryVideoRequest, assets: StoryMaterialAsset[]): StoryMaterialAsset[] {
  const allowedKinds = new Set(request.assetKinds || ["character", "prop", "scene"]);
  const deduped = new Map<string, StoryMaterialAsset>();

  for (const asset of assets.filter((item) => allowedKinds.has(item.kind))) {
    const normalized = normalizeMaterialAsset(asset);
    deduped.set(assetSignature(normalized), normalized);
  }

  return [...deduped.values()];
}

export async function prepareMaterialAssets(params: {
  request: StoryVideoRequest;
  plan: StoryVideoPlan;
  layout: StorageLayout;
}): Promise<MaterialPreparationResult> {
  const reuseMode = effectiveReuseMode(params.request);
  const planAssets = filterPlannedAssets(params.request, params.plan.materialAssets || []);
  const workspaceLibrary = structuredClone(params.layout.workspaceLibrary);
  const workspaceAssets = new Map(workspaceLibrary.assets.map((asset) => [asset.signature, asset]));
  const materials: PersistedStoryMaterialAsset[] = [];
  const assetIdMap = new Map<string, string>();

  for (const asset of planAssets) {
    const signature = assetSignature(asset);
    const fingerprint = promptFingerprint(asset);
    const existing = workspaceAssets.get(signature);

    if (params.layout.workspace && reuseMode !== "task_only" && existing) {
      if (existing.fingerprint === fingerprint) {
        const reused = {
          ...existing,
          status: "reused" as const,
        };
        materials.push(reused);
        assetIdMap.set(asset.id, reused.id);
        continue;
      }

      if (reuseMode === "workspace_only") {
        const taskPaths = buildMaterialPaths(params.layout.materialsDir, asset);
        const taskAsset: PersistedStoryMaterialAsset = {
          ...asset,
          id: asset.id || buildCanonicalAssetId(asset),
          signature,
          scope: "task",
          status: "task_only",
          revision: 1,
          fingerprint,
          jsonPath: taskPaths.jsonPath,
          briefPath: taskPaths.briefPath,
          basedOnAssetId: existing.id,
        };
        await persistMaterialFile(params.layout.materialsDir, taskAsset);
        materials.push(taskAsset);
        assetIdMap.set(asset.id, taskAsset.id);
        continue;
      }

      const mergedAsset = mergeAssetData(existing, asset);
      const nextRevision = existing.revision + 1;
      const workspacePaths = buildMaterialPaths(path.join(params.layout.workspace.assetsDir, "materials"), mergedAsset);
      const updated: PersistedStoryMaterialAsset = {
        ...mergedAsset,
        id: existing.id,
        signature,
        scope: "workspace",
        status: "updated",
        revision: nextRevision,
        fingerprint: promptFingerprint(mergedAsset),
        jsonPath: workspacePaths.jsonPath,
        briefPath: workspacePaths.briefPath,
        workspaceName: params.layout.workspace.name,
        basedOnAssetId: existing.id,
      };
      await persistMaterialFile(path.join(params.layout.workspace.assetsDir, "materials"), updated);
      workspaceAssets.set(signature, updated);
      materials.push(updated);
      assetIdMap.set(asset.id, updated.id);
      continue;
    }

    if (params.layout.workspace && reuseMode === "workspace_preferred") {
      const workspacePaths = buildMaterialPaths(path.join(params.layout.workspace.assetsDir, "materials"), asset);
      const stored: PersistedStoryMaterialAsset = {
        ...asset,
        id: asset.id || buildCanonicalAssetId(asset),
        signature,
        scope: "workspace",
        status: "new",
        revision: 1,
        fingerprint,
        jsonPath: workspacePaths.jsonPath,
        briefPath: workspacePaths.briefPath,
        workspaceName: params.layout.workspace.name,
      };
      await persistMaterialFile(path.join(params.layout.workspace.assetsDir, "materials"), stored);
      workspaceAssets.set(signature, stored);
      materials.push(stored);
      assetIdMap.set(asset.id, stored.id);
      continue;
    }

    const taskPaths = buildMaterialPaths(params.layout.materialsDir, asset);
    const taskAsset: PersistedStoryMaterialAsset = {
      ...asset,
      id: asset.id || buildCanonicalAssetId(asset),
      signature,
      scope: "task",
      status: reuseMode === "task_only" ? "new" : "task_only",
      revision: 1,
      fingerprint,
      jsonPath: taskPaths.jsonPath,
      briefPath: taskPaths.briefPath,
      workspaceName: params.layout.workspace?.name,
    };
    await persistMaterialFile(params.layout.materialsDir, taskAsset);
    materials.push(taskAsset);
    assetIdMap.set(asset.id, taskAsset.id);
  }

  if (params.layout.workspace) {
    const updatedLibrary: WorkspaceAssetLibrary = {
      workspaceName: params.layout.workspace.name,
      workspaceSlug: params.layout.workspace.slug,
      updatedAt: new Date().toISOString(),
      assets: [...workspaceAssets.values()],
    };
    await writeJson(params.layout.workspace.assetLibraryPath, updatedLibrary);
  }

  await writeJson(params.layout.materialsIndexPath, {
    generatedAt: new Date().toISOString(),
    workspace: params.layout.workspace,
    materials,
  });
  await writeText(path.join(params.layout.runDir, "materials.md"), createMaterialIndex(materials, params.layout.workspace));

  return {
    materials,
    materialsIndexPath: params.layout.materialsIndexPath,
    assetIdMap,
    workspace: params.layout.workspace,
    assetLibraryPath: params.layout.workspace?.assetLibraryPath,
  };
}

export function applyResolvedAssetsToPlan(params: {
  plan: StoryVideoPlan;
  materials: PersistedStoryMaterialAsset[];
  assetIdMap: Map<string, string>;
}): StoryVideoPlan {
  const materialById = new Map(params.materials.map((asset) => [asset.id, asset]));

  return {
    ...params.plan,
    materialAssets: params.materials.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      summary: asset.summary,
      visualDescription: asset.visualDescription,
      referencePrompt: asset.referencePrompt,
      seedancePromptHint: asset.seedancePromptHint,
      continuityAnchors: asset.continuityAnchors,
    })),
    segments: params.plan.segments.map((segment) => {
      const assetIds = uniqueStrings(
        (segment.assetIds || [])
          .map((assetId) => params.assetIdMap.get(assetId) || assetId)
          .filter((assetId) => materialById.has(assetId))
      );

      return {
        ...segment,
        assetIds,
      };
    }),
  };
}
