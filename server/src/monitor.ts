import type { AppConfig } from "./config.js";
import { statusToHistory } from "./snapshot.js";
import { isOfflineStatus } from "./statusRules.js";
import type { StatusStore } from "./store.js";
import type { HealthSource, PublicStatus, ServiceRecord } from "./types.js";

type HealthResult = {
  currentStatus: PublicStatus;
  responseTimeMs: number | null;
  details: Record<string, unknown>;
  shouldHideService?: boolean;
};

const publicStatusValues = new Set<PublicStatus>([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown"
]);

const badStatusValues = new Set([
  "error",
  "down",
  "offline",
  "unhealthy",
  "failed",
  "major_outage",
  "partial_outage"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findScalar(payload: unknown, key: string): unknown {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findScalar(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(payload)) return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  for (const value of Object.values(payload)) {
    const found = findScalar(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeStatusValue(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function isPublicStatus(value: unknown): value is PublicStatus {
  return typeof value === "string" && publicStatusValues.has(value as PublicStatus);
}

function findRemoteStatusService(payload: unknown, serviceId: string): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const categories = payload.categories;
  if (!Array.isArray(categories)) return null;

  for (const category of categories) {
    if (!isRecord(category) || !Array.isArray(category.services)) continue;
    for (const service of category.services) {
      if (isRecord(service) && service.id === serviceId) return service;
    }
  }

  return null;
}

function evaluateRemoteStatusApi(
  service: ServiceRecord,
  source: HealthSource,
  httpStatus: number,
  responseTimeMs: number,
  payload: unknown
): HealthResult | null {
  if (source.path !== "/api/status") return null;

  if (httpStatus >= 500) {
    return {
      currentStatus: service.critical ? "major_outage" : "partial_outage",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "status_api_server_error" }
    };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      currentStatus: "degraded",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "status_api_unexpected_http_status" }
    };
  }

  const remoteService = findRemoteStatusService(payload, service.id);
  if (!remoteService) {
    return {
      currentStatus: "unknown",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "service_not_found_in_status_api" }
    };
  }

  const remoteStatus = remoteService.currentStatus;
  const remoteResponseTime = remoteService.responseTimeMs;
  const remoteUptime = remoteService.uptimePercentage;
  return {
    currentStatus: isPublicStatus(remoteStatus) ? remoteStatus : "unknown",
    responseTimeMs:
      typeof remoteResponseTime === "number" && Number.isFinite(remoteResponseTime)
        ? Math.round(remoteResponseTime)
        : responseTimeMs,
    details: {
      source: source.label,
      httpStatus,
      reason: "status_api_service_snapshot",
      remoteGeneratedAt: isRecord(payload) ? payload.generatedAt : undefined,
      remoteUptimePercentage:
        typeof remoteUptime === "number" && Number.isFinite(remoteUptime) ? remoteUptime : undefined
    }
  };
}

function evaluatePayload(
  service: ServiceRecord,
  source: HealthSource,
  httpStatus: number,
  responseTimeMs: number,
  payload: unknown
): HealthResult {
  const remoteStatusResult = evaluateRemoteStatusApi(
    service,
    source,
    httpStatus,
    responseTimeMs,
    payload
  );
  if (remoteStatusResult) return remoteStatusResult;

  const configured = findScalar(payload, "configured");
  const enabled = findScalar(payload, "enabled");
  const ok = findScalar(payload, "ok");
  const healthy = findScalar(payload, "healthy");
  const statusValue = normalizeStatusValue(findScalar(payload, "status"));
  const statusMessage = normalizeStatusValue(findScalar(payload, "statusMessage"));

  if (service.id === "cache" && configured === false) {
    return {
      currentStatus: "unknown",
      responseTimeMs,
      shouldHideService: true,
      details: { source: source.label, httpStatus, reason: "redis_not_configured" }
    };
  }

  if (service.id === "payments" && enabled === false) {
    return {
      currentStatus: "unknown",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "payments_disabled" }
    };
  }

  if (httpStatus >= 500) {
    return {
      currentStatus: service.critical ? "major_outage" : "partial_outage",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "server_error" }
    };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      currentStatus: "degraded",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "unexpected_http_status" }
    };
  }

  if (ok === false || healthy === false || badStatusValues.has(statusValue)) {
    return {
      currentStatus: service.critical ? "major_outage" : "partial_outage",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "payload_not_ok" }
    };
  }

  if (statusValue === "maintenance" || statusMessage.includes("maintenance")) {
    return {
      currentStatus: "maintenance",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "maintenance" }
    };
  }

  if (statusValue === "degraded" || responseTimeMs > (source.latencyWarningMs ?? 1500)) {
    return {
      currentStatus: "degraded",
      responseTimeMs,
      details: { source: source.label, httpStatus, reason: "latency_or_degraded_status" }
    };
  }

  return {
    currentStatus: "operational",
    responseTimeMs,
    details: { source: source.label, httpStatus, reason: "ok" }
  };
}

