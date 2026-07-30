# NexTech Status Page

Sistema independente de Status Page para monitorar serviços da NexTech com API pública, API administrativa, health checks automáticos, histórico, SQLite local e atualização em tempo real via Server-Sent Events.

## Arquitetura

- `server/src`: backend Express, monitoramento, SSE, SQLite e rotas REST.
- `client/src`: frontend React/Vite com tema dark NexTech.
- `data/status.sqlite`: banco local em produção/desenvolvimento, configurável por `.env`.
- `dist/client` e `dist/server`: artefatos de build para deploy em servidor próprio.

## Endpoints públicos

- `GET /health`
- `GET /api/public/status`
- `GET /api/public/status/services`
- `GET /api/public/status/services/:serviceId`
- `GET /api/public/status/incidents`
- `GET /api/public/status/maintenances`
- `GET /api/public/status/history`
- `GET /api/public/status/events`

URLs públicas recomendadas depois do deploy:

- `https://nextech-status.discloud.app/api/public/status`
- `https://nextech-status.discloud.app/api/public/status/events`

Aliases de compatibilidade:

- `GET /api/status`
- `GET /api/services`
- `GET /api/services/:serviceId`
- `GET /api/incidents`
- `GET /api/metrics`

## Endpoints administrativos

Todas as rotas abaixo exigem `Authorization: Bearer <ADMIN_TOKEN>` ou `x-admin-token: <ADMIN_TOKEN>`.

- `GET /api/admin/services`
- `POST /api/admin/services`
- `PATCH /api/admin/services/:serviceId`
- `GET /api/admin/incidents`
- `POST /api/admin/incidents`
- `PATCH /api/admin/incidents/:incidentId`
- `POST /api/admin/maintenance`
- `POST /api/admin/checks/run`

## API de ingestão

Use esta rota quando o sistema principal precisar enviar dados para o Status independente:

- `POST /api/ingest/status`

URL de produção:

```text
https://nextech-status.discloud.app/api/ingest/status
```

Headers:

```http
Authorization: Bearer SEU_INGEST_TOKEN
Content-Type: application/json
```

Nunca envie `INGEST_TOKEN` pelo navegador. Essa chamada deve sair somente do backend da plataforma principal, de um job interno ou de um worker protegido.

Payload:

```json
{
  "services": [
    {
      "id": "public-api",
      "currentStatus": "operational",
      "responseTimeMs": 120,
      "details": {
        "source": "platform-health"
      }
    }
  ]
}
```

Exemplo no site principal:

```js
await fetch("https://nextech-status.discloud.app/api/ingest/status", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.INGEST_TOKEN}`
  },
  body: JSON.stringify({
    services: [
      {
        id: "public-api",
        currentStatus: "operational",
        responseTimeMs: 120
      }
    ]
  })
});
```

Status aceitos:

- `operational`
- `degraded`
- `partial_outage`
- `major_outage`
- `maintenance`
- `unknown`

## Serviços iniciais

- Web: Dashboard NexTech, API Pública
- Serviços: Bot Discord, Jobs Assíncronos, Pagamentos
- Infraestrutura: Armazenamento de Dados, Cache

O serviço `cache` é ocultado automaticamente quando `/health/redis` informa `configured: false`. Pagamentos desativados (`enabled: false`) ficam como `unknown`, sem gerar erro.

## Variáveis de ambiente

Crie `.env` apenas localmente ou configure as variáveis direto no painel da Discloud. Arquivos `.env*` não devem ser versionados.

Variáveis usadas pela aplicação: `PORT`, `NODE_ENV`, `PUBLIC_STATUS_URL`, `PLATFORM_BASE_URL`, `PLATFORM_PANEL_URL`, `CORS_ORIGINS`, `ADMIN_TOKEN`, `INGEST_TOKEN`, `DATABASE_PATH`, `DEFAULT_CHECK_INTERVAL_SECONDS`, `DEFAULT_TIMEOUT_MS`, `HISTORY_RETENTION_HOURS`, `ENABLE_MONITORING`, `RATE_LIMIT_WINDOW_MS` e `RATE_LIMIT_MAX`.

Em `NODE_ENV=production`, a aplicação falha ao iniciar se `ADMIN_TOKEN` ou `INGEST_TOKEN` estiverem ausentes, fracos ou com valores padrão. Use tokens diferentes, com pelo menos 32 caracteres aleatórios.

## Segurança

- Respostas públicas são sanitizadas e não expõem `healthSources`, paths internos, detalhes de checks, tokens, stack traces ou campos de auditoria.
- `ADMIN_TOKEN` e `INGEST_TOKEN` são separados; o token administrativo não autoriza ingestão.
- Comparação de tokens usa `timingSafeEqual`.
- Rotas admin e ingestão têm rate limit mais rígido.
- CORS deve listar somente origens conhecidas; `*` é bloqueado em produção.
- Helmet aplica headers de segurança e CSP.
- Payloads são validados com Zod e limitados a `100kb`.
- Erros públicos retornam códigos genéricos, sem stack trace.

## Como rodar localmente

```bash
npm install
npm run dev
```

Frontend em `http://localhost:5173` e backend em `http://localhost:8080`.

