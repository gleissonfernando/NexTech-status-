import { describe, expect, it } from "vitest";
import {
  effectiveStatus,
  normalizePercentage,
  serviceVisualStatus,
  STATUS_STALE_TIMEOUT,
  type StatusService
} from "./statusView";

const now = new Date("2026-08-05T02:00:00.000Z").getTime();
const fresh = new Date(now - 5_000).toISOString();

function service(uptimePercentage: number, patch: Partial<StatusService> = {}): StatusService {
  return {
    currentStatus: "operational",
    uptimePercentage,
    lastCheckedAt: fresh,
    ...patch
  };
}

describe("status view rules", () => {
  it.each([
    [100, "operational"],
    [90, "operational"],
    [89, "warning"],
    [70, "warning"],
    [69, "degraded"],
    [40, "degraded"],
    [39, "critical"],
    [1, "critical"],
    [0, "offline"]
  ] as const)("classifies %s%% as %s", (percentage, expected) => {
    expect(serviceVisualStatus(service(percentage), now)).toBe(expected);
  });

  it("normalizes invalid progress values", () => {
    expect(normalizePercentage(-10)).toBe(0);
    expect(normalizePercentage(120)).toBe(100);
    expect(normalizePercentage("bad")).toBe(0);
  });

  it("treats missing responses and stale data as offline", () => {
    expect(serviceVisualStatus(service(100, { currentStatus: "unknown" }), now)).toBe("offline");
    expect(effectiveStatus(service(100, {
      lastCheckedAt: new Date(now - STATUS_STALE_TIMEOUT - 1).toISOString()
    }), now)).toBe("unknown");
  });

  it("keeps critical responding services red instead of offline", () => {
    expect(serviceVisualStatus(service(20, { currentStatus: "major_outage" }), now)).toBe("critical");
  });
});
