import type { ServiceRecord } from "./types.js";

const now = new Date().toISOString();

export const defaultServices: ServiceRecord[] = [
  {
    id: "nextech-dashboard",
    category: "Web",
    name: "Dashboard NexTech",
    description: "Dashboard pública, autenticação e rotas principais.",
    critical: true,
    public: true,
    healthSources: [
      { path: "/health", label: "Health geral", latencyWarningMs: 1500 },
      { path: "/health/metrics", label: "Métricas de rotas", latencyWarningMs: 1500 }
    ],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "public-api",
    category: "Web",
    name: "API Pública",
    description: "API pública sanitizada da plataforma.",
    critical: true,
    public: true,
    healthSources: [
      { path: "/health", label: "Health geral", latencyWarningMs: 1500 },
      { path: "/api/health", label: "API health", latencyWarningMs: 1500 },
      { path: "/health/metrics", label: "Métricas de API", latencyWarningMs: 1500 }
    ],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "discord-bot",
    category: "Serviços",
    name: "Bot Discord",
    description: "Conexão do bot principal e eventos do Discord.",
    critical: true,
    public: true,
    healthSources: [{ path: "/health/bots", label: "Bots", latencyWarningMs: 1500 }],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "background-jobs",
    category: "Serviços",
    name: "Jobs Assíncronos",
    description: "Execução de filas, rotinas e tarefas assíncronas.",
    critical: false,
    public: true,
    healthSources: [
      { path: "/health", label: "Jobs no health geral", latencyWarningMs: 1500 },
      { path: "/health/metrics", label: "Métricas internas", latencyWarningMs: 1500 }
    ],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "payments",
    category: "Serviços",
    name: "Pagamentos",
    description: "Checkout, PIX e confirmação de pedidos.",
    critical: false,
    public: true,
    healthSources: [{ path: "/health/payments", label: "Pagamentos", latencyWarningMs: 1500 }],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "data-storage",
    category: "Infraestrutura",
    name: "Armazenamento de Dados",
    description: "Persistência de dados da plataforma.",
    critical: true,
    public: true,
    healthSources: [{ path: "/health/database", label: "Banco de dados", latencyWarningMs: 1000 }],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  },
  {
    id: "cache",
    category: "Infraestrutura",
    name: "Cache",
    description: "Cache e operações de apoio em tempo real.",
    critical: false,
    public: true,
    healthSources: [{ path: "/health/redis", label: "Redis / Cache", latencyWarningMs: 500 }],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  }
];
