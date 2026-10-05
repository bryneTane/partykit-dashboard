import { describe, expect, it } from "vitest";
import { buildRoute, parseRoute } from "../../src/page/router";

describe("routes", () => {
  it("parses every view", () => {
    expect(parseRoute("#/prod/rooms", "local")).toEqual({ env: "prod", view: "rooms" });
    expect(parseRoute("#/local/room/audit%201?party=small", "local")).toEqual({ env: "local", view: "room", room: "audit 1", party: "small" });
    expect(parseRoute("#/local/delivery/r1?seq=12", "local")).toEqual({ env: "local", view: "delivery", room: "r1", seq: 12 });
    expect(parseRoute("#/local/health", "local")).toEqual({ env: "local", view: "health" });
    expect(parseRoute("#/local/setup", "local")).toEqual({ env: "local", view: "setup" });
  });

  it("falls back to the default environment's rooms", () => {
    expect(parseRoute("", "local")).toEqual({ env: "local", view: "rooms" });
    expect(parseRoute("#/", "dev")).toEqual({ env: "dev", view: "rooms" });
    expect(parseRoute("#/local/unknown", "local")).toEqual({ env: "local", view: "rooms" });
    expect(parseRoute("#/local/room/", "local")).toEqual({ env: "local", view: "rooms" });
  });

  it("ignores malformed seq and party values", () => {
    expect(parseRoute("#/local/delivery/r1?seq=abc&party=Bad%20Party", "local")).toEqual({ env: "local", view: "delivery", room: "r1" });
  });

  it("builds what it parses", () => {
    for (const hash of ["#/local/rooms", "#/local/room/audit%201?party=small", "#/local/delivery/r1?seq=12", "#/dev/health", "#/dev/setup"]) {
      expect(buildRoute(parseRoute(hash, "local"))).toBe(hash);
    }
  });
});
