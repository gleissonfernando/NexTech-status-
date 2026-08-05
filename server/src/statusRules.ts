import type { PublicStatus, ServiceRecord } from "./types.js";

export const STATUS_STALE_TIMEOUT_MS = 60_000;

export function isOfflineStatus(status: PublicStatus) {
  return status === "unknown";
}

export function isStaleStatus(lastCheckedAt: string | null, now = Date.now()) {
  if (!lastCheckedAt) return true;
  const checkedAt = new Date(lastCheckedAt).getTime();
  return Number.isNaN(checkedAt) || now - checkedAt > STATUS_STALE_TIMEOUT_MS;
}

export function effectiveServiceStatus(service: ServiceRecord, now = Date.now()): PublicStatus {
  if (service.currentStatus === "maintenance") return "maintenance";
  return isStaleStatus(service.lastCheckedAt, now) ? "unknown" : service.currentStatus;
}
