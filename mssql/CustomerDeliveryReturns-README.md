# Customer delivery return workflows

Run `CustomerDeliveryReturns.sql` against SQL Server after deployment. It creates or upgrades the customer return/claim tables and creates the Flow A returned-document register. The migration itself does not move or adjust stock.

## Flow A — normal delivery and proof documents

After the customer delivery is marked `RECEIVED`, the LOAD detail shows a returned-documents checklist. Record PO number, invoice number and whether the signed temporary delivery order came back from the carrier. The record can be updated as documents arrive. It changes no inventory. The document state is complete only after all three are checked; audit entries record each update.

## Flow B — return, shortage or damage claim

1. Create a case with SKU, case type, quantity, PO/INV/CN and reason. This reserves the shipped quantity against duplicate claims, but makes no stock movement.
2. When customer/carrier sends the goods back, record the carrier and tracking reference. This is the `IN_TRANSIT` step and still makes no stock movement.
3. When goods physically reach the origin warehouse, receive each SKU into an active `RCV` location. This step adds the received quantity to RCV and writes a `RETURN_IN` stock transaction in the same database transaction.
4. Inspect and put away normal goods to A/B/STORAGE. Damaged goods must be quarantined in DAMAGE and require TRANSFER permission. Shortage cases do not expect a physical return and never add stock. CN is an accounting reference and does not change stock.

Case quantities cannot exceed the shipped quantity less earlier cases. The current receive action records the full case quantity per SKU (partial receipts are not enabled yet). RM cases remain blocked until container-level return registration is supported. Existing legacy rows that were already added into RCV remain recorded as received to avoid adding the same stock a second time.
