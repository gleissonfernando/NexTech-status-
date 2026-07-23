import type { AppConfig } from "./config.js";
import { statusToHistory } from "./snapshot.js";
import type { StatusStore } from "./store.js";
import type { HealthSource, PublicStatus, ServiceRecord } from "./types.js";

type HealthResult = {
  currentStatus: PublicStatus;
  responseTimeMs: number | null;
  details: Record<string, unknown>;
  shouldHideService?: boolean;
};

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

function evaluatePayload(
  service: ServiceRecord,
  source: HealthSource,
  httpStatus: number,
  responseTimeMs: number,
  payload: unknown
): HealthResult {
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
      currentStatus: service.critical ? "major_outage" : "partial_outage",
      responseTimeMs: null,
      details: { source: source.label, reason: "request_failed" }
    };
  }
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
      this.config.DEFAULT_CHECK_INTERVAL_SECONDS * 1000
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
    let changed = false;
    try {
      const services = this.store.listServices(true);
      for (const service of services) {
        const previousStatus = service.currentStatus;
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

        this.store.recordCheck({
          serviceId: service.id,
          currentStatus: result.currentStatus,
          status: statusToHistory(result.currentStatus),
          responseTimeMs: result.responseTimeMs,
          details: result.details
        });

        changed = changed || previousStatus !== result.currentStatus;
      }
      this.store.pruneChecks(this.config.HISTORY_RETENTION_HOURS);
    } finally {
      this.running = false;
    }

    if (changed) this.onChange();
  }
}
