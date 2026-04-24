import { Type } from "@sinclair/typebox";

const AssetKindSchema = Type.Union([Type.Literal("character"), Type.Literal("prop"), Type.Literal("scene")]);
const AssetReuseModeSchema = Type.Union([
  Type.Literal("workspace_preferred"),
  Type.Literal("workspace_only"),
  Type.Literal("task_only"),
]);

const UrlReferenceSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Object({
    url: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    role: Type.Optional(
      Type.Union([
        Type.Literal("reference_image"),
        Type.Literal("reference_video"),
        Type.Literal("reference_audio"),
        Type.Literal("first_frame"),
        Type.Literal("last_frame"),
      ])
    ),
  }),
]);

export const StoryVideoToolSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  directorStyle: Type.Optional(Type.String()),
  targetMinutes: Type.Optional(Type.Number({ minimum: 0.25, maximum: 10 })),
  clipDurationSeconds: Type.Optional(Type.Integer({ minimum: 4, maximum: 15 })),
  aspectRatio: Type.Optional(Type.String()),
  referenceImages: Type.Optional(Type.Array(UrlReferenceSchema)),
  referenceVideos: Type.Optional(Type.Array(UrlReferenceSchema)),
  referenceAudios: Type.Optional(Type.Array(UrlReferenceSchema)),
  generateAudio: Type.Optional(Type.Boolean()),
  watermark: Type.Optional(Type.Boolean()),
  workspaceName: Type.Optional(Type.String()),
  workspaceDescription: Type.Optional(Type.String()),
  assetReuseMode: Type.Optional(AssetReuseModeSchema),
  assetKinds: Type.Optional(Type.Array(AssetKindSchema, { minItems: 1 })),
  generateAssetPack: Type.Optional(Type.Boolean()),
  outputDir: Type.Optional(Type.String()),
  dryRun: Type.Optional(Type.Boolean()),
  useFastModel: Type.Optional(Type.Boolean()),
});

export const SingleVideoToolSchema = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  clipDurationSeconds: Type.Optional(Type.Integer({ minimum: 4, maximum: 15 })),
  aspectRatio: Type.Optional(Type.String()),
  referenceImages: Type.Optional(Type.Array(UrlReferenceSchema)),
  referenceVideos: Type.Optional(Type.Array(UrlReferenceSchema)),
  referenceAudios: Type.Optional(Type.Array(UrlReferenceSchema)),
  generateAudio: Type.Optional(Type.Boolean()),
  watermark: Type.Optional(Type.Boolean()),
  workspaceName: Type.Optional(Type.String()),
  workspaceDescription: Type.Optional(Type.String()),
  assetReuseMode: Type.Optional(AssetReuseModeSchema),
  assetKinds: Type.Optional(Type.Array(AssetKindSchema, { minItems: 1 })),
  generateAssetPack: Type.Optional(Type.Boolean()),
  outputDir: Type.Optional(Type.String()),
  dryRun: Type.Optional(Type.Boolean()),
  useFastModel: Type.Optional(Type.Boolean()),
});

export const PrepareAssetsToolSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  directorStyle: Type.Optional(Type.String()),
  targetMinutes: Type.Optional(Type.Number({ minimum: 0.25, maximum: 10 })),
  clipDurationSeconds: Type.Optional(Type.Integer({ minimum: 4, maximum: 15 })),
  aspectRatio: Type.Optional(Type.String()),
  workspaceName: Type.Optional(Type.String()),
  workspaceDescription: Type.Optional(Type.String()),
  assetReuseMode: Type.Optional(AssetReuseModeSchema),
  assetKinds: Type.Optional(Type.Array(AssetKindSchema, { minItems: 1 })),
  outputDir: Type.Optional(Type.String()),
  dryRun: Type.Optional(Type.Boolean()),
});

export const CreateWorkspaceToolSchema = Type.Object({
  workspaceName: Type.String({ minLength: 1 }),
  workspaceDescription: Type.Optional(Type.String()),
  outputDir: Type.Optional(Type.String()),
});
