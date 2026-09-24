# LibreChat upstream review and rebase — 24 September 2026

The six local commits were replayed onto upstream `origin/main` at `f13b0eaef` (23 September 2026, version `v0.8.8-rc4`). The previous base was `b356c3d87` (10 September 2026, `v0.8.8-rc2`), so 215 upstream commits were reviewed; the chronological list is in [the upstream commit inventory](docs/rebase-2026-09-24-upstream.txt). Four further commits on upstream `dev` at the time of the rebase are not included.

All six local commits are kept. None of them is superseded by upstream: upstream still has no MCP `elicitation/create` handler, no configurable AWS token backend and no `GOOGLE_WORKSPACE_GROUP` enforcement. A final compatibility commit carries the adaptations below and this report.

The original tip, `966299018e31e6f206b9fee61631d4464ebe27f5`, is preserved by `backup/pre-upstream-rebase-2026-09-24`. No remote branch was pushed or rewritten. The uncommitted `docker-compose.yml` change and the untracked `MYBESTPRO-CA.crt` and `SCHEDULED_TASKS.md` files in the original checkout were preserved.

## Decisions for each local commit

| Original commit | Replayed as | Conflicts and resolution |
| --- | --- | --- |
| `598e960ae` — Google Workspace group restriction | `d21ce53ee` | `googleStrategy.js` conflicted with upstream's per-browser login state store (#15880). Kept both: the strategy takes the state store options and still wraps the login handler so the access token reaches the group check. |
| `e5ca1d23f` — MCP elicitation | `6126bfda2` | Applied cleanly. |
| `61f25e4a1` — AWS/Mongo OAuth token storage | `e39bf0eb6` | Upstream moved token reads into `readStoredTokens` and added a cross-replica refresh flight (#15993). Both now decode through `decodeToken`, so `encryptBeforeStore: false` records still read back. The scheduled-chat preflight, restructured upstream for renewable credentials (#15908), still uses `getTokenStoreMethods()`. `auth` and upstream's new `permissions` both remain on `configSchema`. |
| `80414612b` — isolate MCP OAuth flows by deployment | `875191577` | Upstream replaced `window.open` with `openInNewTab` for iOS home-screen apps (#16077). The MCP OAuth window still binds the browser first and now opens through `openInNewTab`. The pending-flow button keeps calling `continueOAuth`. |
| `a9cbe7ae3` — recover stale MCP OAuth credentials | `0ae51eb19` | Test import merge only. See adaptation 4 for the behavior conflict. |
| `966299018` — 10 September compatibility and report | `aede6a783` | Import-only conflicts in `MCPManager.ts`, `handler.ts`, `ToolCall.tsx` and the English translation file. |

## Upstream changes relevant to this fork

- **Claude Opus 5.5 (#16215):** `claude-opus-5-5` is added to the default Anthropic, Bedrock and Vertex model lists. It gets 1M context, 128K output and $4 / $20 per million tokens (cache write $5, read $0.20). Thinking is always adaptive, with `block_binding: drop_block` under the `thinking-binding-controls-2026-08-01` beta. The thinking and sampling controls are hidden for this model.
- **MCP OAuth:** cross-replica refresh serialization (#15993, opt-in per server through `oauthRefreshCoordination`). Also: authorization preserved through token endpoint outages (#16126), refresh of credentials that arrive already expired (#16111), a sign-in prompt when a server rejects refreshed tokens (#16075), an opt-out of the `resource` parameter (#15982), callbacks landing on waiting connections (#15876), and several catalog-recovery fences.
- **Login:** social logins are bound to the browser that started them (#15880), and local and 2FA logins reject cross-origin browser requests.
- **Other:** GPT-6 Sol/Luna, Grok 4.7, the conversation trace viewer, sidebar filtering and pinning, attached-workspace isolation, credit reservation for in-flight requests, and `@librechat/agents` `^3.8.5` → `^3.9.3`. The repository moved to the `LibreChat-AI` organization.

## Compatibility adaptations

1. **Google group check.** `getGoogleScopes` and `checkGroupMembership` moved unchanged from `googleStrategy.js` to `api/strategies/googleGroup.js`, which needs only the logger and the Cloud Identity client. The OAuth routes require that module and `checkGoogleGroup.js` directly. Previously the route loaded the whole social-login chain to get the scope list, and took the middleware from the index that upstream's route tests replace. The spec moved with the helpers. A new route test proves the Google callback requests the group scope and refuses a callback without membership evidence before the login handler runs.
2. **Refresh flight lease per deployment.** Upstream keys its refresh flight by tenant, user and server name. Scoped token methods store each deployment's credential at `mcp:<namespace>:<server>`, so the flight now also carries the `MCP_OAUTH_NAMESPACE` namespace. Without it, a deployment sharing Redis with another would wait on, and could fail with `MCPTokenRefreshUnavailableError` behind, a refresh of a credential it does not share. This matters only for servers with `oauthRefreshCoordination: true`. The flight is new in this release, so old replicas never took it and a rolling deploy cannot mix keys.
   The teardown/persistence fence (`getMCPOAuthLeaseId`) still has no namespace, as before this rebase. It is shared across deployments that share Redis, which at worst briefly serializes their persistence. Namespacing it would split the fence between old and new replicas during a rolling deploy.
3. **Token-store decoding.** Upstream's new token read helper and refresh redemption decrypt through `decodeToken`, as covered in the table above.
4. **`invalid_scope` on refresh.** Upstream now returns `null` for `invalid_scope`, together with `unsupported_grant_type`, `invalid_request`, `invalid_target` and `access_denied`, and keeps the stored client registration. The fork instead conditionally deletes the stale client registration and refresh token and raises `ReauthenticationRequiredError`, so the next authorization registers with the current scopes instead of reusing the rejected registration. `invalid_scope` is removed from upstream's early-return list; the other four codes keep upstream's behavior. Upstream's table test drops that one case; the fork's existing test covers it.
5. **Elicitation hooks on connections.** `MCPManager.callTool` sets and clears the tool-call ID through optional calls, the file's existing convention for connection capabilities (`getOAuthCredentialSetId?.()`). The elicitation listener is attached only to event-emitting connections. This fixes 65 `MCPManager.test.ts` failures on upstream's plain connection stubs. **56 of them already failed on the 10 September result;** that suite was not among the ones the previous report ran. The real MCP client/server elicitation test still passes.
6. **Namespaced flow IDs in upstream tests.** Two race-condition tests seeded pending flows under upstream's unscoped `user:server` ID. They now use `MCPOAuthHandler.generateFlowId`. The MCP OAuth hook test asserts the iOS-safe link opening instead of `window.open`.

## Validation

Validation used a separate worktree with a fresh `npm ci`, using Node `v24.17.0` and npm `11.13.0`. The original checkout's dependencies were not touched. A second throwaway worktree of pristine `origin/main`, sharing those dependencies, provided the upstream baseline for the failing suites (345 of 345 passing there).

- `npm ci` completed against the merged lockfile, and `npm run build` built all five workspaces, including the frontend bundle.
- `packages/api` `npx tsc --noEmit` and `client` `npx tsc --noEmit` passed. The `data-provider` build runs `tsc` and passed.
- `packages/api` unit suite (integration suites excluded, as in `test:ci`): **15,600 tests in 594 suites passed**, 8 skipped.
- `api` focused suites (Google group, OAuth routes and login state, MCP routes and services, tools, schedules, MCP initialization, OAuth reconnect, token store, account erasure, social logins, server index, auth routes): **892 tests in 50 suites passed**.
- `client` MCP hooks and components, tool call and elicitation content, MCP builder and store: **962 tests in 78 suites passed**.
- `packages/data-provider` suite: **2,109 tests in 50 suites passed**, 1 skipped.
- The new route test was mutation-checked: it fails when the group middleware is removed from the Google callback.
- `npm run static-checks -- --against origin/main` passed over the 75 files the fork changes: ESLint, Prettier, import sorting, package manifests and circular dependencies. Its `--full` gates (TypeScript, config migration tests, unused i18n keys, unused npm packages) were not run through the script; TypeScript was checked separately above.
- `git diff --check origin/main HEAD` passed.

Not run:
- The Redis `*.cache_integration.*` suites, which need a Redis server.
- Live Google, AWS or Anthropic calls, and browser end-to-end tests.
- CI and a remote review.

## Deployment follow-up

- **Dependencies:** run `npm run smart-reinstall` in the original checkout or the deployment before starting the rebased code (`@librechat/agents` `^3.9.3`).
- **Redis streams:** Redis-backed streams now coalesce deltas in a 25 ms window when `STREAM_DELTA_COALESCE_MS` is unset. Set it to `0` to keep per-delta publication. See `UPGRADING.md`.
- **MCP refresh coordination:** `oauthRefreshCoordination` stays off by default. Enable it per server only after every replica runs this build. With the AWS token store, the flow/Redis store must be shared by the replicas, as before.
- **OAuth:** keep `MCP_OAUTH_NAMESPACE` / `DOMAIN_SERVER` and the token-store configuration unchanged to retain existing token paths.
- **Images and Helm:** published images move to `registry.librechat.ai/librechat-ai/...`, and upstream mirrors the old namespace. The Helm chart now requires named credential secrets (#16175).
- **Claude Opus 5.5:**
  - Add `claude-opus-5-5` wherever the model list is pinned (the local `.env` sets `ANTHROPIC_MODELS`).
  - Set `effort` explicitly where quality matters: the API default for this model is `medium`, where Opus 5 ran at `high`.
  - A reverse proxy must forward the `anthropic-beta` header and the `thinking.block_binding` field.
- **MongoDB:** no new migration since `v0.8.8-rc2`. The tenant-index migration from the previous report still applies to databases from `v0.8.7` or earlier.

The original branch remains available as `backup/pre-upstream-rebase-2026-09-24`, and `openwengo/main` was left untouched. Publishing the rebased fork will require a deliberate history update against that remote.
