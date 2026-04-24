# Release Guide

## Pre-release checklist

1. Update `package.json` version.
2. Add a new entry to `CHANGELOG.md`.
3. Run:

```bash
pnpm install
pnpm check
pnpm build
pnpm test
```

4. Verify the plugin with:

```bash
pnpm test:single -- --input examples/single-video-request.json --dryRun
```

5. Commit the release changes.
6. Create an annotated git tag:

```bash
git tag -a v<version> -m "Release v<version>"
git push origin master --tags
```

## Optional live verification

If `ARK_API_KEY` and `DIRECTOR_OPENAI_API_KEY` are configured, run a live single-video generation before publishing a release.
