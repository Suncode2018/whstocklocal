# DAMAGE locations

Install before restarting the updated application:

```powershell
cd C:\code\whstocklocal
node scripts/migrate-damage-locations.js
```

Admin → Locations: create an active location such as WH01-DMG-01, Zone DAMAGE. Creating/changing DAMAGE requires ADMIN. A location with stock cannot be renamed, reassigned, deactivated or have its zone changed. Move stock instead.

Users with TRANSFER permission may move stock into DAMAGE, with a mandatory reference/reason. USER cannot withdraw, adjust, or bypass this by calling another stock API. ADMIN may return stock using Transfer or adjust non-container stock with a reason. RM containers must move as whole registered containers; partial container quantities and reserved containers are rejected. Container location and movement event are updated atomically with stock.

A database trigger guards stock mutations from all application paths. Authorization records are bound to the SQL session AND current transaction ID; an earlier pooled-connection authorization cannot authorize another transaction. Do not disable the trigger in routine operation. The application DB login needs access to sys.dm_tran_current_transaction (the existing dev login has been tested).

No existing stock, location or transaction is changed by the installer. Normal stock totals remain inclusive; DamageStock is separately exposed and excluded from UsableStock. Picking, shipping, PUTAWAY and BOM continue to use their eligible normal zones and do not offer DAMAGE for regular fulfillment. Existing lot-history limitations remain unchanged; damage transfer does not invent ANA/LOT for legacy stock.
