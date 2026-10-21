# API contract v1

All endpoints use `/api/v1`, require the HttpOnly session cookie except login and exact bearer-only `/health/import`, return JSON with `Cache-Control: private, no-store`, and errors `{error:string}` with 400 validation, 401 auth, 403 Origin/consent, 409 conflict, 413 body size, 429 throttle, 503 unavailable. Cookie writes (including login) require `Origin` exactly matching APP_ORIGIN and no cross-site Sec-Fetch-Site. Fetch same-origin with JSON content-type; no bearer authorization accepted anywhere except import. GETs do not change personal data. No public signup.

Shared TS shapes live in `src/lib/types.ts`. POST/PATCH logs always supply complete LogRecord with caller-generated UUID. PATCH edits only manual records; imported values can be corrected by adding a manual record. Per-day manual steps/energy/weight/sleep override imported totals, nutrition manual entries sum independently per field and override that imported field. Imported entries are immutable in CRUD; token revocation stops future imports. Missing health values are null, timer absence is zero. Sleep manual date must match wakeTime in profile timezone.

## Endpoints
- POST `/auth/login` `{email,password}` → `{user:{id,email},profile,dataGeneration}` plus cookie. GET `/auth/me` → same. POST `/auth/logout` `{}` → `{ok:true}` and revoked cookie.
- GET `/profile` → `{profile}`. PATCH `/profile` top-level partial Profile → `{profile}`; explicit null clears age, heightCm, sex or massGoal (stored/returned as absent); goals supplied as full nested object. Optional physiology omitted when unknown; sex male/female used only for optional formula. massGoal maintain/lose/gain explicitly selects target; no deficit computed automatically.
- GET `/logs?days=7|30|90` → `{logs}` (max 10000, dates within requested range). POST `/logs` complete manual log → `{log}`. PATCH `/logs` complete manual log → `{log}`. DELETE `/logs` `{id}` → `{ok:true}`. Stable reused id with changed contents returns 409; same payload retries succeed. DELETE unknown id succeeds.
- GET `/focus` → `{active:FocusSession|null,recent:FocusSession[]}`. POST `/focus` FocusAction → `{session}`. Start `{action:'start',id,category}`; other actions `{action:'pause'|'resume'|'finish',id,version}`; correction `{action:'correct',id,version,durationMinutes}` only finished sessions (0–1440). Version increments; stale actions 409. Finish retry on finished id returns same state. One unfinished session (running or paused). Timestamps come from server, running timer is elapsed UTC intervals; pauses excluded, maximum counted session 24h. Correction uses an interval of the corrected duration ending at the last recorded end; local-day splitting and overlap union still apply. Category is an arbitrary 1–100 char label, default UI uses learning.
- GET `/dashboard?days=7|30|90` → Dashboard. GET `/history?days=...` → `{history}`. today is last dated history row. recentLogs max100. ActiveCalories is movement energy and never increases calorie allowance.
- GET `/export` → ExportData v1, no credentials/hashes/tokens/push endpoints/AI traces. POST `/restore` ExportData → `{ok:true,dataGeneration}`; replaces current logs, focus and reading state atomically, replaces profile, disables restored AI consent, revokes integration tokens and removes AI output/usage; max 10000 logs, 2000 focus sessions, 1000 read states, 5MiB UTF8 payload (5242880 bytes, including two-space pretty JSON formatting); no partially accepted records. Retains account/session/push configuration. Unknown article IDs in saved state are ignored. UI requires explicit warning before restore.
- POST `/data/delete` `{confirm:'DELETE MY DATA'}` → `{ok:true,dataGeneration}` clears logs, focus, reading state and daily picks, AI outputs/usage, push subscriptions, health dedup state and integration tokens. Account/email/password, sessions and profile/goals retained; aiConsent reset false. Articles are shared feed cache, retained.
- GET `/reading` → `{articles:Article[],date}` up to 50 recent articles with read and selected flags; selected daily picks first. POST `/reading` `{articleId,read}` → `{ok:true}`. Empty DB yields empty articles.
- GET `/insights` → InsightsResponse. POST `/insights/generate` `{}` → `{insight}`. Optional configured server provider, explicit consent, bounded summarized data only. Budget reserves conservative configured per-call cents and never refunds (failed calls also count). Rule insights always local.
- GET `/integrations` → `{active,createdAt,lastHealthSync}`. POST `/integrations/token` `{}` → `{token}` once, rotating existing token. DELETE `/integrations` `{}` → `{ok:true}`.
- POST `/health/import` bearer → `{ok:true,imported:number}`. Atomic batch 1–500, source forced apple-health. Metric/day upserts replace totals; externalId+metric cannot be reused for a different date. timezone validated when supplied; dates are explicit local date, sleep attributed to wake date by Shortcut. No session access using bearer.
- GET `/push` → `{configured,publicKey:string|null,subscribed:boolean}`. POST `/push` browser PushSubscription JSON → `{ok:true}`; DELETE `/push` `{endpoint}` or `{}` to remove all → `{ok:true}`.

