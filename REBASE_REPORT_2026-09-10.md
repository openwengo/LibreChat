# LibreChat upstream review and rebase — 10 September 2026

The 11 local commits were reviewed against 849 new upstream commits. Five local commits remain, with a compatibility/report commit covering the adaptations and regression tests. The four GPT-5.6 commits, disconnected-MCP selection patch, and old scheduled-task implementation were superseded. Unrelated repairs embedded in the old scheduler commit were retained.

The target is upstream `origin/main` at `b356c3d87edccd0bde68dc90a5eca66ae2c80e5d` (10 September 2026 UTC), version `v0.8.8-rc2`. The previous common ancestor was `cf9a426d2`, dated 8 July 2026, version `v0.8.7`. This review covers the fetched release branch, not additional work on upstream `dev`.

The original tip, `0ea66d80a627bf119a0be580bf3de549b4021303`, is preserved by `backup/pre-upstream-rebase-2026-09-10`. No remote branch was pushed or rewritten. The contents of the original `.codex`, `MYBESTPRO-CA.crt`, and `SCHEDULED_TASKS.md` files were preserved. Upstream now tracks the same empty `.codex` file, so it becomes tracked; the other two remain untracked.

## Decisions for each local commit

| Original commit | Decision | Evidence / retained behavior |
| --- | --- | --- |
| `347c58e4c` — GPT-5.6 models | Drop | Upstream `b753da163`, PR #14206, contains this change. |
| `4a01b0e40` — GPT-5.6 cache-write surcharge | Drop | Included in #14206; use upstream's subsequent pricing updates. |
| `da5c5194c` — maximum reasoning effort and long-context cache premium | Drop | Included in #14206, with later reasoning support in #14232/#14233. |
| `21442b005` — cache-write billing and OpenRouter Claude effort mapping | Drop | Included in #14206, which also fixes emitted cache-write usage. |
| `f1cb54d3d` — Google Workspace group restriction | Keep as `9b0767f6c` | Upstream Google admin OAuth changes do not enforce `GOOGLE_WORKSPACE_GROUP`. Retained transitive membership checks, conditional scope, and access-token forwarding. Folded in the repairs/tests formerly buried in the scheduler commit. |
| `579fce3be` — MCP elicitation | Keep as `5e496899e` | Upstream agent-initiated questions are a different protocol. Upstream still lacks an MCP `elicitation/create` handler. Adapted event delivery and cleanup to the current resumable controller and reused the current tool-call ID prop. |
| `001143a51` — AWS/Mongo OAuth token storage | Keep as `cf95501ec` | Upstream has no configurable AWS MCP token backend. Retained `auth.tokenStore` and encryption settings while preserving upstream credential binding, conditional writes, and rollback. |
| `25585ef43` — select disconnected MCP servers with tools | Drop | Current upstream selection is independent of connection state, with on-demand/request-scoped connections and authorization readiness handled elsewhere. The local connectivity gate would reintroduce restrictions. |
| `723cf3e46` — isolate OAuth flows by deployment | Keep as `f7238ad71` | Retained deployment token keys, flow ownership checks, browser binding, callback server validation, and refresh of invalid session cookies. Preserved the final local commit stack's upstream-compatible tenant flow format. |
| `aeb951d35` — scheduled tasks | Drop scheduler; retain unrelated repairs | Upstream #14939 (`c5276fc63`) implements durable scheduled chats, followed by cron, timezone, multiple-weekday, project, HITL, sidebar, and MCP-preflight improvements. Preserved its Google fixes and applicable elicitation/type repairs. |
| `0ea66d80a` — stale MCP OAuth credentials | Keep the remaining delta as `dbeeab5d4` | Upstream covers much of runtime rejection recovery (#14684) and teardown/concurrency handling. Retained `invalid_scope` recovery and idempotent AWS deletion, using upstream credential-generation filters instead of broadly deleting all stored credentials. |

The final compatibility commit completes conflict adaptations across these retained commits. The hashes above identify the replayed commits; their final behavior includes that compatibility commit.

## Significant upstream changes reviewed

The complete chronological list is in [the upstream commit inventory](docs/rebase-2026-09-10-upstream.txt). The areas most relevant to this fork are:

- **MCP authentication and lifecycle:** trusted endpoint binding (#14578), per-user/server refresh coordination (#14596), readiness across replicas (#14629), runtime rejection recovery (#14684), cancellable discovery, stale callback cleanup, teardown fences, and empty-catalog readiness. The current connection manager has substantially different ownership and retry behavior; the old versions were not restored during conflict resolution.
- **Scheduling:** upstream's durable trigger engine and scheduled chats replace the independent local worker and side panel. Later changes add custom cron (#15084), timezone selection (#15119), multiple weekdays (#15120), chat projects (#15056), HITL pause verification (#15284), DocumentDB duplicate handling (#15622), sidebar refresh, and MCP readiness preflight (#15782).
- **Agent execution:** background tool calls, steering and queued messages, interrupt/preemption, durable trigger delivery, persistent subagent threads, attached code workspaces, and cancellation propagation. Elicitation now attaches to the current resumable path without restoring the removed legacy controller.
- **Models and usage:** merged GPT-5.6 support, later pricing and reasoning changes, and newer Claude/Gemini model support. The local model patches are no longer layered over upstream's accounting logic. `@librechat/agents` advances from `^3.2.61` to upstream `^3.8.5`.
- **Frontend and operations:** unified activity/tool displays, projects and sidebar work, theme foundation, streaming improvements, plugin/hook support, Langfuse configuration, security/dependency updates, and an explicit tenant-index upgrade command (#15767).

## Compatibility adaptations

1. Routed every affected MCP token consumer through the configured token store: ordinary tool calls, catalog initialization, OAuth callbacks and rollback, reconnects, revocation, scheduled-chat preflight, and account erasure. Action OAuth and ordinary login tokens continue using their existing stores.
2. Scoped token identifiers at the storage-method boundary. This preserves existing deployment-qualified token paths without modifying upstream's internal credential transaction algorithm. Queries retain the token value and `metadataCredentialSetId` selectors used to reject stale writes and deletes.
3. Added a shared mutation lease for AWS adapters, conditional record matching, non-overwriting creation, exact metadata replacement for rollback, and user-scoped cleanup. Secrets Manager cleanup now supports enumerating a user's records. These are needed because an AWS read followed by a write is not an atomic MongoDB conditional update.
4. Preserved upstream's refresh/teardown fences and token-generation checks. A rejected old OAuth operation cannot indiscriminately clear a newer authorization. `invalid_scope` now follows the conditional stale-registration cleanup path.
5. Updated elicitation's controller wiring, listener removal, unique request IDs, type annotations, import order, and tool-call correlation. Added localized validation messages, submission acknowledgement, and retry feedback. A real MCP client/server test exercises a request through the retained handler.
6. Preserved browser binding before opening OAuth and stopped the launch when binding fails. Replaced obsolete local controller tests with current upstream route/cleanup coverage and focused adapter tests.

## Validation

Validation used a separate worktree with fresh dependencies and Node `v24.17.0` / npm `11.13.0`, leaving the original checkout's installed dependencies and configuration files in place.

- Full `npm run build`: all five workspace builds passed, including the frontend production bundle.
- `packages/api`: `npx tsc --noEmit` passed.
- `client`: `npm run typecheck` passed.
- `packages/data-provider`: its build runs TypeScript checking and passed.
- Applicable static checks: ESLint, Prettier, import ordering, package manifests, and circular dependencies passed. TypeScript, config-schema, and config migration tests were run separately; the optional full static runner's unused-package and unused-translation audits were not run.
- Focused tests: **905 tests across 29 suites passed**: 381 package MCP/OAuth tests; 264 backend MCP routes/services, Google and cleanup tests; 26 MCP tool/scheduler initialization tests; 21 account-erasure tests; 143 config-schema tests; 32 config/migration tests; and 38 frontend tool, OAuth-binding, and elicitation-form tests.
- `git diff --check` passed.

The build emitted non-fatal Turbo cache permission and frontend chunk-size warnings. No live Google/AWS calls, production database migration, deployment, browser end-to-end suite, CI run, or remote PR review was performed. AWS tests use the real SDK command types with simulated service responses and the real local lease implementation; cross-replica Redis and live AWS behavior still require deployment integration testing. MCP elicitation retains its existing process-local pending-state model; this rebase does not turn it into upstream's durable HITL protocol.

## Deployment follow-up

**MongoDB indexes:** upstream explicitly requires an index migration for databases from v0.8.7 and earlier, including single-tenant deployments. Follow [UPGRADING.md](UPGRADING.md): back up MongoDB, stop all API/worker writers, preview with `npm run migrate:tenant-indexes:dry-run`, then run `npm run migrate:tenant-indexes` and restart only after success. Startup does not perform this migration automatically. No database was modified during this rebase.

**Scheduled tasks:** the old `scheduledTasks` configuration and `/api/scheduled-tasks` endpoints are replaced by upstream `interface.schedules` and `/api/schedules`. Scheduling is opt-in; enable it and grant the applicable `SCHEDULES` permissions. `SCHEDULES_DISABLED` is the upstream runtime kill switch.

The old `ScheduledTask` / `ScheduledTaskRun` collections are not the upstream `Schedule` / `ScheduleRun` collections. Existing schedules and run history are not automatically imported. Recreate schedules through the upstream UI/API or perform a reviewed migration. The essential field mapping is `userId → user`, `agentId → agent_id`, and `cron → cadence: { frequency: 'cron', expression: ... }`, preserving `name`, `prompt`, and `timezone`; upstream also owns admission slots, revisions, and execution state, so copying records directly is insufficient. Old schedule documents were not deleted.

**OAuth:** keep the deployment's existing `MCP_OAUTH_NAMESPACE` / `DOMAIN_SERVER` and token-store configuration to retain its token paths. Existing credentials lacking upstream's trusted endpoint/generation metadata may require reauthorization. Legacy unqualified `mcp:<server>` records are not used as a fallback by the scoped adapter, avoiding accidental cross-deployment reuse. For multiple API replicas using AWS token storage, the shared flow/Redis store must be common to those replicas. AWS IAM must allow the selected backend's reads/writes/deletes and, for user erasure, SSM path listing or Secrets Manager `ListSecrets`.

**Dependencies:** run the normal dependency reinstall/build process (`npm run smart-reinstall`) in the deployment or original checkout before starting the rebased code. The isolated validation install was not substituted for the original checkout's existing `node_modules`.

The original branch remains available as `backup/pre-upstream-rebase-2026-09-10`; `openwengo/main` was left untouched. Publishing the rebased fork later will require a deliberate history update against that remote.
