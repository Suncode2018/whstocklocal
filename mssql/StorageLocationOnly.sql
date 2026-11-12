USE dbWMS;
-- Location-only planning: keep historical volume values; new plans may omit volume.
ALTER TABLE dbo.StoragePlans ALTER COLUMN UnitVolumeCm3 decimal(18,3) NULL;
