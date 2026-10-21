# Backend implementation report

Status: implemented, ready for independent whole-project review. No commits made. Source mutations stopped after handoff.

## Delivered

- PostgreSQL migration `db/001.sql` and explicit idempotent `scripts/migrate.ts`; lazy postgres client, parameterized queries, one-account constraint, one-active-focus index.
- Private account CLI with Argon2id, hidden interactive password or explicit `--generate` credentials written once to mode0600 `.local-credentials`; no automatic HTTP account bootstrap.
- Hashed opaque7day session cookies, HTTPS-derived Secure flag, HttpOnly/SameSiteStrict, exact Origin validation on cookie writes, persistent global login throttle, bounded JSON bodies, private/no-store responses, bearer restricted to exact health import route.
- Shared types and validated profile/log schemas; manual log CRUD with UUID replay detection; bounded history, truthful nullable aggregates, deterministic optional physiology estimates and rules.
- Focus transactional state machine with server timestamps/version checks, pause exclusion, retry-safe finish, offline finished-session import, 24h bound, Lisbon midnight/DST splitting and union of overlapping time intervals. Duration correction is an interval ending at the last recorded end.
- Apple Health batch import with strict values, atomic validation, source forced to apple-health, external-ID/date conflict protection, metric/day upserts, hash-only revocable integration tokens. Explicit manual daily corrections override imported totals instead of adding duplicate source totals.
- Complete API for dashboard/history, reading state, optional push, AI consent/config/budget checks, export, transactional validated restore and deletion. Worker table contract and all API payloads documented in `docs/api.md`.
- AI uses only a short aggregate summary, server-configured HTTPS endpoint, bounded output, timeout, DB reservations under lock and consent checks before send/save; no external call while disabled.

## Validation

Fresh final `npm test`: exit0,6files,29tests passed, including7 isolated PostgreSQL integration tests. Integration cases exercise real login/session, offline log UUID replay/conflict, atomic health import and daily replacement, bearer privacy, stale focus actions/retry-safe finish, export omission of secrets, malformed restore atomic rejection, valid restore, offline focus replay, AI rejection without consent, deletion/token revocation and retained account access. Domain cases cover impossible dates, imported provenance forgery, missing values, local midnight, DST rollback, source precedence, running24h cap and corrected-session overlap union. HTTP/push boundary cases cover Origin and allowed providers.

Tests were created before implementation. Initial domain/API RED runs failed on absent modules; later timer cap regression was observed as a behavioral failure (2880vs1440) and then passed with bounded aggregation. Full suite rerun after implementation passed. No test reads or prints real credentials or health data.

Fresh `npm run db:migrate`: exit0 against existing local database, all existing tables/indexes retained and migration completed. Typecheck during backend-only stage had no backend errors after fixes; it was temporarily blocked by absent frontend component, subsequently parent reports full typecheck/build passed. Parent owns final build and browser verification.

## Limits and operational details

- External AI provider calls and real Web Push delivery were not exercised because credentials/consent are intentionally absent. Provider URL is server-only; subscription endpoints restricted to Apple/Google/Mozilla HTTPS services.
- AI cents cap is an atomic application reservation allowance using `AI_CALL_RESERVATION_CENTS` (default100) and `AI_MONTHLY_LIMIT_CENTS` (default500). Configure a conservative reservation for the chosen model; actual billing protection additionally requires provider billing limits. Failed requests still consume allowance.
- JSON export/restore is bounded to10000logs,2000focus sessions,1000reading states and5MB restore; larger archives require PostgreSQL backup. Restore closes imported active timers at archive time, resets AI consent and revokes integration tokens. It retains account/session/push configuration.
- Data deletion retains account, authentication sessions and profile/goals while resetting AI consent; deletes personal records, reading state/picks, AI output/usage, push subscriptions and integration tokens. Shared feed articles remain cached. UI must describe this scope.
- Offline timestamps are user corrections; interval validation prevents malformed/future/overlapping submitted ranges but cannot attest actual learning. Totals explicitly describe recorded time.
- PostgreSQL integration suite creates/drops a uniquely named temporary database, requiring a local test role with CREATEDB; it skips when DATABASE_URL is absent.
- Independent review is still required by the parent workflow. No known failing check at handoff.

## Review corrections

Four independent regressions reproduced before changes: optional profile fields rejected null (400), latest imported weight overrode a manual daily correction in physiology estimates, auth responses lacked a persisted privacy generation, and export allowed archives larger than restore's download cap. Fixed with regression coverage:

- PATCH accepts null to clear age/heightCm/sex/massGoal, normalizes stored and returned profile to absent fields. ProfilePatch documents this contract.
- Latest physiology weight sorts by date, manual precedence, then occurrence timestamp, matching dashboard daily precedence.
- Shared MAX_ARCHIVE_BYTES is5242880; export and restore count UTF8 two-space pretty JSON bytes. Regression fixture has compact JSON below the cap and pretty JSON above it, and export now413.
- Persisted users.data_generation is returned top-level by auth/login and auth/me. Queued POSTlogs and POSTfocus/import require matching X-Data-Generation under a user lock. Restore/delete increment it in the same transaction and return it. Missing/stale generations409; old tabs cannot replay cleared records even while session remains valid. Existing DB migration applied successfully.

Fresh review validation: full suite6files/34tests passed,11 PostgreSQL integration cases passed, typecheck exited0. No known failing check; parent owns final formatting/browser/build and independent rereview.
