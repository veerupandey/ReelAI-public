# Product Lock Refactor Checklist

Track the ongoing refactor of the Brand Ad product-lock flow. Mark items as complete immediately after each task lands.

## Completed

- [x] Extract `ProductLockScreen` from `BrandVideoCreator`
- [x] Extract scene cards into `components/ProductLockSceneCard.tsx`
- [x] Extract active jobs UI into `components/ActiveJobsPanel.tsx`
- [x] Create shared product-lock types in `components/productLockTypes.ts`
- [x] Extract locked asset generation flow into `components/hooks/useLockedAssetJobs.ts`
- [x] Extract selected-scene inspector into `components/ProductLockSelectedScenePanel.tsx`
- [x] Extract shared asset lab into `components/ProductLockAssetLabPanel.tsx`
- [x] Extract imported-product header and asset grid into `components/ProductLockAssetGridPanel.tsx`
- [x] Extract scene-plan shell into `components/ProductLockScenePlanSection.tsx`
- [x] Extract scene-expansion / agency-autopilot panel into `components/ProductLockSceneExpansionPanel.tsx`
- [x] Extract ambiguous-product candidate fallback into `components/ProductLockCandidateSelectionPanel.tsx`
- [x] Extract the bottom action / handoff footer from `ProductLockScreen`
- [x] Reduce remaining helper/view logic inside `ProductLockScreen`
- [x] Start moving scene-plan state transitions out of `BrandVideoCreator`
- [x] Review whether product-lock components should move into a dedicated subfolder

## Remaining

- [x] Continue shrinking `BrandVideoCreator` by moving non-product-lock workflow logic into dedicated hooks/components
