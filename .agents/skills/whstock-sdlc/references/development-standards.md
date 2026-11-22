# Development, Security, and Performance

Read this reference while implementing or reviewing code. Follow nearby project conventions when they are more specific.

## Coding standards

- Use the repository's JavaScript/CommonJS style and keep route handlers, business services, and presentation logic in their established layers.
- Validate at boundaries; use parameterized SQL through `mssql` request inputs. Escape user-visible content in client rendering and preserve established error response behavior.
- Keep changes focused. Update cache-busting asset versions when a page references a changed client script.
- Preserve pre-existing staged and unstaged changes. Do not silently revert, stage, commit, or include unrelated work.

## Security

- Preserve authentication, navigation/action permissions, warehouse scope, and product/category scope on both reads and writes.
- Never build SQL values from raw user input. Dynamic SQL fragments must come from trusted, validated allowlists.
- Validate type, length, range, and cross-field constraints. Protect state-changing operations with the existing transaction and duplicate/retry safeguards.
- Avoid exposing secrets, tokens, personal data, or raw SQL errors in logs and responses. Check CSV output for spreadsheet formula injection where user-controlled values are exported.

## Performance

- Inspect query cardinality, joins, correlated subqueries, and repeated reads; avoid N+1 patterns.
- For growing report/list data, constrain work with date/search filters and server-side limits or pagination; do not merely slice thousands of fetched rows in the browser and call it server pagination.
- Avoid loading full reference tables on every keystroke. Debounce only where useful, cancel stale requests when appropriate, and prevent duplicate initialization fetches.
- Add caching or indexes only with evidence and a clear invalidation/query rationale. Check for leaked timers, listeners, requests, and object URLs in long-lived UI flows.
