---
name: whstock-packaging-units
description: Design and change product stock units, packaging levels, conversion rules, and their master UI in WH Stock. Use for receiving, issuing, transfers, putaway, product packaging, or quantity conversion work.
---

# WH Stock Packaging Units

Apply these rules whenever product units or packaging conversions change.

## Reference data

- Use [packaging-unit-converter.csv](references/packaging-unit-converter.csv) as the project's working glossary for packaging levels, warehouse UOMs, handling units, transport terms, and document terms.
- Treat values marked as examples, typical flags, approximate, or requiring confirmation as reference only. Do not seed product ratios, GS1 identifiers, pallet quantities, shipping capacities, legal/tax rules, or document behavior from these examples without verifying the product or workflow source.
- For WH Stock packaging work, use the Packaging and Warehouse rows. Transport, Import/Export, and Document rows are glossary context only; they do not define product conversion factors or authorize changes to those workflows.
- Distinguish the stock/base UOM from Purchase UOM, Sales UOM, and Pick/Issue UOM. Each must have an explicit conversion to the base unit before an operational workflow uses it.
- Use the hierarchy concepts Base Unit/Each → Pack/Inner Pack → Case → Pallet as a guide, while allowing levels to be absent. A container is a transport level, not a GS1 packaging level. A pallet's calculated quantity is valid only when the actual layer pattern is known; do not assume every pallet has a GTIN.
- The CSV's pallet footprints are examples, not the WH Stock dimension. Use the project-specific pallet dimensions confirmed by the user for UI defaults and warehouse calculations.

## Preserve the stock unit

- Treat the product's existing `tblUnits` unit as the accounting and stock base. Packaging levels describe how the product is physically grouped; they must not silently replace or rescale the stock unit or current on-hand quantity.
- Make optional packaging levels truly optional. A product may have only a base unit, one packaging level, or multiple levels. Do not require the bag, case, outer pack, or pallet when the user has not established it.
- To define a level, require both its unit name and its quantity relative to the immediately lower/base level. Accept both blank or both valid; reject a half-filled pair.
- Never guess a conversion from a product group or packaging picture. For example, `1 ถุง = 1 PCS` is only saved when a user confirms both the unit and ratio.
- Keep physical net weight/volume distinct from conversion ratios. Do not convert mass to volume without a product-specific approved density.

## Quantity validation

- Require positive finite quantities within the database precision and configured limits. Apply integer-only rules when the base stock unit is discrete (such as PCS); permit decimals for measured units where the workflow supports them.
- Check hierarchy consistency. A child-level quantity cannot exceed its containing package's base quantity; where one level must divide evenly into another, show the derived count only when it is a whole number. Never round silently.
- Show a plain-language preview before save, for example `1 ถุง = 1 PCS` and `1 ลัง = 10 กล่อง = 60 PCS`. Label unconfigured levels as optional, not as zero.
- Validate in both browser and API. The API is authoritative and must retain authentication, ADMIN-only packaging edits, parameterized SQL, transactions, conflict checks, and audit history.

## Versioning and traceability

- Keep packaging version creation under explicit Admin control; never create a version automatically during editing, testing, or activation. An unreferenced version can be edited in place from one form/save, even if active; saving an active version atomically closes it, writes a status audit, and clears its calculation test so the admin can retest before reopening. An unused inactive draft may be deleted only with an audit snapshot and reason. A version referenced by documents or pallet layouts must remain unchanged; offer a clear copy-to-replacement flow only when its ratio needs to change, preserving historical meaning.
- Keep legacy versions readable when the new optional fields are null. Migration scripts should be idempotent and nullable for additive packaging metadata.
- When a calculation test fails, make the error dialog offer a direct repair action: edit an unreferenced Version in place, or open a copied replacement form for a referenced Version. Never make closing the Version the primary repair action; after saving, let Admin run the same calculation test again.
- Keep receipt, issue, transfer, and stock balance quantities in the existing base unit unless that operational workflow is explicitly extended and tested end-to-end.
- Preserve ANA/LOT lineage from transaction data. Packaging structure is not a lot identifier and must not imply GTIN registration. Do not infer missing historical traceability.
- Do not execute schema migrations or write a live inventory database unless the user explicitly requests it.

## UI and verification

- Use labels operators understand (`หน่วยสต๊อก`, `หน่วยย่อย เช่น ถุง`, `บรรจุชั้นแรก`, `ชั้นนอก`) and provide examples without preselecting unconfirmed ratios.
- Keep numeric controls keyboard-friendly and free of number spinners per project UI rules. Support narrow screens, visible validation, clear empty states, and keyboard focus for hierarchy actions.
- Test unchanged legacy products, optional level omitted, valid level added later, half-filled input, invalid/nonpositive values, PCS fraction, quantity exceeding its parent, historical version protection, admin authorization, and unchanged stock totals.
- Report which checks were run and whether a UI smoke test or live browser/database test was omitted.
