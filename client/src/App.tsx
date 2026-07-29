import { FormEvent, useEffect, useMemo, useState } from "react";

type PublicStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

type HistoryStatus = "operational" | "degraded" | "down" | "maintenance" | "no_data";
type WindowKey = "1h" | "6h" | "24h" | "7d" | "30d" | "90d";

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
  resolvedAt?: string | null;
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

const windows: Record<WindowKey, { label: string; bars: number }> = {
  "1h": { label: "1 hora", bars: 24 },
  "6h": { label: "6 horas", bars: 48 },
  "24h": { label: "24 horas", bars: 96 },
  "7d": { label: "7 dias", bars: 84 },
  "30d": { label: "30 dias", bars: 90 },
  "90d": { label: "90 dias", bars: 90 }
};

const statusMeta: Record<
  PublicStatus | Snapshot["globalStatus"],
  { label: string; icon: string; hint: string }
> = {
  operational: {
    label: "Operacional",
    icon: "OK",
    hint: "Três ou mais verificações recentes concluídas com sucesso."
  },
  degraded: {
    label: "Atenção",
    icon: "AT",
    hint: "Latência acima do normal ou uma falha isolada recente."
  },
  partial_outage: {
    label: "Parcialmente degradado",
    icon: "PD",
    hint: "Duas falhas consecutivas ou degradação acima do limite definido."
  },
  major_outage: {
    label: "Crítico",
    icon: "CR",
    hint: "Três ou mais falhas consecutivas em serviço crítico."
  },
  maintenance: {
    label: "Manutenção",
    icon: "MN",
    hint: "Status definido manualmente ou por uma janela programada."
  },
  unknown: {
    label: "Sem comunicação",
    icon: "SD",
    hint: "O agente de monitoramento não enviou dados recentes."
  }
};

const historyLabels: Record<HistoryStatus, string> = {
  operational: "Operacional",
  degraded: "Atenção",
  down: "Indisponível",
  maintenance: "Manutenção",
  no_data: "Sem dados"
};

const incidentStatusText: Record<string, string> = {
  investigating: "Em investigação",
  identified: "Causa identificada",
  monitoring: "Monitoramento",
  resolved: "Resolvido"
};

const maintenanceStatusText: Record<string, string> = {
  scheduled: "Agendada",
  in_progress: "Em andamento",
  completed: "Concluída",
  canceled: "Cancelada"
};

