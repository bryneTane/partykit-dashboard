import "server-only";
// Reads used by pages and route handlers alike, so both show the same data and errors.
import type {
  ConnectionsResponse,
  EventsResponse,
  HealthResponse,
  ProjectSetupReport,
  RegistrySnapshot,
  RoomStats,
} from "partykit-dashboard/types";
import type { ProjectEntry } from "./config";
import { readUpstream, type UpstreamResult } from "./upstream.server";

export function registrySnapshot(entry: ProjectEntry): Promise<UpstreamResult<RegistrySnapshot>> {
  return readUpstream(entry, { party: entry.registryParty, room: "index" });
}

export function registryHealth(entry: ProjectEntry): Promise<UpstreamResult<HealthResponse>> {
  return readUpstream(entry, { party: entry.registryParty, room: "index", query: { dashboard: "health" } });
}

export function registryConfig(entry: ProjectEntry): Promise<UpstreamResult<ProjectSetupReport>> {
  return readUpstream(entry, { party: entry.registryParty, room: "index", query: { dashboard: "config" } });
}

export function roomEvents(
  entry: ProjectEntry,
  room: string,
  opts: { since?: number; limit?: number; party?: string } = {},
): Promise<UpstreamResult<EventsResponse>> {
  const { party = entry.party, ...query } = opts;
  return readUpstream(entry, { party, room, query: { dashboard: "events", ...query } });
}

export function roomStats(entry: ProjectEntry, room: string, party = entry.party): Promise<UpstreamResult<RoomStats>> {
  return readUpstream(entry, { party, room, query: { dashboard: "stats" } });
}

export function roomConnections(
  entry: ProjectEntry,
  room: string,
  party = entry.party,
): Promise<UpstreamResult<ConnectionsResponse>> {
  return readUpstream(entry, { party, room, query: { dashboard: "connections" } });
}
