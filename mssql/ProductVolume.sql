/* Dimensions are measured in cm per product UOM; UnitVolumeCm3 is calculated as W*L*H. */
IF COL_LENGTH('dbo.Products', 'UnitVolumeCm3') IS NULL
  ALTER TABLE dbo.Products ADD UnitVolumeCm3 DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Products', 'UnitWidthCm') IS NULL
  ALTER TABLE dbo.Products ADD UnitWidthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Products', 'UnitLengthCm') IS NULL
  ALTER TABLE dbo.Products ADD UnitLengthCm DECIMAL(18,3) NULL;
GO

IF COL_LENGTH('dbo.Products', 'UnitHeightCm') IS NULL
  ALTER TABLE dbo.Products ADD UnitHeightCm DECIMAL(18,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.Products') AND name = 'CK_Products_UnitDimensions')
  ALTER TABLE dbo.Products ADD CONSTRAINT CK_Products_UnitDimensions CHECK (
    (UnitWidthCm IS NULL AND UnitLengthCm IS NULL AND UnitHeightCm IS NULL)
    OR (UnitWidthCm IS NOT NULL AND UnitLengthCm IS NOT NULL AND UnitHeightCm IS NOT NULL
      AND UnitWidthCm > 0 AND UnitLengthCm > 0 AND UnitHeightCm > 0)
  );
GO
