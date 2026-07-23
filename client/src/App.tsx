import { FormEvent, useEffect, useMemo, useState } from "react";

type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

type HistoryStatus = "operational" | "degraded" | "down" | "maintenance" | "no_data";

type Service = {
  id: string;
  category: string;
  name: string;
  description: string;
  critical: boolean;
  currentStatus: PublicStatus;
  responseTimeMs: number | null;
  uptimePercentage: number;
  lastCheckedAt: string | null;
  history: HistoryStatus[];
};

type Category = {
  name: string;
  services: Service[];
};

type Incident = {
  id: string;
  title: string;
  status: string;
  severity: string;
  startedAt: string;
  affectedServiceIds: string[];
  summary: string;
};

type Maintenance = {
  id: string;
  title: string;
  status: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  affectedServiceIds: string[];
  summary: string;
};

type Snapshot = {
  globalStatus: "operational" | "degraded" | "major_outage";
  globalMessage: string;
  generatedAt: string;
  servicesTotal: number;
  historyWindow: {
    bars: number;
    intervalSeconds: number;
    label: string;
  };
  categories: Category[];
  incidents: Incident[];
  maintenances: Maintenance[];
};

const platformUrl = import.meta.env.VITE_PLATFORM_PANEL_URL ?? "https://nextech.discloud.app";

const statusText: Record<PublicStatus | Snapshot["globalStatus"], string> = {
  operational: "Operacional",
  degraded: "Instabilidade",
  partial_outage: "Indisponível parcial",
  major_outage: "Indisponível",
  maintenance: "Manutenção",
  unknown: "Sem dados"
};

const incidentStatusText: Record<string, string> = {
  investigating: "Investigando",
  identified: "Identificado",
  monitoring: "Monitorando",
  resolved: "Resolvido"
};