## Build e produção

```bash
npm run build
npm start
```

Em produção, sirva o processo Node atrás de um proxy reverso apontando para `PORT`. O domínio público deste deploy é `https://nextech-status.discloud.app`; mantenha `/api/public/status/*` acessível.

## Deploy na Discloud

O projeto já inclui `discloud.config` na raiz para hospedagem como site/API Node:

```text
TYPE=site
ID=nextech-status
MAIN=index.js
BUILD=npm run build
START=node index.js
RAM=512
VERSION=latest
```

`index.js` fica versionado na raiz para passar na validação inicial da Discloud; depois do `BUILD`, ele carrega `dist/server/index.js`.

Antes do primeiro deploy, crie o subdomínio `nextech-status` na Discloud ou ajuste o campo `ID` para o subdomínio disponível na sua conta. A Discloud exige porta `8080` para sites/APIs, e o projeto já usa `PORT=8080` por padrão. O `package.json` declara Node `>=22` porque o backend usa `node:sqlite`.

Configure as variáveis no painel da Discloud. Em produção, `ADMIN_TOKEN` e `INGEST_TOKEN` precisam ter pelo menos 32 caracteres aleatórios e devem ser diferentes.

Para usar `nextech.com` como domínio raiz, adicione no DNS do provedor os registros A exibidos pela Discloud:

```text
A  @  99.83.186.151
A  @  75.2.96.173
```

Se o provedor exigir o nome completo em vez de `@`, use `nextech.com`. No Cloudflare, deixe esses registros como "DNS only" durante a verificação.

Arquivos pesados ou locais ficam fora do upload por `.discloudignore`, incluindo `node_modules/`, `dist/`, `.git/`, logs e banco SQLite local.

## Monitoramento

O backend consulta `PLATFORM_BASE_URL` usando os health checks:

- `/health` e `/api/health`
- `/health/database`
- `/health/redis`
- `/health/bots`
- `/health/mail`
- `/health/payments`
- `/health/servers`
- `/health/metrics`
- `/health/transcripts`

Regras principais:

- HTTP 200 é operacional, salvo payload com erro.
- HTTP 503 ou payload ruim vira indisponibilidade parcial ou total conforme criticidade.
- API acima de `1500ms`, banco acima de `1000ms` e Redis acima de `500ms` viram `degraded`.
- Tokens, URLs internas, stack traces e secrets não são enviados ao frontend.

## Testes

```bash
npm test
```

Os testes cobrem snapshot público, autenticação admin, registro de incidentes, mudança de status por health check e SSE.

## Limitações conhecidas

- `node:sqlite` no Node 22 ainda emite aviso experimental.
- O painel administrativo é simples e focado em criação/edição básica via API.
- O monitoramento depende dos contratos reais de health check da plataforma principal.
