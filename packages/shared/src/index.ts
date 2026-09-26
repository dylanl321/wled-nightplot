export { isLitBead, isUnknownBead, type BeadColor } from "./bead.ts";
export { catalogSnapshot, CURRENT_SLICE, type CatalogSnapshot } from "./catalog.ts";
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
  type LightReachability,
  type LightView,
  type LightsPayload,
} from "./lights.ts";
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
export { parseWledPayload, type WledSnapshot } from "./wled/snapshot.ts";