function formatDate(value: string | null) {
  if (!value) return "Sem verificação";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMs(value: number | null) {
  return value === null ? "Sem dados" : `${value} ms`;
}

function statusClass(status: PublicStatus | Snapshot["globalStatus"] | HistoryStatus) {
  if (status === "partial_outage" || status === "major_outage" || status === "down") {
    return "outage";
  }
  if (status === "no_data") return "unknown";
  return status;
}

async function fetchSnapshot() {
  const response = await fetch("/api/public/status", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Falha ao buscar snapshot");
  return (await response.json()) as Snapshot;
}

function findService(snapshot: Snapshot | null, id: string | null) {
  if (!snapshot || !id) return null;
  return snapshot.categories.flatMap((category) => category.services).find((item) => item.id === id);
}

function StatusPill({ status }: { status: PublicStatus | Snapshot["globalStatus"] }) {
  return <span className={`status-pill ${statusClass(status)}`}>{statusText[status]}</span>;
}

function HistoryBars({ history }: { history: HistoryStatus[] }) {
  return (
    <div className="history-bars" aria-label="Histórico dos últimos 60 minutos">
      {history.map((item, index) => (
        <span key={`${item}-${index}`} className={`history-bar ${statusClass(item)}`} />
      ))}
    </div>
  );
}

function ServiceCard({
  service,
  selected,
  onSelect
}: {
  service: Service;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`service-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className="service-card__top">
        <span>
          <strong>{service.name}</strong>
          <small>{service.description}</small>
        </span>
        <StatusPill status={service.currentStatus} />
      </span>
      <HistoryBars history={service.history} />
      <span className="service-card__meta">
        <span>{service.uptimePercentage.toFixed(2)}% uptime</span>
        <span>{formatMs(service.responseTimeMs)}</span>
        <span>{service.critical ? "Crítico" : "Apoio"}</span>
      </span>
    </button>
  );
}

function DetailPanel({ service }: { service: Service | null }) {
  if (!service) {
    return (
      <aside className="panel detail-panel">
        <h2>Detalhes do serviço</h2>
        <p className="muted">Selecione um serviço para ver última verificação e disponibilidade.</p>
      </aside>
    );
  }

  return (
    <aside className="panel detail-panel">
      <div className="panel-heading">
        <h2>{service.name}</h2>
        <StatusPill status={service.currentStatus} />
      </div>
      <p>{service.description}</p>
      <div className="metric-grid">
        <span>
          <small>Uptime</small>
          <strong>{service.uptimePercentage.toFixed(2)}%</strong>
        </span>
        <span>
          <small>Resposta</small>
          <strong>{formatMs(service.responseTimeMs)}</strong>
        </span>
        <span>
          <small>Última checagem</small>
          <strong>{formatDate(service.lastCheckedAt)}</strong>
        </span>
      </div>
      <HistoryBars history={service.history} />
    </aside>
  );
}

function IncidentList({
  incidents,
  maintenances
}: {
  incidents: Incident[];
  maintenances: Maintenance[];
}) {
  return (
    <section className="timeline">
      <div className="section-heading">
        <h2>Histórico recente</h2>
        <span>{incidents.length + maintenances.length} registros</span>
      </div>
      {incidents.length === 0 && maintenances.length === 0 ? (
        <p className="empty-state">Nenhum incidente ou manutenção recente.</p>
      ) : (
        <div className="timeline-list">
          {incidents.map((incident) => (
            <article key={incident.id} className="timeline-item">
              <span className={`severity ${incident.severity}`}>{incident.severity}</span>
              <div>
                <h3>{incident.title}</h3>
                <p>{incident.summary || "Incidente registrado na plataforma."}</p>
                <small>
                  {incidentStatusText[incident.status] ?? incident.status} ·{" "}
                  {formatDate(incident.startedAt)}
                </small>
              </div>
            </article>
          ))}
          {maintenances.map((maintenance) => (
            <article key={maintenance.id} className="timeline-item">
              <span className="severity maintenance">manutenção</span>
              <div>
                <h3>{maintenance.title}</h3>
                <p>{maintenance.summary || "Janela de manutenção programada."}</p>
                <small>
                  {maintenance.status} · {formatDate(maintenance.scheduledStartAt)}
                </small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminPanel({ onChanged }: { onChanged: (snapshot: Snapshot) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [servicePath, setServicePath] = useState("/health");

  async function adminFetch(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "erro" }));
      throw new Error(error.error ?? "Falha administrativa");
    }
    return response.json();
  }

  async function refresh() {
    onChanged(await fetchSnapshot());
  }

  async function createIncident(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await adminFetch("/api/admin/incidents", {
        title: incidentTitle,
        status: "investigating",
        severity: "minor",
        affectedServiceIds: [],
        summary: incidentSummary
      });
      setIncidentTitle("");
      setIncidentSummary("");
      await refresh();
      setMessage("Incidente registrado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao registrar incidente.");
    }
  }

  async function createService(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await adminFetch("/api/admin/services", {
        id: serviceId,
        category: "Outros",
        name: serviceName,
        description: "Endpoint configurado no painel administrativo.",
        critical: false,
        public: true,
        healthSources: [{ path: servicePath, label: serviceName }]
      });
      setServiceId("");
      setServiceName("");
      setServicePath("/health");
      await refresh();
      setMessage("Serviço salvo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao salvar serviço.");
    }
  }

  async function runChecks() {
    setMessage("");
    try {
      const result = await adminFetch("/api/admin/checks/run", {});
      onChanged(result.snapshot);
      setMessage("Health checks executados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao executar checks.");
    }
  }

  return (
    <section className="admin-section">
      <button className="secondary-button" onClick={() => setOpen((value) => !value)}>
        {open ? "Fechar admin" : "Painel admin"}
      </button>
      {open ? (
        <div className="admin-grid">
          <label className="field full">
            <span>Token administrativo</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ADMIN_TOKEN"
            />
          </label>
          <form className="panel admin-form" onSubmit={createIncident}>
            <h2>Registrar incidente</h2>
            <label className="field">
              <span>Título</span>
              <input
                value={incidentTitle}
                onChange={(event) => setIncidentTitle(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Resumo</span>
              <textarea
                value={incidentSummary}
                onChange={(event) => setIncidentSummary(event.target.value)}
                rows={3}
              />
            </label>
            <button className="primary-button" type="submit">
              Criar incidente
            </button>
          </form>
          <form className="panel admin-form" onSubmit={createService}>
            <h2>Criar serviço</h2>
            <label className="field">
              <span>ID</span>
              <input
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                placeholder="novo-servico"
                required
              />
            </label>
            <label className="field">
              <span>Nome</span>
              <input
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Health path</span>
              <input
                value={servicePath}
                onChange={(event) => setServicePath(event.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit">
              Salvar serviço
            </button>
          </form>
          <div className="admin-actions">
            <button className="secondary-button" onClick={runChecks}>
              Executar checks
            </button>
            {message ? <span>{message}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [connection, setConnection] = useState("Conectando");
  const [error, setError] = useState("");

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let eventSource: EventSource | null = null;

    fetchSnapshot()
      .then((data) => {
        setSnapshot(data);
        setSelectedServiceId((current) => current ?? data.categories[0]?.services[0]?.id ?? null);
        setError("");
      })
      .catch(() => setError("Não foi possível carregar o status agora."));

    try {
      eventSource = new EventSource("/api/public/status/events");
      eventSource.addEventListener("status-update", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as Snapshot;
        setSnapshot(data);
        setSelectedServiceId((current) => current ?? data.categories[0]?.services[0]?.id ?? null);
        setConnection("Tempo real");
        setError("");
      });
      eventSource.onerror = () => {
        setConnection("Fallback 10s");
        if (!fallbackTimer) {
          fallbackTimer = window.setInterval(() => {
            fetchSnapshot().then(setSnapshot).catch(() => setError("Fallback sem resposta."));
          }, 10000);
        }
      };
    } catch {
      setConnection("Fallback 10s");
      fallbackTimer = window.setInterval(() => {
        fetchSnapshot().then(setSnapshot).catch(() => setError("Fallback sem resposta."));
      }, 10000);
    }

    return () => {
      eventSource?.close();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, []);

  const selectedService = useMemo(
    () => findService(snapshot, selectedServiceId),
    [snapshot, selectedServiceId]
  );

  if (!snapshot) {
    return (
      <main className="app-shell loading-screen">
        <span className="brand-mark">N</span>
        <p>Carregando Status NexTech...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">N</span>
          <span>
            <strong>NexTech</strong>
            <small>Status Page</small>
          </span>
        </a>
        <nav>
          <span className="connection">{connection}</span>
          <a className="secondary-button" href={platformUrl}>
            Voltar ao painel
          </a>
        </nav>
      </header>

      <section className={`status-hero ${statusClass(snapshot.globalStatus)}`}>
        <div>
          <StatusPill status={snapshot.globalStatus} />
          <h1>{snapshot.globalMessage}</h1>
          <p>
            {snapshot.servicesTotal} serviços monitorados · snapshot gerado em{" "}
            {formatDate(snapshot.generatedAt)}
          </p>
          {error ? <strong className="error-text">{error}</strong> : null}
        </div>
        <div className="hero-metrics">
          <span>
            <small>Janela</small>
            <strong>{snapshot.historyWindow.label}</strong>
          </span>
          <span>
            <small>Intervalo</small>
            <strong>{snapshot.historyWindow.intervalSeconds}s</strong>
          </span>
          <span>
            <small>Atualização</small>
            <strong>{connection}</strong>
          </span>
        </div>
      </section>

      <section className="content-grid">
        <div className="services-column">
          {snapshot.categories.map((category) => (
            <section key={category.name} className="category-section">
              <div className="section-heading">
                <h2>{category.name}</h2>
                <span>{category.services.length} serviços</span>
              </div>
              <div className="services-grid">
                {category.services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    selected={service.id === selectedServiceId}
                    onSelect={() => setSelectedServiceId(service.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <DetailPanel service={selectedService ?? null} />
      </section>

      <IncidentList incidents={snapshot.incidents} maintenances={snapshot.maintenances} />
      <AdminPanel onChanged={setSnapshot} />
    </main>
  );
}
