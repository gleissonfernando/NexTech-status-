export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export type ServiceVisualStatus = "operational" | "warning" | "degraded" | "critical" | "offline";

export type StatusService = {
  currentStatus: PublicStatus;
  uptimePercentage: number;
  lastCheckedAt: string | null;
};

export const STATUS_STALE_TIMEOUT = 180_000;

export const statusThresholds = {
  operational: 90,
  warning: 70,
  degraded: 40,
  critical: 1
};

export function normalizePercentage(value: unknown) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
  return Math.min(100, Math.max(0, numberValue));
}

export function isStaleDate(value: string | null, now = Date.now()) {
  if (!value) return true;
  const date = new Date(value).getTime();
  return Number.isNaN(date) || now - date > STATUS_STALE_TIMEOUT;
}

export function effectiveStatus(service: StatusService, now = Date.now()): PublicStatus {
  if (service.currentStatus === "maintenance") return "maintenance";
  return isStaleDate(service.lastCheckedAt, now) ? "unknown" : service.currentStatus;
}

export function serviceVisualStatus(service: StatusService, now = Date.now()): ServiceVisualStatus {
  const status = effectiveStatus(service, now);
  if (status === "unknown") return "offline";
  if (status === "major_outage") return "critical";
  if (status === "partial_outage") return "degraded";
  if (status === "degraded" || status === "maintenance") return "warning";

  const percentage = normalizePercentage(service.uptimePercentage);
  if (percentage >= statusThresholds.operational) return "operational";
  if (percentage >= statusThresholds.warning) return "warning";
  if (percentage >= statusThresholds.degraded) return "degraded";
  if (percentage >= statusThresholds.critical) return "critical";
  return "offline";
}

export function visualStatusLabel(status: ServiceVisualStatus) {
  const labels: Record<ServiceVisualStatus, string> = {
    operational: "Operacional",
    warning: "Atenção",
    degraded: "Degradado",
    critical: "Crítico",
    offline: "Offline"
  };
  return labels[status];
}