## Log data shapes
Every manual log: `{id:UUID,kind,date:'YYYY-MM-DD',occurredAt:ISO8601,source:'manual',data:{...}}`.

|kind|data|
|---|---|
|weight|kg 20–400|
|workout|type string, durationMinutes 1–1440, note?|
|sleep|bedtime ISO, wakeTime ISO, quality integer1–5, awakeMinutes?; positive interval <=24h|
|nutrition|one or more of calories 0–15000, proteinGrams0–1000, carbsGrams0–2000, fatGrams0–1000|
|social|minutes0–1440,note?|
|steps|count integer0–200000|
|energy|activeCalories0–15000|
|measurement|waistCm30–250 and/or bodyFatPercent2–70|

Health example:
```json
{"records":[{"externalId":"steps-2026-10-15","metric":"steps","date":"2026-10-15","value":8340},{"externalId":"sleep-2026-10-15","metric":"sleepHours","date":"2026-10-15","value":7.5}],"timezone":"Europe/Lisbon"}
```
Other metrics activeCalories0–15000, weightKg20–400, nutritionCalories0–15000, proteinGrams0–1000. API returns imported LogRecord using `healthKey` metric and data keys count/activeCalories/kg/hours/calories/proteinGrams.

## Worker database contract
`sql` from `src/lib/db.ts`, postgres tagged template client. users(id UUID,email,password_hash,profile JSONB,created_at). profile uses shared Profile shape. Worker queries users and their profile.

articles(id TEXT PK,title TEXT,url TEXT UNIQUE,source TEXT,summary TEXT default '',minutes INT1–120,published_at TIMESTAMPTZ default now(),created_at TIMESTAMPTZ).

daily_reading(user_id UUID FK,date DATE,article_id TEXT FK) composite PK; reading_state(user_id,article_id,read BOOL,updated_at) PK user/article. push_subscriptions(user_id,endpoint TEXT,subscription JSONB,created_at) PK user/endpoint. job_runs(user_id,job TEXT,date DATE,created_at) PK user/job/date, available for dedup. integration_tokens(user_id,token_hash,created_at,last_sync) only API manages. AI module exports `generateInsights(userId):Promise<Insight>`, validates consent/config/budget every call. Parent owns src/lib/jobs.ts.

`POST /focus/import` accepts a completed offline timer `{id,category,createdAt,intervals:[{start,end}]}` (ISO timestamps). 1–200 ordered positive nonoverlapping intervals, total at most24h, no future timestamps beyond5min. Stable UUID retries succeed; differing replay409. Requires session and Origin. Server aggregates interval union across sessions, so overlapping timestamps are not counted twice. Restores close active sessions at export timestamp and bound total duration24h; restored sessions are finished.

AI budget env: `AI_MONTHLY_LIMIT_CENTS` default500 and `AI_CALL_RESERVATION_CENTS` default100. Reservation must conservatively cover the configured model's 500 output token request plus small aggregated prompt. Database reservation serializes concurrent calls and failed attempts still count. This limits application call allowances; configure provider billing limits separately for an actual invoice cap. No provider traffic occurs while config/consent/budget is absent.

## Offline privacy generation

`users.data_generation` is a persisted account generation. Login and auth/me return its current value as top-level `dataGeneration`. Every queued POST `/logs` and `/focus/import` MUST include `X-Data-Generation: <original integer>` captured when the item was created. Missing, malformed or stale generation returns409. Comparison occurs under the same user row lock as the write. Restore and data/delete increment the generation atomically and return the new value; old requests from any tab cannot repopulate cleared data even if its session remains valid. Clients discard stale queue data rather than updating its generation and replaying it.

`MAX_ARCHIVE_BYTES` is shared from types.ts:5242880. Server export rejects archives whose UTF8 two-space pretty JSON exceeds this cap, even when compact JSON would fit. Restore applies the same canonical pretty-size cap and raw HTTP body cap. Manual daily weight correction also supplies the weight used for protein/calorie estimates; date is ordered first, then manual precedence, then timestamp.
