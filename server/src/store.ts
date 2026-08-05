import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { defaultServices } from "./defaultServices.js";
import type {
  CheckRecord,
  HealthSource,
  HistoryStatus,
  IncidentRecord,
  IncidentSeverity,
  IncidentStatus,
  MaintenanceRecord,
  MaintenanceStatus,
  PublicStatus,
  ServiceRecord
} from "./types.js";

type Row = Record<string, unknown>;

function boolToInt(value: boolean) {
  return value ? 1 : 0;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toService(row: Row): ServiceRecord {
  return {
    id: String(row.id),
    category: String(row.category),
    name: String(row.name),
    description: String(row.description),
    critical: Number(row.critical) === 1,
    public: Number(row.public) === 1,
    healthSources: parseJson<HealthSource[]>(row.health_sources, []),
    currentStatus: String(row.current_status) as PublicStatus,
    responseTimeMs:
      row.response_time_ms === null || row.response_time_ms === undefined
        ? null
        : Number(row.response_time_ms),
    uptimePercentage: Number(row.uptime_percentage),
    lastCheckedAt:
      row.last_checked_at === null || row.last_checked_at === undefined
        ? null
        : String(row.last_checked_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toCheck(row: Row): CheckRecord {
  return {
    id: Number(row.id),
    serviceId: String(row.service_id),
    status: String(row.status) as HistoryStatus,
    responseTimeMs:
      row.response_time_ms === null || row.response_time_ms === undefined
        ? null
        : Number(row.response_time_ms),
    checkedAt: String(row.checked_at),
    details: parseJson<Record<string, unknown>>(row.details_json, {})
  };
}

function toIncident(row: Row): IncidentRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status) as IncidentStatus,
    severity: String(row.severity) as IncidentSeverity,
    startedAt: String(row.started_at),
    resolvedAt:
      row.resolved_at === null || row.resolved_at === undefined
        ? null
        : String(row.resolved_at),
    affectedServiceIds: parseJson<string[]>(row.affected_service_ids, []),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toMaintenance(row: Row): MaintenanceRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status) as MaintenanceStatus,
    scheduledStartAt: String(row.scheduled_start_at),
    scheduledEndAt: String(row.scheduled_end_at),
    affectedServiceIds: parseJson<string[]>(row.affected_service_ids, []),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class StatusStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedDefaults();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        critical INTEGER NOT NULL DEFAULT 0,
        public INTEGER NOT NULL DEFAULT 1,
        health_sources TEXT NOT NULL DEFAULT '[]',
        current_status TEXT NOT NULL DEFAULT 'unknown',
        response_time_ms INTEGER,
        uptime_percentage REAL NOT NULL DEFAULT 100,
        last_checked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        status TEXT NOT NULL,
        response_time_ms INTEGER,
        checked_at TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        started_at TEXT NOT NULL,
        resolved_at TEXT,
        affected_service_ids TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS maintenances (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        scheduled_start_at TEXT NOT NULL,
        scheduled_end_at TEXT NOT NULL,
        affected_service_ids TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metrics_aggregates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        window_start_at TEXT NOT NULL,
        window_seconds INTEGER NOT NULL,
        uptime_percentage REAL NOT NULL,
        average_response_ms REAL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checks_service_date ON checks(service_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checks_date ON checks(checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_status_date ON incidents(status, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_maintenances_status_date ON maintenances(status, scheduled_start_at DESC);
    `);
  }

  private seedDefaults() {
    const previousTemplateIds = [
      "cache"
    ];
    const previousDemoIds = [
      "portal-nextech",
      "client-panel",
      "admin-panel",
      "auth-system",
      "nexttech-core-api",
      "customers-api",
      "payments-api",
      "reports-api",
      "auth-api",
      "main-server",
      "load-balancer",
      "cdn",
      "dns",
      "main-gateway",
      "postgresql-primary",
      "postgresql-replica",
      "redis",
      "mongodb",
      "data-warehouse",
      "webhooks",
      "email-service",
      "sms-service",
      "payment-integration",
      "third-party-integration",
      "firewall",
      "anti-ddos",
      "fraud-detection",
      "token-management",
      "access-monitoring",
      "worker-queue",
      "object-storage",
      "secondary-monitor",
      "internal-service-bus"
    ];
    for (const id of [...previousTemplateIds, ...previousDemoIds]) {
      this.db.prepare("DELETE FROM services WHERE id = ?").run(id);
    }

    const insert = this.db.prepare(`
      INSERT INTO services (
        id, category, name, description, critical, public, health_sources,
        current_status, response_time_ms, uptime_percentage, last_checked_at,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category = excluded.category,
        name = excluded.name,
        description = excluded.description,
        critical = excluded.critical,
        public = excluded.public,
        health_sources = excluded.health_sources,
        current_status = excluded.current_status,
        response_time_ms = excluded.response_time_ms,
        uptime_percentage = excluded.uptime_percentage,
        last_checked_at = excluded.last_checked_at,
        updated_at = excluded.updated_at
    `);

    for (const service of defaultServices) {
      insert.run(
        service.id,
        service.category,
        service.name,
        service.description,
        boolToInt(service.critical),
        boolToInt(service.public),
        JSON.stringify(service.healthSources),
        service.currentStatus,
        service.responseTimeMs,
        service.uptimePercentage,
        service.lastCheckedAt,
        service.createdAt,
        service.updatedAt
      );
    }

    this.db
      .prepare(
        `
        DELETE FROM incidents
        WHERE title IN (
          'Degradação no envio de e-mails transacionais',
          'Latência elevada na API de Relatórios',
          'Manutenção emergencial no gateway',
          'Intermitência no conector de pagamentos'
        )
      `
      )
      .run();
    this.db
      .prepare(
        `
        DELETE FROM maintenances
        WHERE title IN (
          'Atualização programada da CDN',
          'Janela de melhoria no Data Warehouse'
        )
      `
      )
      .run();
  }

  listServices(includeInternal = false): ServiceRecord[] {
    const rows = includeInternal
      ? this.db.prepare("SELECT * FROM services ORDER BY category, name").all()
      : this.db
          .prepare("SELECT * FROM services WHERE public = 1 ORDER BY category, name")
          .all();
    return rows.map((row) => toService(row as Row));
  }

  getService(id: string, includeInternal = false): ServiceRecord | null {
    const row = includeInternal
      ? this.db.prepare("SELECT * FROM services WHERE id = ?").get(id)
      : this.db
          .prepare("SELECT * FROM services WHERE id = ? AND public = 1")
          .get(id);
    return row ? toService(row as Row) : null;
  }

  upsertService(input: {
    id: string;
    category: string;
    name: string;
    description: string;
    critical: boolean;
    public: boolean;
    healthSources: HealthSource[];
  }): ServiceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO services (
          id, category, name, description, critical, public, health_sources,
          current_status, response_time_ms, uptime_percentage, last_checked_at,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', NULL, 100, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          name = excluded.name,
          description = excluded.description,
          critical = excluded.critical,
          public = excluded.public,
          health_sources = excluded.health_sources,
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.id,
        input.category,
        input.name,
        input.description,
        boolToInt(input.critical),
        boolToInt(input.public),
        JSON.stringify(input.healthSources),
        now,
        now
      );
    this.audit("upsert", "service", input.id);
    return this.getService(input.id, true)!;
  }

  patchService(
    id: string,
    patch: Partial<{
      category: string;
      name: string;
      description: string;
      critical: boolean;
      public: boolean;
      healthSources: HealthSource[];
      currentStatus: PublicStatus;
    }>
  ): ServiceRecord | null {
    const existing = this.getService(id, true);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      healthSources: patch.healthSources ?? existing.healthSources
    };
    this.db
      .prepare(
        `
        UPDATE services
        SET category = ?, name = ?, description = ?, critical = ?, public = ?,
            health_sources = ?, current_status = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        next.category,
        next.name,
        next.description,
        boolToInt(next.critical),
        boolToInt(next.public),
        JSON.stringify(next.healthSources),
        next.currentStatus,
        new Date().toISOString(),
        id
      );
    this.audit("patch", "service", id);
    return this.getService(id, true);
  }

  setServiceVisibility(id: string, isPublic: boolean) {
    this.db
      .prepare("UPDATE services SET public = ?, updated_at = ? WHERE id = ?")
      .run(boolToInt(isPublic), new Date().toISOString(), id);
  }

  recordCheck(input: {
    serviceId: string;
    status: HistoryStatus;
    currentStatus: PublicStatus;
    responseTimeMs: number | null;
    details: Record<string, unknown>;
    checkedAt?: string;
  }) {
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO checks (service_id, status, response_time_ms, checked_at, details_json)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(
        input.serviceId,
        input.status,
        input.responseTimeMs,
        checkedAt,
        JSON.stringify(input.details)
      );

    const remoteUptimePercentage = input.details.remoteUptimePercentage;
    const uptimePercentage =
      typeof remoteUptimePercentage === "number" && Number.isFinite(remoteUptimePercentage)
        ? Number(remoteUptimePercentage.toFixed(3))
        : this.calculateUptime(input.serviceId);
    this.db
      .prepare(
        `
        UPDATE services
        SET current_status = ?, response_time_ms = ?, uptime_percentage = ?,
            last_checked_at = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        input.currentStatus,
        input.responseTimeMs,
        uptimePercentage,
        checkedAt,
        checkedAt,
        input.serviceId
      );
  }

  private calculateUptime(serviceId: string) {
    const row = this.db
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('operational', 'degraded', 'maintenance') THEN 1 ELSE 0 END) AS available
        FROM checks
        WHERE service_id = ?
      `
      )
      .get(serviceId) as Row | undefined;
    const total = Number(row?.total ?? 0);
    if (total === 0) return 100;
    return Number(((Number(row?.available ?? 0) / total) * 100).toFixed(2));
  }

  getChecksSince(sinceIso: string): CheckRecord[] {
    return this.db
      .prepare("SELECT * FROM checks WHERE checked_at >= ? ORDER BY checked_at ASC")
      .all(sinceIso)
      .map((row) => toCheck(row as Row));
  }

  pruneChecks(retentionHours: number) {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM checks WHERE checked_at < ?").run(cutoff);
  }

  listIncidents(limit = 20): IncidentRecord[] {
    return this.db
      .prepare(
        `
        SELECT * FROM incidents
        ORDER BY CASE WHEN status = 'resolved' THEN 1 ELSE 0 END, started_at DESC
        LIMIT ?
      `
      )
      .all(limit)
      .map((row) => toIncident(row as Row));
  }

  getActiveIncidentForService(serviceId: string): IncidentRecord | null {
    return (
      this.listIncidents(100).find(
        (incident) =>
          incident.status !== "resolved" && incident.affectedServiceIds.includes(serviceId)
      ) ?? null
    );
  }

  createIncident(input: {
    title: string;
    status: IncidentStatus;
    severity: IncidentSeverity;
    startedAt?: string;
    affectedServiceIds: string[];
    summary?: string;
  }): IncidentRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO incidents (
          id, title, status, severity, started_at, resolved_at,
          affected_service_ids, summary, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.title,
        input.status,
        input.severity,
        input.startedAt ?? now,
        JSON.stringify(input.affectedServiceIds),
        input.summary ?? "",
        now,
        now
      );
    this.audit("create", "incident", id);
    return this.listIncidents(100).find((incident) => incident.id === id)!;
  }

  patchIncident(
    id: string,
    patch: Partial<{
      title: string;
      status: IncidentStatus;
      severity: IncidentSeverity;
      resolvedAt: string | null;
      affectedServiceIds: string[];
      summary: string;
    }>
  ): IncidentRecord | null {
    const existing = this.db
      .prepare("SELECT * FROM incidents WHERE id = ?")
      .get(id) as Row | undefined;
    if (!existing) return null;
    const current = toIncident(existing);
    const next = { ...current, ...patch };
    const resolvedAt =
      next.status === "resolved" ? next.resolvedAt ?? new Date().toISOString() : null;
    this.db
      .prepare(
        `
        UPDATE incidents
        SET title = ?, status = ?, severity = ?, resolved_at = ?,
            affected_service_ids = ?, summary = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(
        next.title,
        next.status,
        next.severity,
        resolvedAt,
        JSON.stringify(next.affectedServiceIds),
        next.summary,
        new Date().toISOString(),
        id
      );
    this.audit("patch", "incident", id);
    const row = this.db.prepare("SELECT * FROM incidents WHERE id = ?").get(id);
    return row ? toIncident(row as Row) : null;
  }

  listMaintenances(limit = 20): MaintenanceRecord[] {
    return this.db
      .prepare("SELECT * FROM maintenances ORDER BY scheduled_start_at DESC LIMIT ?")
      .all(limit)
      .map((row) => toMaintenance(row as Row));
  }

  createMaintenance(input: {
    title: string;
    status: MaintenanceStatus;
    scheduledStartAt: string;
    scheduledEndAt: string;
    affectedServiceIds: string[];
    summary?: string;
  }): MaintenanceRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO maintenances (
          id, title, status, scheduled_start_at, scheduled_end_at,
          affected_service_ids, summary, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.title,
        input.status,
        input.scheduledStartAt,
        input.scheduledEndAt,
        JSON.stringify(input.affectedServiceIds),
        input.summary ?? "",
        now,
        now
      );
    this.audit("create", "maintenance", id);
    return this.listMaintenances(100).find((maintenance) => maintenance.id === id)!;
  }

  getMetrics() {
    const rows = this.db
      .prepare(
        `
        SELECT service_id, AVG(response_time_ms) AS average_response_ms, COUNT(*) AS checks_total
        FROM checks
        WHERE response_time_ms IS NOT NULL
        GROUP BY service_id
      `
      )
      .all() as Row[];
    return rows.map((row) => ({
      serviceId: String(row.service_id),
      averageResponseMs: Math.round(Number(row.average_response_ms ?? 0)),
      checksTotal: Number(row.checks_total ?? 0)
    }));
  }

  private audit(action: string, entityType: string, entityId: string) {
    this.db
      .prepare(
        "INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(action, entityType, entityId, new Date().toISOString());
  }
}
