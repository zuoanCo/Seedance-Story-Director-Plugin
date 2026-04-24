# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.1.0] - 2026-04-24

### Added
- Initial enterprise-grade OpenClaw plugin scaffold for Seedance 2.0 story-driven video generation.
- `seedance_story_video` tool for long-form story expansion, shot planning, continuity-preserving segment generation, and final stitching.
- `seedance_single_video_test` tool for single-clip smoke tests against the configured Seedance endpoint.
- Seedance CN endpoint defaults aligned with the official `doubao-seedance-2-0-260128` task API shape.
- OpenAI-compatible director model layer with MiniMax M2.7 as the default planning backend.
- Local CLI entry point for dry runs and single-video validation.
- Unit tests covering director planning and service orchestration flows.
