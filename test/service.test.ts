import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { runStoryAssetPipeline, runStoryVideoPipeline } from "../src/service.js";

describe("service pipelines", () => {
  it("resolves relative output directories", () => {
    const config = resolveConfig(
      {
        rendering: {
          outputDir: ".custom-seedance-output",
        },
      },
      { rootDir: "C:/workspace/demo" }
    );

    expect(config.rendering.outputDir).toContain(".custom-seedance-output");
  });

  it("stores task-scoped runs under the assets directory", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "seedance-task-assets-"));
    const manifest = await runStoryVideoPipeline({
      request: {
        mode: "short_film",
        title: "task-only-assets",
        text: "A courier crosses a rainy harbor city at dawn to deliver a sealed package.",
        dryRun: true,
      },
      rawConfig: {
        planning: {
          enableDirectorModel: false,
        },
        rendering: {
          outputDir: rootDir,
        },
      },
      runtime: {
        workspaceDir: rootDir,
      },
    });

    expect(manifest.runDir).toContain(path.join(rootDir, "assets", "tasks"));
    expect(manifest.materials.length).toBeGreaterThan(0);
    expect(manifest.materialsIndexPath).toBeTruthy();
  });

  it("reuses workspace assets across runs", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "seedance-workspace-assets-"));
    const rawConfig = {
      planning: {
        enableDirectorModel: false,
      },
      rendering: {
        outputDir: rootDir,
      },
    };

    const first = await runStoryAssetPipeline({
      request: {
        mode: "short_film",
        title: "workspace-assets-a",
        text: "A detective returns to the same abandoned observatory to investigate a glowing artifact.",
        workspaceName: "demo-workspace",
      },
      rawConfig,
      runtime: {
        workspaceDir: rootDir,
      },
    });

    const second = await runStoryAssetPipeline({
      request: {
        mode: "short_film",
        title: "workspace-assets-b",
        text: "A detective returns to the same abandoned observatory to investigate a glowing artifact.",
        workspaceName: "demo-workspace",
      },
      rawConfig,
      runtime: {
        workspaceDir: rootDir,
      },
    });

    expect(first.workspace?.name).toBe("demo-workspace");
    expect(first.materials.some((asset) => asset.scope === "workspace")).toBe(true);
    expect(second.materials.some((asset) => asset.status === "reused")).toBe(true);

    const library = JSON.parse(await readFile(first.assetLibraryPath!, "utf8")) as { assets: Array<{ id: string }> };
    expect(library.assets.length).toBeGreaterThan(0);
  });
});
