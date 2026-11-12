# Optional three-level packaging

Run on the target server after updating the code:

```powershell
cd C:\code\whstocklocal
node scripts/migrate-pack-three-levels.js
```

Restart the service and refresh the browser. This migration only adds nullable fields to dbMaster.dbo.tblProductPackVersions. It does not change stock, existing versions, or documents.

In product Master → หน่วยและอัตราบรรจุ, create a new effective-date version. Keep the third-level option off for two-level products. For T588880082: base label ซอง, 15 g/unit, กล่อง = 6 units, optional ลัง = 10 กล่อง. The existing PCS unit remains the accounting unit. New FG receipt, non-RM picking and desktop transfer helpers convert these inputs to base quantities before calling existing stock APIs. RM container handling remains separate.

Stock equivalents use the active version today and are estimates, not physical sealed-package counts. Existing documents retain their base quantities. This update does not retroactively assign packaging versions to historical transactions.

DEV configuration: T588880082 was configured with an initial version on 2026-11-12. T588880028 was left unchanged at 20 PCS per กล่อง.
