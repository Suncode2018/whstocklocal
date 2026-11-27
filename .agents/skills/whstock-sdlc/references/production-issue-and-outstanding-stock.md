# Production Issue Documents and Outstanding OUT Stock

Read this reference when creating or changing production issue documents from BOM, document Flow UI, issue printing/PDF, or reports for stock staged at an OUT location but not yet shipped. Inspect the current LOAD and PICK implementations before changing behavior; LOAD is the UI and operational reference for document Flow, while PICK remains the stock-issuing operation.

## Production issue lifecycle

- Keep document creation separate from stock movement. Creating a production issue request records the FG, BOM/version, requested base quantity, eligible warehouses, and required component lines. It does not reserve or deduct stock unless an existing, explicitly designed operation does so.
- Preserve the four operator-facing stages in this order: **สร้างใบเบิก → รอเบิก → กำลังเบิก → เบิกครบแล้ว**. Treat the first stage as the completed document-creation milestone; `รอเบิก` is current when no confirmed PICK exists; `กำลังเบิก` is current after a partial confirmed PICK; `เบิกครบแล้ว` is complete only when every required component line has been fulfilled.
- Derive fulfillment progress from persisted PICK transactions tied to the issue document and matching product/category. Do not let viewing Flow, printing, downloading PDF, opening the PICK page, or entering an unconfirmed quantity advance the document or deduct stock.
- The **คีย์ยอดเบิก** action must open the supported PICK workflow with the issue reference and original component requirements. Deduct stock only when the operator confirms the actual picked quantity through PICK. Respect stock base units, warehouse scope, LOT/ANA lineage, existing PICK validation, transaction/duplicate protections, and partial picks.
- Show the four list actions in this order when the document state permits them: **ดู Flow · พิมพ์ · PDF · คีย์ยอดเบิก**. Completed or cancelled documents must not offer another stock-issuing action. Keep Flow read-only; it may show the actual status, per-component required/picked/remaining quantities, and PICK history.
- Style the Flow modal after the existing LOAD Flow: clear document summary and current status, START/END labels, connected step cards with arrows, distinct completed/current/pending/skipped states, and a readable item table. Reuse established WMS/Bootstrap patterns; do not change LOAD itself when implementing the production issue view.
- A cancelled document is terminal for fulfillment. Clearly mark remaining stages skipped and do not imply that cancellation reverses a PICK; reversal requires the application's explicit inventory reversal workflow and audit trail.

## Print and PDF

- Print/PDF are views of the same issue document. Include its issue number, creation date, FG, BOM version, requested production quantity, component lines, units, required quantity, actual picked quantity, remaining quantity, and fulfillment progress. Identify that stock movement is recorded by confirmed PICK; the request PDF alone is not proof of deduction.
- Preserve Thai glyphs using bundled project fonts. Repeat a compact document heading and table header on continuation pages; keep table rows together where practical and reserve enough room for totals/progress and signatures before starting a new page.
- Place footers/page numbers inside the page content area. Footer rendering must not trigger automatic page breaks. Verify the rendered PDF has no blank pages, clipped rows, orphaned signatures, or misleading page counts, including a single-page case and a long multi-page BOM.
- Keep printing and file download read-only with respect to stock and document fulfillment.

## Outstanding stock at OUT

- A report for “เบิกแล้วแต่ยังไม่ส่ง” must identify stock physically staged at a configured OUT location and distinguish it from a draft reservation or an already-shipped delivery. Use current delivery/LOAD status and stock movement records together; an OUT balance alone does not prove shipment state.
- Show SKU/name, quantity and base unit, warehouse/OUT location, source issue/pick or delivery reference, and the current stage/status. Keep the route to the source document visible so the operator can continue the existing LOAD workflow.
- Make filters and export behavior explicit and bounded for growing data. Keep on-screen results and CSV filters, permission checks, and warehouse scope aligned. Do not count the same stock twice when it appears in multiple document or movement records.
- Opening, filtering, exporting, or viewing this report must not create a delivery, alter reservations, or deduct stock. Shipment and any stock movement must happen only through the established LOAD confirmation flow.

## Verification

- Cover new issue, zero picks, partial picks across more than one SKU, fully fulfilled issues, cancelled issues, duplicate/retry requests, unauthorized warehouse access, empty results, and PICK failure without false progress.
- Confirm Flow and all print/PDF paths are read-only; assert stock changes only through a confirmed PICK and only by the actual quantity.
- For OUT reporting, verify unsent stock, draft delivery reservations, sent delivery, completed delivery, multiple warehouses, duplicate movement/document references, empty filters, and permission scope.
- Render PDFs and inspect every page. Run relevant unit/UI checks; run database integration only when explicitly requested and after inspecting whether the test writes to local SQL. Never execute a schema migration or write live inventory merely to demonstrate the UI.
