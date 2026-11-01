/* Storage location volume capacity. Capacity applies to A- and B- storage bins.
   RCV (receiving) and OUT (shipping staging) locations have NULL capacity. */
IF COL_LENGTH('dbo.Locations', 'CapacityVolumeCm3') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityVolumeCm3 DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityWidthCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityWidthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityLengthCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityLengthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Locations', 'CapacityHeightCm') IS NULL
  ALTER TABLE dbo.Locations ADD CapacityHeightCm DECIMAL(18,3) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.Locations')
    AND name = 'CK_Locations_CapacityDimensions'
)
  ALTER TABLE dbo.Locations ADD CONSTRAINT CK_Locations_CapacityDimensions CHECK (
    (CapacityWidthCm IS NULL AND CapacityLengthCm IS NULL AND CapacityHeightCm IS NULL)
    OR (CapacityWidthCm IS NOT NULL AND CapacityLengthCm IS NOT NULL AND CapacityHeightCm IS NOT NULL
      AND CapacityWidthCm > 0 AND CapacityLengthCm > 0 AND CapacityHeightCm > 0)
  );
GO
