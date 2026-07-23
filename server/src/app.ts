import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { readConfig } from "./config.js";
import { StatusEvents } from "./events.js";
import { Monitor } from "./monitor.js";
import { buildSnapshot, statusToHistory } from "./snapshot.js";
import { StatusStore } from "./store.js";

const healthSourceSchema = z.object({
  path: z.string().startsWith("/").max(200),
  label: z.string().min(1).max(80),
  latencyWarningMs: z.number().int().min(100).max(60000).optional()
});

const serviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,80}$/),
  category: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  critical: z.boolean(),
  public: z.boolean().default(true),
  healthSources: z.array(healthSourceSchema).min(1).max(8)
});

const servicePatchSchema = serviceSchema.partial().omit({ id: true });

const publicStatusSchema = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown"
]);

const historyStatusSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "maintenance",
  "no_data"
]);

const incidentSchema = z.object({
  title: z.string().min(1).max(160),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]),
  severity: z.enum(["minor", "major", "critical"]),
  startedAt: z.string().datetime().optional(),
  affectedServiceIds: z.array(z.string().regex(/^[a-z0-9-]{2,80}$/)).default([]),
  summary: z.string().max(1000).optional()
});

const incidentPatchSchema = incidentSchema.partial().extend({
  resolvedAt: z.string().datetime().nullable().optional()
});

const maintenanceSchema = z.object({
  title: z.string().min(1).max(160),
  status: z.enum(["scheduled", "in_progress", "completed"]),
  scheduledStartAt: z.string().datetime(),
  scheduledEndAt: z.string().datetime(),
  affectedServiceIds: z.array(z.string().regex(/^[a-z0-9-]{2,80}$/)).default([]),
  summary: z.string().max(1000).optional()
});

const ingestStatusSchema = z.object({
  generatedAt: z.string().datetime().optional(),
  services: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{2,80}$/),
        name: z.string().min(1).max(120).optional(),
        category: z.string().min(1).max(80).optional(),
        description: z.string().min(1).max(300).optional(),
        critical: z.boolean().optional(),
        public: z.boolean().optional(),
        currentStatus: publicStatusSchema,
        historyStatus: historyStatusSchema.optional(),
        responseTimeMs: z.number().int().min(0).nullable().optional(),
        checkedAt: z.string().datetime().optional(),
        details: z.record(z.unknown()).optional()
      })
    )
    .min(1)
    .max(100)
});

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function validate<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return schema.parse(body);
}

