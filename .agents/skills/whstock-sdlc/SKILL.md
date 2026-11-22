---
name: whstock-sdlc
description: Apply a lean, risk-based SDLC to WH Stock project changes and consult only the relevant design, development, or verification guidance.
---

# WH Stock Lean SDLC

Use for changes in this repository. Scale the process to risk; routine work should not require full documentation or every reference.

## Core flow

1. **Requirement:** Briefly identify the user outcome and acceptance criteria. Ask only for missing information that blocks a safe or correct change; otherwise proceed with a stated assumption.
2. **Design:** Inspect current code and trace affected layers/workflows. Read only the relevant reference below.
3. **Development:** Implement the smallest compatible change. Preserve unrelated staged and unstaged work.
4. **Test/review:** Run focused verification when requested. Review the diff and report exactly what ran and any remaining limitation.
5. **Release/maintenance:** Give migration, deployment, backup, or rollback guidance when relevant or requested. Do not commit, push, deploy, or write to a live stock database unless requested.

## Read the relevant reference

- UI, architecture, database schema, or API changes: [references/design-architecture.md](references/design-architecture.md)
- Implementation, security, or performance work: [references/development-standards.md](references/development-standards.md)
- Test strategy, review, release, or troubleshooting: [references/testing-release.md](references/testing-release.md)

For small isolated changes, the core flow is sufficient. For stock quantities, units, ANA/LOT, receiving, picking, transfer, putaway, permissions, schema, or deployment, inspect all affected layers and use the applicable references.

## Project map

- UI: `public/desktop`, `public/handheld`, `public/admin`; client assets: `public/js`, `public/css`.
- Server: `src/routes` (HTTP), `src/services` (business rules), `src/middleware` (auth, authorization, scope), `src/config` (database/navigation).
- SQL scripts: `mssql`; tests and checks: `tests`, `scripts`.

Reply in the user's language. Summarize outcome, changed files, verification, and limitations. Call out pre-existing unrelated changes separately.
