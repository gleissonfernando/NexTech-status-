export type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export type HistoryStatus =
  | "operational"
  | "degraded"
  | "down"
  | "maintenance"
  | "no_data";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export type IncidentSeverity = "minor" | "major" | "critical";

export type MaintenanceStatus = "scheduled" | "in_progress" | "completed";

export interface HealthSource {
  path: string;
  label: string;
  latencyWarningMs?: number;
}

export interface ServiceRecord {
  id: string;
  category: string;
  name: string;
  description: string;
  critical: boolean;
  public: boolean;
  healthSources: HealthSource[];
  currentStatus: PublicStatus;
  responseTimeMs: number | null;
  uptimePercentage: number;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckRecord {
  id: number;
  serviceId: string;
  status: HistoryStatus;
  responseTimeMs: number | null;
  checkedAt: string;
  details: Record<string, unknown>;
}

export interface IncidentRecord {
  id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: string;
  resolvedAt: string | null;
  affectedServiceIds: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  title: string;
  status: MaintenanceStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  affectedServiceIds: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceSnapshot
  extends Pick<
    ServiceRecord,
    | "id"
    | "category"
    | "name"
    | "description"
    | "critical"
    | "currentStatus"
    | "responseTimeMs"
    | "uptimePercentage"
    | "lastCheckedAt"
  > {
  history: HistoryStatus[];
}

export interface StatusCategory {
  name: string;
  services: ServiceSnapshot[];
}

export interface StatusSnapshot {
  globalStatus: "operational" | "degraded" | "major_outage";
  globalMessage: string;
  generatedAt: string;
  servicesTotal: number;
  historyWindow: {
    bars: number;
    intervalSeconds: number;
    label: string;
  };
  categories: StatusCategory[];
  incidents: Omit<IncidentRecord, "createdAt" | "updatedAt">[];
  maintenances: Omit<MaintenanceRecord, "createdAt" | "updatedAt">[];
}