function tokenMatches(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function bearerToken(request: Request, headerName: string) {
  const authorization = request.header("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  return bearer || request.header(headerName);
}

function adminAuth(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = bearerToken(request, "x-admin-token");
    if (!tokenMatches(token, config.ADMIN_TOKEN)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

function ingestAuth(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!config.INGEST_TOKEN) {
      response.status(503).json({ error: "ingest_not_configured" });
      return;
    }
    const token = bearerToken(request, "x-ingest-token");
    if (!tokenMatches(token, config.INGEST_TOKEN)) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createApp(options?: {
  config?: AppConfig;
  store?: StatusStore;
  enableMonitor?: boolean;
}) {
  const config = options?.config ?? readConfig();
  const store = options?.store ?? new StatusStore(config.databasePath);
  const events = new StatusEvents(store);
  const monitor = new Monitor(config, store, () => events.broadcast(true));
  const app = express();
  app.set("trust proxy", config.NODE_ENV === "production" ? 1 : false);

  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"]
        }
      }
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed by CORS"));
      }
    })
  );
  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  const sensitiveRateLimit = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited" }
  });
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      status: "operational",
      service: "nextech-status-page",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/public/status", (_request, response) => {
    response.json(buildSnapshot(store));
  });

  app.get("/api/public/status/services", (_request, response) => {
    response.json({ categories: buildSnapshot(store).categories });
  });

  app.get("/api/public/status/services/:serviceId", (request, response) => {
    const snapshot = buildSnapshot(store);
    const service = snapshot.categories
      .flatMap((category) => category.services)
      .find((item) => item.id === request.params.serviceId);
    if (!service) {
      response.status(404).json({ error: "service_not_found" });
      return;
    }
    response.json(service);
  });

  app.get("/api/public/status/incidents", (_request, response) => {
    response.json({ incidents: store.listIncidents(20) });
  });

  app.get("/api/public/status/maintenances", (_request, response) => {
    response.json({ maintenances: store.listMaintenances(20) });
  });

  app.get("/api/public/status/history", (_request, response) => {
    const snapshot = buildSnapshot(store);
    response.json({
      historyWindow: snapshot.historyWindow,
      categories: snapshot.categories.map((category) => ({
        name: category.name,
        services: category.services.map((service) => ({
          id: service.id,
          name: service.name,
          history: service.history
        }))
      }))
    });
  });

  app.get("/api/public/status/events", (request, response) => {
    request.socket.setTimeout(0);
    events.connect(response);
  });

  app.get("/api/status", (_request, response) => {
    response.json(buildSnapshot(store));
  });
  app.get("/api/services", (_request, response) => {
    response.json({ categories: buildSnapshot(store).categories });
  });
  app.get("/api/services/:serviceId", (request, response) => {
    const snapshot = buildSnapshot(store);
    const service = snapshot.categories
      .flatMap((category) => category.services)
      .find((item) => item.id === request.params.serviceId);
    if (!service) {
      response.status(404).json({ error: "service_not_found" });
      return;
    }
    response.json(service);
  });
  app.get("/api/incidents", (_request, response) => {
    response.json({ incidents: store.listIncidents(20) });
  });
  app.get("/api/metrics", (_request, response) => {
    response.json({ metrics: store.getMetrics() });
  });

  app.post("/api/ingest/status", sensitiveRateLimit, ingestAuth(config), (request, response) => {
    const payload = validate(ingestStatusSchema, request.body);
    const updated: string[] = [];
    const created: string[] = [];

    for (const serviceStatus of payload.services) {
      const existing = store.getService(serviceStatus.id, true);
      if (!existing) {
        store.upsertService({
          id: serviceStatus.id,
          category: serviceStatus.category ?? "Serviços",
          name: serviceStatus.name ?? serviceStatus.id,
          description:
            serviceStatus.description ?? "Status recebido pela API de ingestão da NexTech.",
          critical: serviceStatus.critical ?? false,
          public: serviceStatus.public ?? true,
          healthSources: [{ path: "/api/ingest/status", label: "Ingestão NexTech" }]
        });
        created.push(serviceStatus.id);
      } else if (
        serviceStatus.name ||
        serviceStatus.category ||
        serviceStatus.description ||
        serviceStatus.critical !== undefined ||
        serviceStatus.public !== undefined
      ) {
        store.patchService(serviceStatus.id, {
          category: serviceStatus.category ?? existing.category,
          name: serviceStatus.name ?? existing.name,
          description: serviceStatus.description ?? existing.description,
          critical: serviceStatus.critical ?? existing.critical,
          public: serviceStatus.public ?? existing.public
        });
      }

      store.recordCheck({
        serviceId: serviceStatus.id,
        currentStatus: serviceStatus.currentStatus,
        status: serviceStatus.historyStatus ?? statusToHistory(serviceStatus.currentStatus),
        responseTimeMs: serviceStatus.responseTimeMs ?? null,
        checkedAt: serviceStatus.checkedAt ?? payload.generatedAt,
        details: {
          source: "ingest",
          ...(serviceStatus.details ?? {})
        }
      });
      updated.push(serviceStatus.id);
    }

    const snapshot = buildSnapshot(store);
    events.broadcast(true);
    response.status(202).json({
      ok: true,
      accepted: updated.length,
      created,
      updated,
      snapshotUrl: "/api/public/status",
      eventsUrl: "/api/public/status/events",
      generatedAt: snapshot.generatedAt
    });
  });

  const admin = express.Router();
  admin.use(sensitiveRateLimit);
  admin.use(adminAuth(config));
  admin.get("/services", (_request, response) => {
    response.json({ services: store.listServices(true) });
  });
  admin.post("/services", (request, response) => {
    const service = store.upsertService(validate(serviceSchema, request.body));
    events.broadcast(true);
    response.status(201).json(service);
  });
  admin.patch("/services/:serviceId", (request, response) => {
    const service = store.patchService(
      request.params.serviceId,
      validate(servicePatchSchema, request.body)
    );
    if (!service) {
      response.status(404).json({ error: "service_not_found" });
      return;
    }
    events.broadcast(true);
    response.json(service);
  });
  admin.get("/incidents", (_request, response) => {
    response.json({ incidents: store.listIncidents(100) });
  });
  admin.post("/incidents", (request, response) => {
    const incident = store.createIncident(validate(incidentSchema, request.body));
    events.broadcast(true);
    response.status(201).json(incident);
  });
  admin.patch("/incidents/:incidentId", (request, response) => {
    const incident = store.patchIncident(
      request.params.incidentId,
      validate(incidentPatchSchema, request.body)
    );
    if (!incident) {
      response.status(404).json({ error: "incident_not_found" });
      return;
    }
    events.broadcast(true);
    response.json(incident);
  });
  admin.post("/maintenance", (request, response) => {
    const maintenance = store.createMaintenance(validate(maintenanceSchema, request.body));
    events.broadcast(true);
    response.status(201).json(maintenance);
  });
  admin.post(
    "/checks/run",
    asyncRoute(async (_request, response) => {
      await monitor.runOnce();
      events.broadcast(true);
      response.json({ ok: true, snapshot: buildSnapshot(store) });
    })
  );
  app.use("/api/admin", admin);

  const clientDir = path.resolve(process.cwd(), "dist/client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api") || request.path.startsWith("/health")) {
        next();
        return;
      }
      response.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use(
    (
      error: Error & { status?: number; issues?: unknown },
      _request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      if (error instanceof z.ZodError) {
        response.status(400).json({
          error: "validation_error",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        });
        return;
      }
      const status = error.status && error.status >= 400 ? error.status : 500;
      response.status(status).json({ error: status === 500 ? "internal_error" : error.message });
    }
  );

  events.start();
  if (options?.enableMonitor ?? config.ENABLE_MONITORING) {
    monitor.start();
  }

  return {
    app,
    store,
    monitor,
    events,
    close() {
      monitor.stop();
      events.stop();
      store.close();
    }
  };
}
