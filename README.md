# Seedance Story Director Plugin

`Seedance Story Director` 是一个面向 `OpenClaw` 的企业级原生插件：它把一段故事文本扩展成可执行的短片分镜计划，使用 `火山引擎 / BytePlus ModelArk Seedance 2.0` 逐段生成视频片段，并在本地拼接成可交付的完整短视频。

核心能力：

- 先做“导演级”拆解：故事扩写、人物/场景 bible、镜头语言、前后镜头桥接。
- 自动产出基础物料参数：角色图、场景图、特殊道具图的参考 prompt、连续性锚点和 Seedance 提示片段。
- 支持项目级 `workspace`：同一项目下沉淀共享物料资产，后续任务可直接复用、按旧物料微调，或只做任务级临时物料。
- 针对 Seedance 单次最长约 15 秒的限制，自动拆成多个连续段落。
- 对后续片段自动注入上一段视频作为 continuity reference，尽量减少人物、服装、景别、光线和运动节奏漂移。
- 支持单视频生成测试，便于先验证账号、额度、模型和提示词风格。
- 输出完整产物目录：计划 JSON、分镜 Markdown、物料 JSON/Markdown、每段视频、最终拼接成片、执行 manifest。

## 1. 安装依赖

```bash
pnpm install
pnpm build
```

## 2. OpenClaw 加载方式

在 `openclaw.json` 中添加本地插件路径，并启用工具：

```json
{
  "plugins": {
    "load": {
      "paths": [
        "C:/path/to/openclaw-seedance-director-plugin"
      ]
    },
    "entries": {
      "seedance-story-director": {
        "enabled": true,
        "config": {
          "ark": {
            "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
            "videoModel": "doubao-seedance-2-0-260128",
            "directorModel": "MiniMax-M2.7",
            "directorBaseUrl": "https://api.minimaxi.com/v1",
            "directorApiKeyEnv": "DIRECTOR_OPENAI_API_KEY"
          },
          "planning": {
            "preferredAspectRatio": "16:9",
            "defaultClipDurationSeconds": 8,
            "defaultTargetMinutes": 2.5,
            "enableDirectorModel": true
          },
          "rendering": {
            "stitchSegments": true,
            "downloadRemoteOutputs": true
          }
        }
      }
    }
  },
  "tools": {
    "allow": [
      "seedance-story-director"
    ]
  }
}
```

## 3. 环境变量

最少需要：

```bash
export ARK_API_KEY="your-modelark-api-key"
export DIRECTOR_OPENAI_API_KEY="your-openai-compatible-director-api-key"
```

也可以先复制 `.env.example` 作为团队内部环境模板。

PowerShell:

```powershell
$env:ARK_API_KEY="your-modelark-api-key"
$env:DIRECTOR_OPENAI_API_KEY="your-openai-compatible-director-api-key"
```

插件当前默认对齐你提供的火山方舟国内区官方示例：

- 视频生成基座：`https://ark.cn-beijing.volces.com/api/v3`
- Seedance 2.0 视频模型：`doubao-seedance-2-0-260128`
- 请求路径：`/contents/generations/tasks`
- 关键字段：`content[]`、`generate_audio`、`ratio`、`duration`、`watermark`

导演/编导规划层现在按“OpenAI 兼容接口”接入：

- Director Base URL：`https://api.minimaxi.com/v1`
- Director Model：`MiniMax-M2.7`
- 鉴权环境变量：`DIRECTOR_OPENAI_API_KEY`
- 当前实现通过 OpenAI SDK 的 OpenAI-compatible Chat Completions 路径调用
- 默认值仍然指向 MiniMax 国内服务，但你可以替换成任何兼容 `base_url + api_key + model` 的服务

兼容环境变量：

- 通用：`DIRECTOR_OPENAI_API_KEY`、`DIRECTOR_OPENAI_BASE_URL`、`DIRECTOR_OPENAI_MODEL`
- 旧别名仍兼容：`MINIMAX_API_KEY`、`SEEDANCE_DIRECTOR_BASE_URL`、`SEEDANCE_DIRECTOR_MODEL`

