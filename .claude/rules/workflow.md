# Workflow — Build, Verify, Version, Release

Everything non-code: commands, git hygiene, versioning, manual verification, and publishing to npm.

## Commands cheat sheet

```bash
npm install                                 # install deps (run once or after package.json changes)
npm run build                                # tsc → dist/
npm run dev                                  # tsc --watch (leave running during edits)
npm start                                    # node dist/index.js (after build)
npm start -- --config ./mssql-mcp.yaml       # start with config
npm start -- --config ./mssql-mcp.yaml --http 3000  # HTTP transport
```

- `build` must pass before any commit. It is the only automated safety net — **there are no tests**.
- `prepublishOnly` runs `build` automatically before `npm publish`, so you can't accidentally publish stale `dist/`.

## Git

- **Default branch is `master`**, not `main`. Don't `git checkout main`.
- Feature branches live under `feature/<name>` (historical: `feature/v1.2.0-major-update`, `feature/windows-auth-fix`).
- Fix branches live under `fix/<name>`.
- Commit messages follow the pattern from history:
  - `feat: <short description>` — new feature
  - `fix: <short description>` — bug fix
  - `docs: <short description>` — docs only
  - `chore: <short description>` — build, deps, version bumps
  - For major releases: `feat: v1.X.0 — <major feature>`
- Keep commits reviewable. The project has a clean linear history — don't introduce merge commits unless the user explicitly asks.

### Never commit

- `mssql-mcp.yaml` / `mssql-mcp.yml` (gitignored — real credentials)
- `.env`
- `node_modules/`
- `dist/` (gitignored — built on publish)

### Safe to commit

- Source in `src/`
- `package.json`, `package-lock.json`
- `CHANGELOG.md`, `README.md`, `LICENSE`
- `config.example.yaml` (template — no real credentials)
- `.claude/` directory (including this file — it's team-facing, shared in git)

## Versioning

Semver. The project ships a coordinated version in **three** places — keep them in sync:

1. `package.json` → `version`
2. `src/server.ts` → `new McpServer({ name: "...", version: "X.Y.Z" })`
3. `CHANGELOG.md` → new `## [X.Y.Z] - YYYY-MM-DD` section + link at bottom

Version bump commit convention: `chore: bump version to X.Y.Z`. Sometimes combined with the feature commit itself (see history: `feat: v1.3.0 — multi-server support`).

## CHANGELOG discipline

Every user-visible change goes in `CHANGELOG.md` under the current unreleased section. Use these headers (from Keep a Changelog):

- `### Added` — new tools, new features, new config fields
- `### Changed` — behavior changes, refactors that affect users, doc updates
- `### Fixed` — bug fixes
- `### Security` — SQL injection fixes, auth changes, anything CVE-adjacent
- `### Deprecated` / `### Removed` — for breaking changes (follow semver)

Internal refactors that don't affect users don't need a CHANGELOG entry. When in doubt, add one — an overfull changelog is better than a silent fix.

## Manual verification

Since there are no tests, every change needs a human-verified smoke run:

1. `npm run build` — must succeed with zero errors.
2. Start the server against a local SQL Express or Docker SQL instance:
   ```bash
   npm start -- --config ./mssql-mcp.yaml
   ```
3. Point an MCP client at it (Claude Desktop, or `curl` the HTTP endpoint with `--http`).
4. Exercise the specific tool(s) you changed:
   - Did the tool show up in `tools/list`?
   - Does it return expected output for a known table?
   - Does it respect the security mode? (Try read-only config + mutation tool → should refuse.)
   - Does the `server` parameter route correctly in multi-server mode?
5. For security-sensitive changes, add an attempted injection (`table: "x]; DROP TABLE y; --"`) and confirm `escapeIdentifier` neutralized it.
6. Check `health_check` against each configured server.

## HTTP transport smoke test

```bash
npm start -- --config ./mssql-mcp.yaml --http 3000
# In another terminal:
curl http://localhost:3000/health
# → {"status":"ok","servers":["default"]}
```

The `/mcp` endpoint speaks MCP Streamable HTTP — use an actual MCP client to test it, not raw curl.

## Publishing to npm

The package is published as `@tugberkgunver/mcp-sqlserver` under the public scope.

```bash
# 1. Ensure you're on master and clean
git status

# 2. Ensure build works
npm run build

# 3. Bump version in all three places (see "Versioning")

# 4. Commit, tag, push
git add package.json src/server.ts CHANGELOG.md
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin master --tags

# 5. Publish
npm publish --access public
```

`files` in `package.json` controls what ends up in the tarball: `dist/`, `config.example.yaml`, `README.md`, `CHANGELOG.md`, `LICENSE`. Nothing else. Check with `npm pack --dry-run` before publishing if you touched `package.json`.

### GitHub release

After npm publish, create a GitHub release for the tag. Copy the relevant `CHANGELOG.md` section as the release body. This keeps the CHANGELOG → npm → GitHub chain consistent for anyone browsing releases.

## Don't do this

- ❌ `npm publish` without `npm run build` first. `prepublishOnly` guards against this, but don't rely on it.
- ❌ Version bump in `package.json` only, forgetting `server.ts`.
- ❌ Force-push to `master`.
- ❌ Commit `dist/`.
- ❌ Leave real credentials in `config.example.yaml` when reviewing a user's fork.
- ❌ Skip the CHANGELOG "because the commit message says it". Users read CHANGELOG, not git log.
