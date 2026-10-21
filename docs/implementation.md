# Personal API implementation plan

Spec: pocetak.md; approved conversation architecture, October 15 2026.

## Constraints
- Private single-user Next.js/TypeScript PWA, PostgreSQL, manual Health Shortcut import, native Screen Time remains separate.
- Real persisted data only; Croatian user interface; no fabricated demo health metrics.
- Authentication required, scoped/revocable ingestion credentials, explicit opt-in before personal data leaves for AI.
- Offline queue, idempotent writes, one active focus session, timestamp-based duration, graphs and editable/deletable logs.
- Worker for allowlisted feeds, daily reading, summaries, optional push; backup and restore procedures.

## Tasks
1. Database, domain and API: migrations, account bootstrap, sessions, CSRF, login throttling, profile/goals, validated log CRUD, focus state transitions, Health import, history/dashboard, exports/restore/delete, reading and AI endpoints. Meaningful unit and PostgreSQL integration checks.
2. Frontend/PWA: responsive Croatian UI, login, dashboard/graphs, learning timer, log CRUD forms, profile/integrations, reading, AI consent, offline durable queue and privacy purge, installation and optional push.
3. Operations and documentation: local PostgreSQL, standalone deployment, worker, backups, Shortcut guide, pocetak.md and run instructions.
4. Whole-project verification and independent review; address correctness/security findings.

## Progress and decisions
- Workspace is a new empty folder. Git init is blocked by managed filesystem; working inside explicitly authorized folder without touching ancestor Desktop repository.
- Existing conversation plan authorizes verification scenarios. Tests cover actual domain/security/import/offline behavior rather than visual snapshots.
- Default UI is quiet functional editorial, system typography, green accent; final brand design remains later.
- AI provider is configured server-side (OpenAI-compatible HTTP endpoint) and external calls remain disabled until explicit user consent; no provider credentials or purchases inferred.
- Docker daemon initially stopped. No public deployment or external messages are authorized.

## Delivered and verified
- Database, authenticated API, responsive PWA, timer, log forms, graphs, Health ingestion, reading, profile, optional AI/push, worker and encrypted backups implemented.
- Local database initialized; private account credentials stored only in `.local-credentials`; app available at http://localhost:3000. No public deployment.
- Fresh checks: 35 unit/integration tests across 6 files; production build; TypeScript check; Playwright workflow including offline cold reload, queued delivery, timer persistence, 390px layout, failed-restore preservation and cross-tab logout.
- Independent review identified six important issues. Fixed: persisted server generation fences queued mutations against restore/delete; cross-tab private UI purge; explicit removal of optional profile values; bounded offline timer intervals; export byte limit matches restore; manual weight precedence in estimates; mobile logout.
- Targeted follow-up review found stale local timer generation and premature local purge on failed restore. Local timers now retain their original generation and are discarded on mismatch; restore/delete purge local state only after server success. Pending requests are fenced transactionally on the server. Follow-up reviewer stopped at its usage limit; these last corrections were inspected and verified by the primary agent.
- Encrypted PostgreSQL backup created successfully. Encryption round-trip/tampering checked by unit tests; destructive restore of the live personal database intentionally not executed.
- Physical iPhone Health/Shortcut permissions, installed iOS PWA/push, configured external AI calls and public HTTPS deployment require environment-specific setup/verification. Fitbit/native Screen Time integrations remain deferred as specified.