如果你使用 BytePlus 国际区，也可以通过插件配置或环境变量改回对应 `baseUrl` 和 model id。

## 4. OpenClaw 中可用工具

### `seedance_story_video`

把长文本变成完整短片，并在需要时先沉淀角色/场景/道具物料。

建议使用示例：

```text
请调用 seedance_story_video，把这段故事改编成一支 2-3 分钟的电影感短片，使用 workspaceName=jiangnan-film，优先复用项目物料并补齐缺失的角色图、场景图和关键道具物料。
```

### `seedance_single_video_test`

只生成一条 Seedance 测试片段，适合验证账号、额度、风格和提示词。

建议使用示例：

```text
请调用 seedance_single_video_test，生成一个 8 秒的赛博雨夜街头镜头，人物从近景走向镜头，保留电影感与真实光影。
```

### `seedance_prepare_story_assets`

只做剧情物料准备，不出视频。适合先沉淀角色图、场景图、特殊物件图的参数包。

建议使用示例：

```text
请调用 seedance_prepare_story_assets，基于这段剧情为 workspaceName=river-town-project 产出角色、场景和道具物料，并尽量复用已有资产。
```

### `seedance_create_workspace`

创建一个项目级 workspace，用来共享资产和后续任务 run。

建议使用示例：

```text
请调用 seedance_create_workspace，创建一个名为 river-town-project 的项目工作区，用于沉淀这部短片的角色、场景和道具资产。
```

## 5. 本地单视频测试

```bash
pnpm test:single -- --input examples/single-video-request.json
```

如果你要直接复现你发来的官方多模态示例，可以用：

```bash
pnpm test:single -- --input examples/official-seedance2-multimodal.json
```

也可以直接传 prompt：

```bash
pnpm test:single -- --prompt "A lone astronaut walks through a flooded neon train station, cinematic realism, slow dolly-in."
```

如果还没有配置 `ARK_API_KEY`，可以先用 dry-run 检查规划与落盘：

```bash
pnpm test:single -- --input examples/single-video-request.json --dryRun
```

## 6. 输出目录结构

执行完成后默认输出到：

```text
.seedance-story-director/assets/tasks/<slug>-<timestamp>/
```

其中包括：

- `plan.json`：导演与分镜计划
- `storyboard.md`：适合人工 review 的镜头版脚本
- `materials.json`：当前任务实际使用的物料索引
- `materials/**/*.json`：角色图、场景图、道具图等物料参数
- `materials/**/*.md`：适合人工 review 的物料简报
- `manifest.json`：任务、URL、耗时、输出文件索引
- `segments/*.json`：每段任务元数据
- `segments/*.mp4`：下载到本地的分段视频
- `final/*.mp4`：拼接后的成片

如果传入 `workspaceName`，则目录会切到项目级共享空间：

```text
.seedance-story-director/workspaces/<workspace-slug>/
  workspace.json
  assets/
    asset-library.json
    materials/
      characters/
      scenes/
      props/
    runs/
      <slug>-<timestamp>/
```

在 `workspace` 下：

- 共享物料会写入 `assets/materials/**`
- 当前任务 run 会写入 `assets/runs/<run-id>/`
- 后续任务会优先参考 `asset-library.json` 里的旧物料
- 如果同名物料被改写，会在旧物料基础上更新 revision，而不是完全丢掉历史上下文

## 7. 设计原则

- 默认优先稳定性：先确保片段连续与成片可交付，再追求极端花哨效果。
- 多段成片默认关闭原生音频更稳；如果要开 `generateAudio`，建议先单片验证音轨风格。
- 当导演模型不可用时，插件会自动降级到启发式分镜模式，仍可生成可用成片。

## 8. 参考

- OpenClaw 官方插件文档：`https://docs.openclaw.ai/plugins`
- OpenClaw Tool Plugin 开发：`https://docs.openclaw.ai/plugins/building-plugins`
- BytePlus / ModelArk Seedance 2.0 文档：`https://docs.byteplus.com/api/docs/ModelArk/2291680`
