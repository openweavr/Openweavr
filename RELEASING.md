# Releasing a New Version

This document describes the release process for Weavr.

## Prerequisites

- You must be logged in to npm: `npm login`
- You must have push access to the GitHub repository
- All tests must pass: `npm test`

## Release Process

### 1. Ensure everything is ready

```bash
# Make sure you're on main branch with latest changes
git checkout main
git pull origin main

# Run tests
npm test

# Build to verify
npm run build
```

### 2. Create the release

Use `npm version` to bump the version. This will:
- Update version in `package.json` and `package-lock.json`
- Create a git commit with the version
- Create a git tag
- Push to GitHub (via postversion hook)

```bash
# For a patch release (0.1.3 -> 0.1.4)
npm version patch

# For a minor release (0.1.4 -> 0.2.0)
npm version minor

# For a major release (0.2.0 -> 1.0.0)
npm version major

# For a specific version
npm version 1.2.3
```

### 3. Publish to npm

```bash
npm publish
```

This will:
- Run `prepublishOnly` hook (build + test)
- Publish to npm registry

## Version Hooks

The following npm scripts run automatically during versioning:

| Hook | Script | Description |
|------|--------|-------------|
| `version` | `git add -A` | Stages all changes before commit |
| `postversion` | `git push && git push --tags` | Pushes commit and tag to GitHub |
| `prepublishOnly` | `npm run build && npm run test:run` | Builds and tests before publish |

## Troubleshooting

### "need auth" error when publishing

```bash
npm login
# Enter your npm credentials
```

### Version already exists

If a version tag already exists:

```bash
# Delete local tag
git tag -d v0.1.4

# Delete remote tag
git push origin :refs/tags/v0.1.4

# Try again
npm version patch
```

### Build fails during publish

Fix the issue, then:

```bash
# The version was already bumped, so just publish
npm publish
```

## Changelog

After releasing, consider updating the GitHub releases page with release notes.
