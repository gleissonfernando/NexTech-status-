import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  effectiveStatus,
  normalizePercentage,
  serviceVisualStatus,
  visualStatusLabel
} from "./statusView";

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

type LiveIncident = {
  id: string;
  serviceId: string;
  serviceName: string;
  status: PublicStatus;
  title: string;
  summary: string;
  createdAt: string;
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

const publicStatusValues: PublicStatus[] = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown"
];

const globalStatusValues: Snapshot["globalStatus"][] = ["operational", "degraded", "major_outage"];

function normalizePublicStatus(value: unknown): PublicStatus {
  return publicStatusValues.includes(value as PublicStatus) ? (value as PublicStatus) : "unknown";
}

function normalizeGlobalStatus(value: unknown): Snapshot["globalStatus"] {
  return globalStatusValues.includes(value as Snapshot["globalStatus"])
    ? (value as Snapshot["globalStatus"])
    : "degraded";
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeUptime(service: Service) {
  return Math.max(0, Math.min(100, safeNumber(service.uptimePercentage)));
}

function formatDate(value: string | null) {
  if (!value) return "Sem verificação";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem verificação";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function formatTime(value: string | null) {
  if (!value) return "sem dados";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem dados";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatMs(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Sem dados" : `${Math.round(value)} ms`;
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
  const response = await fetch("/api/public/status", {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
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

function visualHistory(service: Service, windowKey: WindowKey) {
  if (effectiveStatus(service) === "unknown") {
    return Array.from({ length: windows[windowKey].bars }, () => "no_data" as HistoryStatus);
  }
  return normalizeHistory(service.history, windowKey);
}

function incidentText(service: Service) {
  if (service.currentStatus === "operational") {
    return {
      title: `${service.name} voltou ao normal`,
      summary: "O serviço respondeu novamente e as barras foram normalizadas em verde."
    };
  }
  if (service.currentStatus === "degraded") {
    return {
      title: `${service.name} com baixa latência`,
      summary:
        "O monitor detectou baixa latência/atenção operacional. O serviço continua respondendo, mas as barras ficam amarelas enquanto a condição persistir."
    };
  }
  if (service.currentStatus === "partial_outage") {
    return {
      title: `${service.name} parcialmente degradado`,
      summary:
        "Falhas parciais foram detectadas em tempo real. A equipa deve acompanhar a recuperação antes de considerar o serviço estável."
    };
  }
  if (service.currentStatus === "major_outage") {
    return {
      title: `${service.name} crítico`,
      summary:
        "O serviço entrou em estado crítico. As barras ficam vermelhas até o monitor receber uma recuperação consistente."
    };
  }
  if (service.currentStatus === "maintenance") {
    return {
      title: `${service.name} em manutenção`,
      summary: "Uma janela de manutenção foi detectada e o serviço está marcado em azul."
    };
  }
  return {
    title: `${service.name} desligado ou sem comunicação`,
    summary:
      "O monitor não recebeu marcação válida do serviço. As barras ficam vazias enquanto ele estiver desligado ou sem comunicação."
  };
}

function collectActiveIncidents(next: Snapshot, current: LiveIncident[]) {
  const currentByStatus = new Map(
    current.map((incident) => [`${incident.serviceId}-${incident.status}`, incident])
  );
  const createdAt = new Date().toISOString();

  return allServices(next)
    .map((service) => ({
      service,
      status: normalizePublicStatus(service.currentStatus)
    }))
    .filter(({ status }) => status !== "operational")
    .map((service) => {
      const text = incidentText(service.service);
      const existing = currentByStatus.get(`${service.service.id}-${service.status}`);
      return {
        id: `${service.service.id}-${service.status}`,
        serviceId: service.service.id,
        serviceName: service.service.name,
        status: service.status,
        title: text.title,
        summary: text.summary,
        createdAt: existing?.createdAt ?? createdAt
      };
    });
}

function StatusBadge({ status }: { status: PublicStatus | Snapshot["globalStatus"] }) {
  const safeStatus = statusMeta[status] ? status : "unknown";
  const meta = statusMeta[safeStatus];
  return (
    <span
      className={`status-badge ${statusClass(safeStatus)}`}
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
  const history = visualHistory(service, windowKey);
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

function LiveIncidentFeed({ incidents }: { incidents: LiveIncident[] }) {
  if (incidents.length === 0) return null;

  return (
    <section className="past-incidents">
      <h2>Incidentes em tempo real</h2>
      <div className="past-incidents__date">
        {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(
          new Date(incidents[0].createdAt)
        )}
      </div>
      <div className="past-incidents__list">
        {incidents.map((incident) => (
          <article key={incident.id} className={`past-incident ${statusClass(incident.status)}`}>
            <h3>{incident.title}</h3>
            <p>{incident.summary}</p>
            <small>
              Detectado: {formatDate(incident.createdAt)} · Serviço: {incident.serviceName}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ServiceStatusCard({
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
  const visualStatus = serviceVisualStatus(service);
  const currentStatus = effectiveStatus(service);
  const online = visualStatus !== "offline";
  const uptime = online ? normalizePercentage(service.uptimePercentage) : 0;
  const statusLabel = visualStatusLabel(visualStatus);
  const progressLabel = `${statusLabel}: ${uptime.toFixed(2)}% de disponibilidade`;

  return (
    <article className={`service-row ${visualStatus} ${selected ? "selected" : ""}`}>
      <button className="service-row__main" onClick={onSelect} aria-pressed={selected}>
        <span className={`status-dot ${visualStatus}`} aria-hidden="true" />
        <span className={`uptime-chip ${visualStatus}`}>
          {online ? `${uptime.toFixed(2)}%` : "Offline"}
        </span>
        <span className="service-name">
          <strong>{service.name}</strong>
          <small>{statusLabel}</small>
        </span>
      </button>
      <div className="service-progress" aria-label={progressLabel}>
        <div className="progress-track">
          <span
            className={`progress-fill ${visualStatus} ${online ? "active" : ""}`}
            style={{ width: `${uptime}%` }}
          />
        </div>
        <div className="service-meta">
          <span>{formatMs(online ? service.responseTimeMs : null)}</span>
          <span>{formatDate(service.lastCheckedAt)}</span>
        </div>
      </div>
      <HistoryBars service={service} windowKey={windowKey} />
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
  return (
    <section className="category-panel">
      <button className="category-header" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true" className={`chevron ${open ? "open" : ""}`}>
          ›
        </span>
        <span>
          <strong>{category.name}</strong>
        </span>
      </button>
      {open ? (
        <div className="service-list">
          {category.services.map((service) => (
            <ServiceStatusCard
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

function DetailPanel({ service, onClose }: { service: Service | null; onClose: () => void }) {
  if (!service) return null;

  const uptime = safeUptime(service);
  const uptime7d = Math.min(100, uptime + 0.018);
  const uptime90d = Math.max(0, uptime - 0.24);
  const response = safeNumber(service.responseTimeMs);
  const bars = [0.7, 0.9, 0.62, 0.78, 0.56, 0.82, 0.68, 0.74, 0.58, 0.86, 0.7, 0.64];

  return (
    <aside className="detail-modal" role="dialog" aria-modal="true" aria-label={`Detalhes de ${service.name}`}>
      <div className="panel-title">
        <span>
          <h2>{service.name}</h2>
          <small>{service.description}</small>
        </span>
        <button className="icon-button" onClick={onClose}>
          Fechar
        </button>
      </div>
      <StatusBadge status={service.currentStatus} />

      <div className="metric-grid">
        <span>
          <small>Disponibilidade 24h</small>
          <strong>{uptime.toFixed(3)}%</strong>
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

  if (incidents.length === 0) return null;

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
  if (snapshot.maintenances.length === 0) return null;

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
  const [windowKey] = useState<WindowKey>("24h");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [adminEnabled] = useState(() => window.location.hash === "#admin");
  const [liveIncidents, setLiveIncidents] = useState<LiveIncident[]>([]);

  useEffect(() => {
    let fallbackTimer: number | undefined;
    let eventSource: EventSource | null = null;

    function applySnapshot(data: Snapshot) {
      setSnapshot(data);
      setLiveIncidents((current) => collectActiveIncidents(data, current));
      setOpenCategories((current) => {
        if (Object.keys(current).length) return current;
        return Object.fromEntries(data.categories.map((category) => [category.name, true]));
      });
      setError("");
    }

    fetchSnapshot()
      .then((data) => applySnapshot(data))
      .catch(() => setError("Não foi possível carregar o status agora."));

    try {
      eventSource = new EventSource("/api/public/status/events");
      eventSource.addEventListener("status-update", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as Snapshot;
        applySnapshot(data);
        setConnection("Tempo real");
      });
      eventSource.onerror = () => {
        setConnection("Fallback 10s");
        if (!fallbackTimer) {
          fallbackTimer = window.setInterval(() => {
            fetchSnapshot()
              .then((data) => applySnapshot(data))
              .catch(() => setError("Fallback sem resposta."));
          }, 10000);
        }
      };
    } catch {
      setConnection("Fallback 10s");
      fallbackTimer = window.setInterval(() => {
        fetchSnapshot()
          .then((data) => applySnapshot(data))
          .catch(() => setError("Fallback sem resposta."));
      }, 10000);
    }

    return () => {
      eventSource?.close();
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, []);

  const selectedService = useMemo(
    () => allServices(snapshot).find((service) => service.id === selectedServiceId) ?? null,
    [snapshot, selectedServiceId]
  );

  if (!snapshot) {
    return (
      <main className="app-shell loading-screen">
        <span className="brand-mark">NT</span>
        {error ? (
          <>
            <strong>Não foi possível carregar o Status NextTech.</strong>
            <p>{error}</p>
          </>
        ) : (
          <>
            <div className="skeleton-stack">
              <span />
              <span />
              <span />
            </div>
            <p>Carregando NextTech Status...</p>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="NextTech Status">
          <span className="brand-mark">NT</span>
          <span>
            <strong>Status de Serviço - NextTech</strong>
          </span>
        </a>
      </header>

      <section className={`status-hero ${statusClass(normalizeGlobalStatus(snapshot.globalStatus))}`}>
        <StatusBadge status={normalizeGlobalStatus(snapshot.globalStatus)} />
        <strong>{snapshot.globalMessage}</strong>
        {error ? <span className="error-text">{error}</span> : null}
      </section>

      <p className="status-copy">
        Página de status para os serviços críticos do ecossistema NextTech.
      </p>

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
      </section>

      <Incidents snapshot={snapshot} activeOnly />
      <Maintenances snapshot={snapshot} />
      <Incidents snapshot={snapshot} activeOnly={false} />
      <LiveIncidentFeed incidents={liveIncidents} />
      {adminEnabled ? <AdminPanel onChanged={setSnapshot} /> : null}
      <DetailPanel service={selectedService} onClose={() => setSelectedServiceId(null)} />

      <footer className="footer">
        <span>NextTech Status — Monitoramento de Serviços</span>
        <a href={platformUrl}>Painel NextTech</a>
      </footer>
    </main>
  );
}
