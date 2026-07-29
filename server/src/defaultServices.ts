import type { ServiceRecord } from "./types.js";

const now = new Date().toISOString();

const monitoredApiPath = "/api/status";

export const defaultServices: ServiceRecord[] = [
  {
    id: "nextech-dashboard",
    category: "Web",
    name: "Dashboard NextTech",
    description: "Dashboard pública, autenticação e rotas principais.",
    critical: true,
    public: true,
    healthSources: [{ path: monitoredApiPath, label: "Status API - Dashboard", latencyWarningMs: 1500 }],
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
    healthSources: [{ path: monitoredApiPath, label: "Status API - API Pública", latencyWarningMs: 1500 }],
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
    healthSources: [{ path: monitoredApiPath, label: "Status API - Bot Discord", latencyWarningMs: 1500 }],
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
    healthSources: [{ path: monitoredApiPath, label: "Status API - Jobs", latencyWarningMs: 1500 }],
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
    healthSources: [{ path: monitoredApiPath, label: "Status API - Pagamentos", latencyWarningMs: 1500 }],
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
    healthSources: [{ path: monitoredApiPath, label: "Status API - Dados", latencyWarningMs: 1000 }],
    currentStatus: "unknown",
    responseTimeMs: null,
    uptimePercentage: 100,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  }
];