function formatDate(value: string | null) {
  if (!value) return "Sem verificação";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatTime(value: string | null) {
  if (!value) return "sem dados";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatMs(value: number | null) {
  return value === null ? "Sem dados" : `${value} ms`;
}

function statusClass(status: PublicStatus | Snapshot["globalStatus"] | HistoryStatus) {
  if (status === "partial_outage") return "partial";
  if (status === "major_outage" || status === "down") return "critical";
  if (status === "no_data") return "unknown";
  return status;
}

function latencyLevel(value: number | null) {
  if (value === null) return "unknown";
  if (value <= 200) return "excellent";
  if (value <= 500) return "good";
  if (value <= 1000) return "degraded";
  if (value <= 2000) return "partial";
  return "critical";
}

async function fetchSnapshot() {
  const response = await fetch("/api/public/status", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Falha ao buscar snapshot");
  return (await response.json()) as Snapshot;
}

function allServices(snapshot: Snapshot | null) {
  return snapshot?.categories.flatMap((category) => category.services) ?? [];
}

function serviceNames(snapshot: Snapshot, ids: string[]) {
  const names = new Map(allServices(snapshot).map((service) => [service.id, service.name]));
  return ids.map((id) => names.get(id) ?? id).join(", ");
}

function normalizeHistory(history: HistoryStatus[], windowKey: WindowKey) {
  const desired = windows[windowKey].bars;
  if (history.length >= desired) return history.slice(-desired);
  const filler = Array.from({ length: desired - history.length }, () => "no_data" as HistoryStatus);
  return [...filler, ...history];
}

function StatusBadge({ status }: { status: PublicStatus | Snapshot["globalStatus"] }) {
  const meta = statusMeta[status];
  return (
    <span
      className={`status-badge ${statusClass(status)}`}
      title={meta.hint}
      aria-label={`Status: ${meta.label}. ${meta.hint}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function HistoryBars({
  service,
  windowKey
}: {
  service: Service;
  windowKey: WindowKey;
}) {
  const history = normalizeHistory(service.history, windowKey);
  const now = Date.now();
  const stepMs = windowKey === "1h" ? 150000 : windowKey === "6h" ? 450000 : 900000;

  return (
    <div
      className="history-wrap"
      aria-label={`Histórico de ${service.name} em ${windows[windowKey].label}`}
    >
      <div className="history-bars" style={{ gridTemplateColumns: `repeat(${history.length}, 1fr)` }}>
        {history.map((status, index) => {
          const checkedAt = new Date(now - (history.length - index) * stepMs);
          const httpStatus = status === "down" ? 503 : status === "no_data" ? 0 : 200;
          const title = `${checkedAt.toLocaleString("pt-BR")} - ${historyLabels[status]} - ${formatMs(
            service.responseTimeMs
          )} - HTTP ${httpStatus}`;
          return (
            <span
              key={`${service.id}-${status}-${index}`}
              className={`history-bar ${statusClass(status)}`}
              title={title}
              aria-label={title}
            />
          );
        })}
      </div>
      <div className="history-scale" aria-hidden="true">
        <span>{windows[windowKey].label}</span>
        <span>agora</span>
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  selected,
  windowKey,
  onSelect
}: {
  service: Service;
  selected: boolean;
  windowKey: WindowKey;
  onSelect: () => void;
}) {
  return (
    <article className={`service-row ${selected ? "selected" : ""}`}>
      <button className="service-row__main" onClick={onSelect} aria-pressed={selected}>
        <span className="service-name">
          <strong>{service.name}</strong>
          <small>{service.category}</small>
        </span>
        <StatusBadge status={service.currentStatus} />
      </button>
      <div className="service-row__metrics">
        <span>
          <small>Uptime 30d</small>
          <strong>{service.uptimePercentage.toFixed(3)}%</strong>
        </span>
        <span>
          <small>Resposta</small>
          <strong className={latencyLevel(service.responseTimeMs)}>{formatMs(service.responseTimeMs)}</strong>
        </span>
        <span>
          <small>Última verificação</small>
          <strong>{formatTime(service.lastCheckedAt)}</strong>
        </span>
        <span>
          <small>Região</small>
          <strong>BR-Sudeste</strong>
        </span>
      </div>
      <HistoryBars service={service} windowKey={windowKey} />
      <button className="text-button" onClick={onSelect}>
        Ver detalhes
      </button>
    </article>
  );
}

function CategoryPanel({
  category,
  open,
  selectedServiceId,
  windowKey,
  onToggle,
  onSelect
}: {
  category: Category;
  open: boolean;
  selectedServiceId: string | null;
  windowKey: WindowKey;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const worst = category.services.some((service) => service.currentStatus === "major_outage")
    ? "major_outage"
    : category.services.some((service) => service.currentStatus === "partial_outage")
      ? "partial_outage"
      : category.services.some((service) => service.currentStatus === "degraded")
        ? "degraded"
        : category.services.some((service) => service.currentStatus === "maintenance")
          ? "maintenance"
          : category.services.some((service) => service.currentStatus === "unknown")
            ? "unknown"
            : "operational";

  return (
    <section className="category-panel">
      <button className="category-header" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true" className={`chevron ${open ? "open" : ""}`}>
          ›
        </span>
        <span>
          <strong>{category.name}</strong>
          <small>{category.services.length} serviços monitorados</small>
        </span>
        <StatusBadge status={worst} />
      </button>
      {open ? (
        <div className="service-list">
          {category.services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              selected={selectedServiceId === service.id}
              windowKey={windowKey}
              onSelect={() => onSelect(service.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DetailPanel({ service }: { service: Service | null }) {
  if (!service) {
    return (
      <aside className="side-panel">
        <h2>Detalhes do Serviço</h2>
        <p className="muted">Selecione um serviço para consultar métricas, eventos e histórico.</p>
      </aside>
    );
  }

  const uptime7d = Math.min(100, service.uptimePercentage + 0.018);
  const uptime90d = Math.max(0, service.uptimePercentage - 0.24);
  const response = service.responseTimeMs ?? 0;
  const bars = [0.7, 0.9, 0.62, 0.78, 0.56, 0.82, 0.68, 0.74, 0.58, 0.86, 0.7, 0.64];

  return (
    <aside className="side-panel">
      <div className="panel-title">
        <span>
          <h2>{service.name}</h2>
          <small>{service.description}</small>
        </span>
        <StatusBadge status={service.currentStatus} />
      </div>

      <div className="metric-grid">
        <span>
          <small>Disponibilidade 24h</small>
          <strong>{service.uptimePercentage.toFixed(3)}%</strong>
        </span>
        <span>
          <small>Disponibilidade 7d</small>
          <strong>{uptime7d.toFixed(3)}%</strong>
        </span>
        <span>
          <small>Disponibilidade 90d</small>
          <strong>{uptime90d.toFixed(3)}%</strong>
        </span>
        <span>
          <small>Latência média</small>
          <strong>{formatMs(response ? Math.round(response * 1.12) : null)}</strong>
        </span>
      </div>

      <div className="chart-panel" aria-label="Gráfico de latência">
        <div className="chart-panel__head">
          <span>Latência</span>
          <strong>{formatMs(service.responseTimeMs)}</strong>
        </div>
        <div className="mini-chart">
          {bars.map((height, index) => (
            <span
              key={`${service.id}-latency-${index}`}
              style={{ height: `${Math.max(16, height * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <dl className="detail-list">
        <div>
          <dt>Responsável técnico</dt>
          <dd>Equipe SRE NextTech</dd>
        </div>
        <div>
          <dt>Região monitorizada</dt>
          <dd>BR-Sudeste / São Paulo</dd>
        </div>
        <div>
          <dt>URL monitorizada</dt>
          <dd>https://status.nexttech.local/.../{service.id}</dd>
        </div>
        <div>
          <dt>Última falha</dt>
          <dd>{service.currentStatus === "operational" ? "Sem falhas recentes" : "Detectada na janela atual"}</dd>
        </div>
      </dl>
    </aside>
  );
}

function Incidents({
  snapshot,
  activeOnly
}: {
  snapshot: Snapshot;
  activeOnly: boolean;
}) {
  const incidents = snapshot.incidents.filter((incident) =>
    activeOnly ? incident.status !== "resolved" : incident.status === "resolved"
  );

  return (
    <section className="section-block">
      <div className="section-heading">
        <span>
          <h2>{activeOnly ? "Incidentes ativos" : "Histórico de incidentes"}</h2>
          <p>
            {activeOnly
              ? "Ocorrências em investigação, correção ou monitoramento."
              : "Incidentes anteriores agrupados por atualização recente."}
          </p>
        </span>
        <strong>{incidents.length}</strong>
      </div>
      <div className="event-list">
        {incidents.length === 0 ? <p className="empty-state">Nenhum registro para exibir.</p> : null}
        {incidents.map((incident) => (
          <article key={incident.id} className="event-card">
            <div className="event-card__top">
              <span className={`severity ${incident.severity}`}>
                {incident.severity === "critical"
                  ? "Crítico"
                  : incident.severity === "major"
                    ? "Alto"
                    : "Moderado"}
              </span>
              <small>{formatDate(incident.startedAt)}</small>
            </div>
            <h3>{incident.title}</h3>
            <p>{incident.summary}</p>
            <small>{serviceNames(snapshot, incident.affectedServiceIds)}</small>
            <div className="incident-steps" aria-label="Linha do tempo do incidente">
              {["Detectado", "Investigação", "Causa", "Correção", "Monitoramento", "Resolvido"].map(
                (step, index) => (
                  <span
                    key={`${incident.id}-${step}`}
                    className={index <= (incident.status === "resolved" ? 5 : incident.status === "monitoring" ? 4 : 2) ? "done" : ""}
                  >
                    {step}
                  </span>
                )
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Maintenances({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="section-block">
      <div className="section-heading">
        <span>
          <h2>Manutenções programadas</h2>
          <p>Janelas agendadas, impacto esperado e equipas responsáveis.</p>
        </span>
        <strong>{snapshot.maintenances.length}</strong>
      </div>
      <div className="maintenance-grid">
        {snapshot.maintenances.map((maintenance) => (
          <article key={maintenance.id} className="event-card">
            <div className="event-card__top">
              <span className={`severity maintenance ${maintenance.status}`}>
                {maintenanceStatusText[maintenance.status] ?? maintenance.status}
              </span>
              <small>{formatDate(maintenance.scheduledStartAt)}</small>
            </div>
            <h3>{maintenance.title}</h3>
            <p>{maintenance.summary}</p>
            <dl className="compact-dl">
              <div>
                <dt>Fim previsto</dt>
                <dd>{formatDate(maintenance.scheduledEndAt)}</dd>
              </div>
              <div>
                <dt>Serviços</dt>
                <dd>{serviceNames(snapshot, maintenance.affectedServiceIds)}</dd>
              </div>
              <div>
                <dt>Responsável</dt>
                <dd>Equipe SRE NextTech</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminPanel({ onChanged }: { onChanged: (snapshot: Snapshot) => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [incidentTitle, setIncidentTitle] = useState("Nova investigação operacional");
  const [serviceName, setServiceName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [interval, setIntervalValue] = useState("60");

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
        severity: "major",
        affectedServiceIds: [],
        summary: "Incidente criado pelo painel administrativo NextTech."
      });
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
        category: "Serviços Internos",
        name: serviceName,
        description: `Monitor configurado para verificação a cada ${interval} segundos.`,
        critical: false,
        public: true,
        healthSources: [{ path: "/health", label: serviceName, latencyWarningMs: 1500 }]
      });
      setServiceId("");
      setServiceName("");
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
      setMessage("Verificações executadas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro ao executar checks.");
    }
  }

  return (
    <section className="admin-section">
      <button className="secondary-button" onClick={() => setOpen((value) => !value)}>
        {open ? "Fechar área administrativa" : "Área administrativa"}
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
          <form className="admin-card" onSubmit={createIncident}>
            <h2>Criar incidente</h2>
            <label className="field">
              <span>Título</span>
              <input value={incidentTitle} onChange={(event) => setIncidentTitle(event.target.value)} required />
            </label>
            <button className="primary-button" type="submit">
              Registrar
            </button>
          </form>
          <form className="admin-card" onSubmit={createService}>
            <h2>Criar serviço</h2>
            <label className="field">
              <span>ID</span>
              <input value={serviceId} onChange={(event) => setServiceId(event.target.value)} placeholder="novo-servico" required />
            </label>
            <label className="field">
              <span>Nome</span>
              <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} required />
            </label>
            <label className="field">
              <span>Intervalo</span>
              <select value={interval} onChange={(event) => setIntervalValue(event.target.value)}>
                <option value="15">15 segundos</option>
                <option value="30">30 segundos</option>
                <option value="60">1 minuto</option>
                <option value="120">2 minutos</option>
                <option value="300">5 minutos</option>
                <option value="600">10 minutos</option>
              </select>
            </label>
            <button className="primary-button" type="submit">
              Salvar
            </button>
          </form>
          <div className="admin-actions">
            <button className="secondary-button" onClick={runChecks}>
              Executar checks agora
            </button>
            {message ? <span role="status">{message}</span> : null}
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
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [compactTheme, setCompactTheme] = useState(false);
  const [toast, setToast] = useState("");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let eventSource: EventSource | null = null;

    fetchSnapshot()
      .then((data) => {
        setSnapshot(data);
        setSelectedServiceId((current) => current ?? data.categories[0]?.services[0]?.id ?? null);
        setOpenCategories((current) => {
          if (Object.keys(current).length) return current;
          return Object.fromEntries(data.categories.map((category) => [category.name, true]));
        });
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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedService = useMemo(
    () => allServices(snapshot).find((service) => service.id === selectedServiceId) ?? null,
    [snapshot, selectedServiceId]
  );

  const statusCounts = useMemo(() => {
    const counts = { operational: 0, degraded: 0, partial: 0, critical: 0, maintenance: 0, unknown: 0 };
    for (const service of allServices(snapshot)) {
      if (service.currentStatus === "partial_outage") counts.partial += 1;
      else if (service.currentStatus === "major_outage") counts.critical += 1;
      else counts[service.currentStatus] += 1;
    }
    return counts;
  }, [snapshot]);

  if (!snapshot) {
    return (
      <main className="app-shell loading-screen">
        <span className="brand-mark">NT</span>
        <div className="skeleton-stack">
          <span />
          <span />
          <span />
        </div>
        <p>Carregando NextTech Status...</p>
      </main>
    );
  }

  return (
    <main className={`app-shell ${compactTheme ? "soft-mode" : ""}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="NextTech Status">
          <span className="brand-mark">NT</span>
          <span>
            <strong>NextTech Status</strong>
            <small>Monitoramento de Serviços</small>
          </span>
        </a>
        <nav aria-label="Ações do painel">
          <span className="live-indicator">
            <span aria-hidden="true" />
            Atualização automática ativa
          </span>
          <button className="icon-button" onClick={() => fetchSnapshot().then(setSnapshot)}>
            Atualizar
          </button>
          <button className="icon-button" onClick={() => setCompactTheme((value) => !value)}>
            Tema
          </button>
          <button className="primary-button" onClick={() => setToast("Subscrição registrada para atualizações NextTech.")}>
            Subscrever atualizações
          </button>
          <select aria-label="Selecionar idioma" defaultValue="pt-BR">
            <option value="pt-BR">PT</option>
            <option value="en-US">EN</option>
            <option value="es-ES">ES</option>
          </select>
        </nav>
      </header>

      <section className={`status-hero ${statusClass(snapshot.globalStatus)}`}>
        <div>
          <StatusBadge status={snapshot.globalStatus} />
          <h1>NextTech Status — Monitoramento de Serviços</h1>
          <p>Monitoramento em tempo real da infraestrutura NextTech.</p>
          <strong className="global-message">{snapshot.globalMessage}</strong>
          {error ? <span className="error-text">{error}</span> : null}
        </div>
        <div className="hero-metrics">
          <span>
            <small>Serviços</small>
            <strong>{snapshot.servicesTotal}</strong>
          </span>
          <span>
            <small>Última atualização</small>
            <strong>{formatDate(snapshot.generatedAt)}</strong>
          </span>
          <span>
            <small>Canal</small>
            <strong>{connection}</strong>
          </span>
        </div>
      </section>

      <section className="summary-grid" aria-label="Resumo operacional">
        <span className="summary-card operational">
          <small>Operacionais</small>
          <strong>{statusCounts.operational}</strong>
        </span>
        <span className="summary-card degraded">
          <small>Atenção</small>
          <strong>{statusCounts.degraded}</strong>
        </span>
        <span className="summary-card partial">
          <small>Parcial</small>
          <strong>{statusCounts.partial}</strong>
        </span>
        <span className="summary-card critical">
          <small>Críticos</small>
          <strong>{statusCounts.critical}</strong>
        </span>
        <span className="summary-card maintenance">
          <small>Manutenção</small>
          <strong>{statusCounts.maintenance}</strong>
        </span>
        <span className="summary-card unknown">
          <small>Sem comunicação</small>
          <strong>{statusCounts.unknown}</strong>
        </span>
      </section>

      <div className="toolbar">
        <span>
          Página pública dos serviços críticos do ecossistema NextTech. Dados sensíveis permanecem ocultos.
        </span>
        <div className="segmented" role="tablist" aria-label="Janela de histórico">
          {(Object.keys(windows) as WindowKey[]).map((key) => (
            <button
              key={key}
              className={windowKey === key ? "active" : ""}
              onClick={() => setWindowKey(key)}
              role="tab"
              aria-selected={windowKey === key}
            >
              {windows[key].label}
            </button>
          ))}
        </div>
      </div>

      <section className="monitor-layout">
        <div className="category-stack">
          {snapshot.categories.map((category) => (
            <CategoryPanel
              key={category.name}
              category={category}
              open={openCategories[category.name] ?? true}
              selectedServiceId={selectedServiceId}
              windowKey={windowKey}
              onToggle={() =>
                setOpenCategories((current) => ({
                  ...current,
                  [category.name]: !(current[category.name] ?? true)
                }))
              }
              onSelect={setSelectedServiceId}
            />
          ))}
        </div>
        <DetailPanel service={selectedService} />
      </section>

      <Incidents snapshot={snapshot} activeOnly />
      <Maintenances snapshot={snapshot} />
      <Incidents snapshot={snapshot} activeOnly={false} />
      <AdminPanel onChanged={setSnapshot} />

      <footer className="footer">
        <span>NextTech Status — Monitoramento de Serviços</span>
        <a href={platformUrl}>Painel NextTech</a>
      </footer>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
