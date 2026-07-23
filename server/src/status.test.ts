import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { readConfig, type AppConfig } from "./config.js";
import { StatusStore } from "./store.js";

const adminToken = "test-admin-token-123";

function testConfig(overrides: Partial<Record<keyof AppConfig, unknown>> = {}) {
  return {
    ...readConfig({
      PORT: "8080",
      NODE_ENV: "test",
      PUBLIC_STATUS_URL: "http://localhost:0",
      PLATFORM_BASE_URL: "http://localhost:39999",
      PLATFORM_PANEL_URL: "http://localhost:3000",
      CORS_ORIGINS: "http://localhost:5173",
      ADMIN_TOKEN: adminToken,
      INGEST_TOKEN: "test-ingest-token-123",
      DATABASE_PATH: ":memory:",
      DEFAULT_CHECK_INTERVAL_SECONDS: "60",
      DEFAULT_TIMEOUT_MS: "1000",
      HISTORY_RETENTION_HOURS: "72",
      ENABLE_MONITORING: "false",
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "1000"
    }),
    ...overrides
  } as AppConfig;
}

async function startMockPlatform(handler: (path: string) => { status: number; body: unknown }) {
  const server = createServer((request, response) => {
    const result = handler(request.url ?? "/");
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

describe("NexTech Status API", () => {
  let runtime: ReturnType<typeof createApp> | null = null;
  let store: StatusStore;

  beforeEach(() => {
    store = new StatusStore(":memory:");
    runtime = createApp({ config: testConfig(), store, enableMonitor: false });
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
  });

  it("returns a public snapshot with default NexTech services", async () => {
    const response = await request(runtime!.app).get("/api/public/status").expect(200);

    expect(response.body.globalStatus).toBe("operational");
    expect(response.body.historyWindow).toEqual({
      bars: 60,
      intervalSeconds: 60,
      label: "Últimos 60 minutos"
    });
    expect(response.body.servicesTotal).toBe(7);
    expect(response.body.categories.flatMap((category: { services: unknown[] }) => category.services)).toHaveLength(7);
    expect(JSON.stringify(response.body)).not.toContain("healthSources");
    expect(JSON.stringify(response.body)).not.toContain("health_sources");
    expect(JSON.stringify(response.body)).not.toContain("createdAt");
  });

  it("protects administrative routes with the admin token", async () => {
    await request(runtime!.app).get("/api/admin/services").expect(401);
    await request(runtime!.app)
      .get("/api/admin/services")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  it("creates incidents through the protected API and exposes sanitized public data", async () => {
    await request(runtime!.app)
      .post("/api/admin/incidents")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        title: "Instabilidade no checkout",
        status: "investigating",
        severity: "major",
        affectedServiceIds: ["payments"],
        summary: "Pagamentos com lentidão."
      })
      .expect(201);

    const response = await request(runtime!.app).get("/api/public/status/incidents").expect(200);
    expect(response.body.incidents[0]).toMatchObject({
      title: "Instabilidade no checkout",
      severity: "major"
    });
    expect(JSON.stringify(response.body)).not.toContain("ADMIN_TOKEN");
  });

  it("accepts pushed service status through the ingest API", async () => {
    await request(runtime!.app)
      .post("/api/ingest/status")
      .send({
        services: [
          {
            id: "public-api",
            currentStatus: "degraded",
            responseTimeMs: 1800,
            details: { reason: "latency" }
          }
        ]
      })
      .expect(401);

    await request(runtime!.app)
      .post("/api/ingest/status")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        services: [
          {
            id: "public-api",
            currentStatus: "degraded",
            responseTimeMs: 1800
          }
        ]
      })
      .expect(401);

    await request(runtime!.app)
      .post("/api/ingest/status")
      .set("authorization", "Bearer test-ingest-token-123")
      .send({
        services: [
          {
            id: "public-api",
            currentStatus: "degraded",
            responseTimeMs: 1800,
            details: { reason: "latency" }
          }
        ]
      })
      .expect(202);

    const response = await request(runtime!.app)
      .get("/api/public/status/services/public-api")
      .expect(200);
    expect(response.body).toMatchObject({
      id: "public-api",
      currentStatus: "degraded",
      responseTimeMs: 1800
    });
  });

  it("updates global status when a critical health check fails", async () => {
    runtime!.close();
    const mock = await startMockPlatform((pathName) => {
      if (pathName === "/health/database") {
        return { status: 503, body: { ok: false, status: "down", latencyMs: 1200 } };
      }
      return { status: 200, body: { ok: true, status: "ok", configured: true, enabled: true } };
    });
    store = new StatusStore(":memory:");
    runtime = createApp({
      config: testConfig({ PLATFORM_BASE_URL: mock.url }),
      store,
      enableMonitor: false
    });

    await request(runtime.app)
      .post("/api/admin/checks/run")
      .set("authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    const response = await request(runtime.app).get("/api/public/status").expect(200);
    const services = response.body.categories.flatMap((category: { services: unknown[] }) => category.services);
    expect(response.body.globalStatus).toBe("major_outage");
    expect(services.find((service: { id: string }) => service.id === "data-storage")).toMatchObject({
      currentStatus: "major_outage"
    });

    await mock.close();
  });

  it("opens the SSE stream with the expected event type", async () => {
    const server = runtime!.app.listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/api/public/status/events`, {
      signal: controller.signal
    });
    const chunk = await response.body!.getReader().read();
    controller.abort();
    await new Promise<void>((resolve) => (server as Server).close(() => resolve()));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(chunk.value)).toContain("event: status-update");
  });
});