function preferWorse(current: HealthResult, next: HealthResult): HealthResult {
  if (current.details.reason === "no_health_source") return next;
  const rank: Record<PublicStatus, number> = {
    major_outage: 5,
    partial_outage: 4,
    degraded: 3,
    maintenance: 2,
    unknown: 1,
    operational: 0
  };
  return rank[next.currentStatus] > rank[current.currentStatus] ? next : current;
}

async function checkSource(
  config: AppConfig,
  service: ServiceRecord,
  source: HealthSource
): Promise<HealthResult> {
  const url = new URL(source.path, config.PLATFORM_BASE_URL);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(config.DEFAULT_TIMEOUT_MS)
    });
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    return evaluatePayload(service, source, response.status, responseTimeMs, payload);
  } catch {
    return {
      currentStatus: "unknown",
      responseTimeMs: null,
      details: { source: source.label, reason: "request_failed" }
    };
  }
}

function formatIncidentDuration(startedAt: string, endedAt = new Date().toISOString()) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "duração indisponível";
  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly store: StatusStore,
    private readonly onChange: () => void
  ) {}

  start() {
    if (this.timer || !this.config.ENABLE_MONITORING) return;
    void this.runOnce();
    this.timer = setInterval(
      () => void this.runOnce(),
      Math.min(this.config.DEFAULT_CHECK_INTERVAL_SECONDS, 5) * 1000
    );
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const services = this.store.listServices(true);
      for (const service of services) {
        let result: HealthResult = {
          currentStatus: "unknown",
          responseTimeMs: null,
          details: { reason: "no_health_source" }
        };

        for (const source of service.healthSources) {
          const sourceResult = await checkSource(this.config, service, source);
          result = preferWorse(result, sourceResult);
        }

        if (service.id === "cache" && result.shouldHideService) {
          this.store.setServiceVisibility(service.id, false);
        }

        this.syncIncident(service, result);

        this.store.recordCheck({
          serviceId: service.id,
          currentStatus: result.currentStatus,
          status: statusToHistory(result.currentStatus),
          responseTimeMs: result.responseTimeMs,
          details: result.details
        });
        console.log(
          `[STATUS] Atualização recebida service=${service.id} status=${result.currentStatus}`
        );

      }
      this.store.pruneChecks(this.config.HISTORY_RETENTION_HOURS);
    } finally {
      this.running = false;
    }

    this.onChange();
  }

  private syncIncident(service: ServiceRecord, result: HealthResult) {
    const previousOffline = isOfflineStatus(service.currentStatus);
    const currentOffline = isOfflineStatus(result.currentStatus);
    const activeIncident = this.store.getActiveIncidentForService(service.id);

    if (currentOffline && !previousOffline && !activeIncident) {
      const incident = this.store.createIncident({
        title: `${service.name} indisponível`,
        status: "investigating",
        severity: service.critical ? "critical" : "major",
        affectedServiceIds: [service.id],
        summary: [
          `Status: Offline`,
          `Serviço: ${service.name}`,
          `Identificador: ${service.id}`,
          `Ambiente: Produção`,
          `Última resposta: ${service.lastCheckedAt ?? "sem resposta válida"}`,
          `Latência anterior: ${
            service.responseTimeMs === null ? "indisponível" : `${service.responseTimeMs} ms`
          }`,
          `Motivo: ${String(result.details.reason ?? "sem comunicação")}`
        ].join(" | ")
      });
      console.log(`[STATUS] Serviço marcado como offline service=${service.id}`);
      console.log(`[STATUS] Incidente criado id=${incident.id} service=${service.id}`);
      console.log(`[STATUS] Alerta de queda enviado id=${incident.id} service=${service.id}`);
      return;
    }

    if (!currentOffline && activeIncident) {
      const recoveredAt = new Date().toISOString();
      this.store.patchIncident(activeIncident.id, {
        status: "resolved",
        resolvedAt: recoveredAt,
        summary: `${activeIncident.summary} | Recuperado em: ${recoveredAt} | Duração: ${formatIncidentDuration(
          activeIncident.startedAt,
          recoveredAt
        )} | Status atual: ${result.currentStatus} | Latência atual: ${
          result.responseTimeMs === null ? "indisponível" : `${result.responseTimeMs} ms`
        }`
      });
      console.log(`[STATUS] Serviço recuperado service=${service.id}`);
      console.log(`[STATUS] Alerta de recuperação enviado id=${activeIncident.id} service=${service.id}`);
      return;
    }

    if (!previousOffline && result.currentStatus === "operational") {
      console.log(`[STATUS] Serviço alterado para operacional service=${service.id}`);
    }
    if (result.currentStatus === "major_outage") {
      console.log(`[STATUS] Serviço alterado para crítico service=${service.id}`);
    }
  }
}
