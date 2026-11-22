# Optional packaging hierarchy and bag unit

Run on the target server after updating the code:

```powershell
cd C:\code\whstocklocal
node scripts/migrate-pack-three-levels.js
```

Restart the service and refresh the browser. This migration adds nullable package-level fields to `dbMaster.dbo.tblProductPackVersions`, including the optional inner unit (for example, bag) and its quantity. It does not change stock, existing quantities, or documents. Existing products may leave the bag fields blank; to add it later, create a new effective-date version.

In product Master → หน่วยและอัตราบรรจุ, create a new effective-date version. Bag unit and quantity are optional and must be entered together only when confirmed (for example, `1 ถุง = 1 PCS`). For T588880082: base label ซอง, 15 g/unit, กล่อง = 6 units, optional ลัง = 10 กล่อง. The existing PCS unit remains the accounting unit. New FG receipt, non-RM picking and desktop transfer helpers convert these inputs to base quantities before calling existing stock APIs. RM container handling remains separate.

Stock equivalents use the active version today and are estimates, not physical sealed-package counts. Existing documents retain their base quantities. This update does not retroactively assign packaging versions to historical transactions.

DEV configuration: T588880082 was configured with an initial version on 2026-11-12. T588880028 was left unchanged at 20 PCS per กล่อง.
