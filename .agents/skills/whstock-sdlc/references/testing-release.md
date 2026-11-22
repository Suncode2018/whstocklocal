# Testing, Review, Release, and Troubleshooting

Read this reference when the request includes testing, review, deployment, or debugging. Run checks that fit the change and the user's request; do not imply tests ran when they did not.

## Test selection

- Focused unit tests: `node --test tests/<relevant-file>.test.js`.
- UI smoke: `npm run test:ui`. It checks page and local JS/CSS availability, not interactive browser behavior. Start the app first; set `WMS_UI_BASE_URL` when it is not served on port 3000.
- `npm test` runs Node test discovery under `tests/`.
- Database integration commands are explicit: `npm run test:db`, `npm run test:master-data:db`, and `npm run test:locations:db`. Inspect each test's setup first: it may write temporary rows to local SQL and attempt cleanup. Run only when requested and when the target database is appropriate.
- For UI changes, use browser verification when the user asks for it; static smoke checks do not prove interactive behavior, so disclose that limitation when browser checks were not requested. For quantity/ANA/LOT changes, cover applicable partial, mixed, unknown-provenance, duplicate, cancellation, and retry cases.

## Review

- Review the final diff, including staged and unstaged state. Confirm no user changes were overwritten or accidentally included.
- Check success, validation failure, permission denial, empty results, timeout/failure handling, concurrency, and large-result behavior as applicable.
- Report changed files, exact checks run, failures or skipped checks, and remaining risks plainly.

## Release

- Before schema/data rollout, identify a backup or recovery point, migration ordering, downtime or locking impact, and rollback constraints.
- Do not run deployment, migration, Git commit, push, or production changes unless requested.
- After release, verify the served build/version and the affected workflow using safe read checks before considering the work complete.

## Debugging

- Reproduce and classify the symptom first. Trace request timing, logs, pool/SQL behavior, and call sites before increasing timeouts or retrying.
- Separate client cancellation from server failure. Look for duplicated requests, lock waits, unbounded queries, and exhausted pools before changing timeouts or capacity.
- Make the smallest evidence-backed fix, then verify the original failure path and a normal path.
