# Design and Architecture

Read this reference for architecture, database, API, or UI design changes. Inspect the actual implementation and existing SQL scripts before proposing new conventions.

## Architecture

- Current server stack is Express on Node.js; persistence is Microsoft SQL Server through the existing `mssql` configuration in `src/config/db`.
- Keep responsibilities in the existing layers: `public/` UI and assets, `src/routes/` HTTP handling, `src/services/` business rules, `src/middleware/` cross-cutting access/scope, and `src/config/` shared setup.
- Prefer extending an existing route/service/module over adding a parallel abstraction. Explain a structural change briefly when it affects more than one workflow.

## Database

- Inspect current table definitions, SQL deployment scripts under `mssql/`, and service queries before changing schema.
- Preserve existing keys, types, naming, quantity precision, and history/audit patterns. Check indexes against actual filter and join predicates; do not add speculative indexes.
- For migrations, state the data compatibility, execution order, and rollback or recovery path. Do not execute a migration or write stock data unless requested.
- For inventory flows, preserve stock invariants and ANA/LOT provenance across receive, pick, transfer, cancellation, and putaway. Do not invent provenance when history is unknown.

## API design

- Follow existing `/api/...` route patterns and shared authentication, navigation authorization, warehouse scope, and product scope middleware.
- Validate and bound query/body inputs. Keep response shapes and Thai error messaging consistent with nearby endpoints; use status codes that distinguish invalid input, missing permission, conflict, and server failure.
- For reports, support explicit filters and bounded pagination where result sets may grow. Keep CSV filters/permissions aligned with the on-screen query and make large exports an explicit user action.
- Avoid breaking established clients; if a response contract must change, find and update all consumers in desktop, admin, and handheld interfaces.

## UI design

- Inspect the target page and shared styles before adding design tokens or components. Reuse the current Bootstrap and WMS styles unless there is a concrete reason to extend them.
- Keep the primary task and next action obvious. For large reports, avoid automatic wide reads on open; use clear filters, explicit search, independent filter options, pagination, and loading/empty/error states where appropriate.
- In read-only tables, summaries, and detail views, render optional identifiers with no value (for example ANA No. or LOT No.) as `—` instead of repeating labels such as “ไม่ระบุ ANA”. Add one nearby explanation when `—` could mean either missing data or unknown historical provenance. Keep editable inputs empty; do not put `—` into a field that may be saved as data.
- Do not use `—` for meaningful numeric zero, a known status, or an action the user must take. Preserve distinctions between “not provided”, “not applicable”, and “cannot be traced” when they affect warehouse decisions; explain those distinctions concisely in context.
- This project does not use browser number-input spinner arrows. Hide them consistently for `input[type=number]` in shared WMS styles and on standalone pages. Keep keyboard entry, validation, min/max, step, and mobile decimal-keyboard behavior intact; do not replace numeric fields with text inputs just to hide the arrows.
- Text boxes must never fade entered values. Keep text and placeholders fully opaque and readable, including readonly or disabled fields; distinguish unavailable fields with their background and border instead of opacity.
- Check responsive layout, keyboard access, labels, focus, contrast, and control sizes for the affected interaction. Do not redesign unrelated pages.
