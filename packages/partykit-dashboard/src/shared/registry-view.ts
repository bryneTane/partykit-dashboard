// Pure helpers for the registry view: apply live frames, filter, sort, aggregate.
import type { HealthBucket, ObserverFrame, RegistryEntry, RegistrySnapshot } from "../types.js";

const same = (a: RegistryEntry, party: string, id: string) => a.party === party && a.id === id;

export function applyFrame(snapshot: RegistrySnapshot | null, frame: ObserverFrame): RegistrySnapshot | null {
  switch (frame.t) {
    case "registry-hello":
      return frame.snapshot;
    case "room": {
      if (!snapshot) return snapshot;
      const { entry } = frame;
      const exists = snapshot.rooms.some((r) => same(r, entry.party, entry.id));
      const rooms = exists
        ? snapshot.rooms.map((r) => (same(r, entry.party, entry.id) ? entry : r))
        : [...snapshot.rooms, entry];
      return { ...snapshot, rooms };
    }
    case "expired":
      if (!snapshot) return snapshot;
      return { ...snapshot, rooms: snapshot.rooms.filter((r) => !same(r, frame.party, frame.id)) };
    default:
      return snapshot;
  }
}

export type RoomFilter = {
  /** undefined: all kinds; null: rooms without a kind; string: that kind. */
  kind?: string | null;
  query?: string;
  labels?: Record<string, string>;
};

export function filterRooms(rooms: RegistryEntry[], filter: RoomFilter): RegistryEntry[] {
  const q = filter.query?.trim().toLowerCase() ?? "";
  return rooms.filter((r) => {
    if (filter.kind !== undefined && r.kind !== filter.kind) return false;
    if (!q) return true;
    const label = filter.labels?.[r.id]?.toLowerCase() ?? "";
    return r.id.toLowerCase().includes(q) || label.includes(q);
  });
}

export function sortRooms(rooms: RegistryEntry[]): RegistryEntry[] {
  return [...rooms].sort((a, b) => {
    if (a.lastEventAt !== b.lastEventAt) {
      if (a.lastEventAt === null) return 1;
      if (b.lastEventAt === null) return -1;
      return b.lastEventAt - a.lastEventAt;
    }
    return b.reportedAt - a.reportedAt;
  });
}

export function kindsOf(rooms: RegistryEntry[]): string[] {
  return [...new Set(rooms.flatMap((r) => (r.kind ? [r.kind] : [])))].sort();
}

export function totalConnections(rooms: RegistryEntry[]): number {
  return rooms.reduce((sum, r) => sum + r.connections, 0);
}

/** Mean events per minute over the last 5 full minutes; null when the registry has never reported. */
export function eventsPerMinute(buckets: HealthBucket[], now: number, firstSeenAt: number | null): number | null {
  if (firstSeenAt === null) return null;
  const current = Math.floor(now / 60_000);
  const events = buckets
    .filter((b) => b.minute >= current - 5 && b.minute < current)
    .reduce((sum, b) => sum + b.events, 0);
  return Math.round((events / 5) * 10) / 10;
}
