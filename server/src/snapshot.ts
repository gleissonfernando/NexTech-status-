import type { StatusStore } from "./store.js";
import type {
  CheckRecord,
  HistoryStatus,
  PublicStatus,
  ServiceSnapshot,
  StatusSnapshot
} from "./types.js";
import { effectiveServiceStatus, isOfflineStatus } from "./statusRules.js";

const HISTORY_BARS = 96;
const HISTORY_INTERVAL_SECONDS = 900;

function toHistoryStatus(status: PublicStatus): HistoryStatus {
  if (status === "operational") return "operational";
  if (status === "degraded") return "degraded";
  if (status === "maintenance") return "maintenance";
  if (status === "unknown") return "no_data";
  return "down";
}

function worstHistoryStatus(values: HistoryStatus[]): HistoryStatus {
  if (values.includes("down")) return "down";
  if (values.includes("degraded")) return "degraded";
  if (values.includes("maintenance")) return "maintenance";
  if (values.includes("operational")) return "operational";
  return "no_data";
}

function buildHistory(serviceId: string, checks: CheckRecord[]) {
  const now = Date.now();
  const buckets: HistoryStatus[][] = Array.from({ length: HISTORY_BARS }, () => []);
  const windowMs = HISTORY_BARS * HISTORY_INTERVAL_SECONDS * 1000;
  const start = now - windowMs;

  for (const check of checks) {
    if (check.serviceId !== serviceId) continue;
    const checkedAt = new Date(check.checkedAt).getTime();
    if (Number.isNaN(checkedAt) || checkedAt < start) continue;
    const index = Math.min(
      HISTORY_BARS - 1,
      Math.max(0, Math.floor((checkedAt - start) / (HISTORY_INTERVAL_SECONDS * 1000)))
    );
    buckets[index].push(check.status);
  }

  return buckets.map(worstHistoryStatus);
}

function currentStatusHistory(status: PublicStatus) {
  return Array.from({ length: HISTORY_BARS }, () => toHistoryStatus(status));
}

function calculateGlobalStatus(services: ServiceSnapshot[], incidentsCount: number) {
  const visible = services.filter((service) => service.currentStatus !== "unknown");
  if (services.length > 0 && visible.length === 0) {
    return {
      globalStatus: "degraded" as const,
      globalMessage: "Serviços da NexTech estão sem comunicação recente."
    };
  }

  const criticalDown = visible.some(
    (service) =>
      service.critical &&
      (service.currentStatus === "major_outage" ||
        service.currentStatus === "partial_outage")
  );
  if (criticalDown) {
    return {
      globalStatus: "major_outage" as const,
      globalMessage: "Serviços críticos da NexTech estão indisponíveis."
    };
  }

  const degraded = visible.some(
    (service) =>
      service.currentStatus === "degraded" ||
      service.currentStatus === "partial_outage" ||
      service.currentStatus === "major_outage"
  );
  if (degraded || incidentsCount > 0) {
    return {
      globalStatus: "degraded" as const,
      globalMessage: "Alguns serviços da NexTech apresentam instabilidade."
    };
  }

  const inMaintenance = services.some((service) => service.currentStatus === "maintenance");
  if (inMaintenance) {
    return {
      globalStatus: "degraded" as const,
      globalMessage: "Há manutenção em andamento em serviços da NexTech."
    };
  }

  return {
    globalStatus: "operational" as const,
    globalMessage: "Todos os serviços estão operacionais."
  };
}

export function buildSnapshot(store: StatusStore): StatusSnapshot {
  const since = new Date(
    Date.now() - HISTORY_BARS * HISTORY_INTERVAL_SECONDS * 1000
  ).toISOString();
  const checks = store.getChecksSince(since);
  const now = Date.now();
  const services = store.listServices(false).map<ServiceSnapshot>((service) => {
    const currentStatus = effectiveServiceStatus(service, now);
    const offline = isOfflineStatus(currentStatus);

    return {
      id: service.id,
      category: service.category,
      name: service.name,
      description: service.description,
      critical: service.critical,
      currentStatus,
      responseTimeMs: offline ? null : service.responseTimeMs,
      uptimePercentage: offline ? 0 : service.uptimePercentage,
      lastCheckedAt: service.lastCheckedAt,
      history: offline
        ? currentStatusHistory("unknown")
        : currentStatus === "operational" || currentStatus === "degraded"
        ? currentStatusHistory(currentStatus)
        : buildHistory(service.id, checks)
    };
  });

  const activeIncidents = store
    .listIncidents(20)
    .filter((incident) => incident.status !== "resolved");
  const incidents = [...activeIncidents, ...store.listIncidents(20)]
    .filter((incident, index, all) => all.findIndex((item) => item.id === incident.id) === index)
    .slice(0, 20)
    .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...incident }) => incident);
  const maintenances = store
    .listMaintenances(20)
    .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...maintenance }) => maintenance);
  const { globalStatus, globalMessage } = calculateGlobalStatus(
    services,
    activeIncidents.length
  );

  const categories = Array.from(
    services.reduce((map, service) => {
      const current = map.get(service.category) ?? [];
      current.push(service);
      map.set(service.category, current);
      return map;
    }, new Map<string, ServiceSnapshot[]>())
  ).map(([name, categoryServices]) => ({ name, services: categoryServices }));

  return {
    globalStatus,
    globalMessage,
    generatedAt: new Date().toISOString(),
    servicesTotal: services.length,
    historyWindow: {
      bars: HISTORY_BARS,
      intervalSeconds: HISTORY_INTERVAL_SECONDS,
      label: "Últimas 24 horas"
    },
    categories,
    incidents,
    maintenances
  };
}

export function statusToHistory(status: PublicStatus): HistoryStatus {
  return toHistoryStatus(status);
}
