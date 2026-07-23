import type { Response } from "express";
import { buildSnapshot } from "./snapshot.js";
import type { StatusStore } from "./store.js";

export class StatusEvents {
  private readonly clients = new Set<Response>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly store: StatusStore) {}

  connect(response: Response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    this.clients.add(response);
    this.write(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.broadcast(false), 5000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  broadcast(force = true) {
    if (this.clients.size === 0) return;
    const snapshot = buildSnapshot(this.store);
    void force;
    const payload = `event: status-update\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  private write(response: Response) {
    const snapshot = buildSnapshot(this.store);
    response.write(`event: status-update\ndata: ${JSON.stringify(snapshot)}\n\n`);
  }
}
