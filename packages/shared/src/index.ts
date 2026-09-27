export {
  adoptReportedRanges,
  applyCaption,
  applyOutcome,
  applyRefuseReason,
  applyRows,
  macsMatch,
  normalizeMac,
  readdressContinuity,
  shortMac,
  spansMatch,
  type AppliedRange,
  type ApplyResult,
  type ApplyRow,
  type ApplyStatus,
  type ReaddressDecision,
  type ReaddressStep,
} from "./apply.ts";
export {
  allOffConfirmCopy,
  allOffDockCaption,
  allOffRetryLabel,
  allOffRowLabel,
  allOffSummary,
  buildDeleteChecks,
  canDelete,
  deleteProgress,
  deleteRefuseReason,
  manageCaption,
  type AllOffCancelled,
  type AllOffLiveHint,
  type AllOffResult,
  type AllOffRow,
  type AllOffRowStatus,
  type DeleteCheck,
  type DeleteCheckKey,
  type DeleteCheckStatus,
} from "./manage.ts";
export { isLitBead, isUnknownBead, type BeadColor } from "./bead.ts";
export { catalogSnapshot, CURRENT_SLICE, type CatalogSnapshot } from "./catalog.ts";
export {
  BLINK_COLOR,
  BLINK_PULSE_MS,
  PREVIEW_SWATCHES,
  beadsFromLive,
  blinkRefuseReason,
  colorsMatch,
  countRangeMatches,
  fixtureCaption,
  hexToRgb,
  parseHexColor,
  parseLiveLeds,
  previewRefuseReason,
  proofLadder,
  resolveLiveTarget,
  rgbToHex,
  shouldRestoreOnEnd,
  type LiveEndKind,
  type LiveMatch,
  type LiveRead,
  type LiveRestoreSnapshot,
  type LiveSession,
  type LiveSessionKind,
  type LiveSource,
  type LiveTarget,
  type ProofRung,
  type SeenByYou,
} from "./live.ts";
export { getController, listControllers } from "./controller/catalog.ts";
export { wledController } from "./controller/wled.ts";
export type {
  ControllerCapability,
  ControllerDescriptor,
} from "./controller/types.ts";
export { listDiscoveryMechanisms } from "./discovery/catalog.ts";
export type {
  DiscoverReasonCode,
  DiscoverRow,
  DiscoverStatus,
  DiscoverVia,
  DiscoveryMechanism,
  DiscoveryMechanismId,
} from "./discovery/types.ts";
export {
  buildRangeDisplay,
  reportedRangeRails,
  type DeclaredRail,
  type DisplayRegion,
  type DriftNote,
  type RangeDisplay,
  type ReportedRail,
} from "./drift.ts";
export {
  emptyLightsPayload,
  type Element,
  type Light,
  type LightDetail,
  type LightNameSource,
  type LightReachability,
  type LightView,
  type LightsPayload,
} from "./lights.ts";
export {
  applyResolvedName,
  resolveLightName,
  type LightNameResolution,
} from "./name.ts";
export {
  decideProbeAddress,
  displayHost,
  isLanAllowed,
  normalizeHostKey,
  parseHostPort,
  type AddressDecision,
  type HostPort,
} from "./net/address.ts";
export {
  elementLength,
  firstFreeRange,
  intervalDifference,
  isWholeIndex,
  rangeLabel,
  rangesOverlap,
  symmetricDifference,
  unionIntervals,
  validateDeclaredRanges,
  type DraftRange,
  type RangeErrorCode,
  type RangeIssue,
  type RangeSpan,
} from "./range.ts";
export { getStrip, listStrips } from "./strip/catalog.ts";
export type { StripChannel, StripDriverDescriptor } from "./strip/types.ts";
export { ws281xStrip } from "./strip/ws281x.ts";
export {
  buildSafeWrite,
  fieldLabel,
  parseWledCfg,
  requestedFields,
  SAFE_FIELDS,
  safeCaption,
  safeFieldsMatch,
  safeInfoNameLagNote,
  safeRefuseReason,
  transitionMs,
  transitionUnitsFromMs,
  validateSafeDraft,
  type SafeFieldKey,
  type SafeFingerprint,
  type SafeRead,
  type SafeWriteResult,
  type WledSafeSettings,
} from "./safe.ts";
export { parseWledPayload, type WledSnapshot } from "./wled/snapshot.ts";
