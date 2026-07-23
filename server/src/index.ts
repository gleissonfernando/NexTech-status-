import { createServer } from "node:http";
import { readConfig } from "./config.js";
import { createApp } from "./app.js";

const config = readConfig();
const runtime = createApp({ config });
const server = createServer(runtime.app);

server.listen(config.PORT, () => {
  console.log(`NexTech Status rodando em http://localhost:${config.PORT}`);
});

function shutdown(signal: string) {
  console.log(`Recebido ${signal}, encerrando Status Page...`);
  server.close(() => {
    runtime.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
