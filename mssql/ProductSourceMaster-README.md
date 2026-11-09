# Unified product master (dbMaster.dbo.tblProducts)

Run from the repository root with .env pointing at the intended dbMaster:

```powershell
node scripts/import-product-source-master.js
node scripts/migrate-product-master.js
```

Import preserves all 1,636 source rows from the original spreadsheet JSON; Needs_Review is not used. Source hash prevents repeated imports. Migration is transactional and repeatable. On the dev database it preserves the 2,600 original ProductIds and creates 930 new DRAFT records: 3,530 products total. All source entries are linked to a tblProducts row.

Before changes, migration creates ProductMasterMigrationBackup_20261108 with the original full product rows. Source import tables remain immutable provenance/history, not the editable master. Runtime listing and edits read and update tblProducts only.

Added columns: ProductName1, ProductName2 (nvarchar(2000)); ProID1–4 (nvarchar(500)); PhysicalForm (nvarchar(50)); MasterStatus (DRAFT/READY/INACTIVE); SourceMasterEntryId; RowVersion. ProductName is the display name, expanded to nvarchar(2000). Existing ThaiName remains independent. ProductCode and UnitId become nullable for drafts. A filtered unique index enforces non-null ProductCode uniqueness; references ProID1–4 may repeat. BULK is added to tblCategories.

Existing unambiguous linked products receive source names/references, preserving ProductId, ProductCode, CategoryId and UnitId. Source rows with ambiguous/repeated/absent codes get independent ProductIds. A new operational ProductCode is assigned only when its source main code is valid and unique and not already occupied; otherwise it remains NULL. No invented suffixes or merged stock identities.

All new records start DRAFT, UnitId=NULL, IsActive=0. The database check constraint forbids active non-READY products and forbids READY without code/name/unit. Admin or category EDIT users configure the code/unit then select READY in the UI. Original active records remain READY. API protects code/unit of established products, checks duplicate codes and uses RowVersion for concurrent edits. Source JSON and original backups are retained.

UI: /admin/index.html?view=master or /desktop/master.html?view=master. The normal table includes NAME1/NAME2 and draft badges. **จัดการ Master** opens the unified catalog: category filters, search across all codes/names, paging, names, reference codes, physical form, unit and status editing. Editing a draft from the main table opens this editor. The regular Add/Edit form also supports names and ProID fields; existing packing/version and volume features remain available. User category/action permissions are enforced server-side; BULK permissions follow tblCategories.

Inventory and transaction tables remain in dbWMS. Import/migration creates no stock quantities, UOM conversions, BOMs, supplier or manufacturing relationships. Drafts cannot receive/issue because they are inactive. Packaging versions remain in tblProductPackVersions.

Restart Node after deploying scripts/routes, then Ctrl+F5. For DESKTOP-RT67GE0, pull code, configure that machine's .env, execute both commands above against its database, then restart its Windows service. Git does not synchronize database rows.
