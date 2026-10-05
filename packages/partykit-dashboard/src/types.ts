// Shared shapes between the instrumentation and the dashboard.
// All times are Unix milliseconds from the room or registry clock.

export type HistoryEntry =
  | {
      seq: number;
      ts: number;
      type: "event";
      source: string;
      body: string;
      truncated?: boolean;
      recipients: string[];
      recipientCount: number;
      summary: string | null;
    }
  | {
      seq: number;
      ts: number;
      type: "connect" | "close";
      connectionId: string;
    };

export type EventEntry = Extract<HistoryEntry, { type: "event" }>;

export type RoomStats = {
  connections: number;
  eventCount: number;
  lastEventAt: number | null;
  lastSummary: string | null;
  historySize: number;
  oldestSeq: number | null;
  latestSeq: number | null;
  readAt: number;
};

export type ConnectionInfo = {
  id: string;
  connectedAt: number | null;
};

export type EventsResponse = {
  entries: HistoryEntry[];
  oldestSeq: number | null;
  latestSeq: number | null;
  historySize: number;
  /** History entries older than this are deleted; 0 when retention is disabled. */
  retentionMs: number;
  readAt: number;
};

export type ConnectionsResponse = {
  connections: ConnectionInfo[];
  readAt: number;
};

export type RegistryEntry = {
  id: string;
  party: string;
  kind: string | null;
  connections: number;
  eventCount: number;
  lastEventAt: number | null;
  lastSummary: string | null;
  reportedAt: number;
  historySize: number;
  packageVersion: string;
};

export type RegistrySnapshot = {
  rooms: RegistryEntry[];
  readAt: number;
  idleExpiryMs: number;
  /** When the registry received its first report; null before any. */
  firstSeenAt: number | null;
};

export type RequestCounts = {
  "2xx": number;
  "401": number;
  "4xx": number;
  "5xx": number;
  thrown: number;
};

export type HealthBucket = {
  minute: number;
  requests: RequestCounts;
  /** Counts per latency bound, see LATENCY_BOUNDS_MS. */
  latency: number[];
  events: number;
  connects: number;
};

export type HealthResponse = {
  buckets: HealthBucket[];
  firstSeenAt: number | null;
  readAt: number;
};

export type ProjectSetupReport = {
  packageVersion: string;
  idleExpiryMs: number;
  parties: string[];
  envNames: string[];
  historySizes: Record<string, number>;
  firstSeenAt: number | null;
  readAt: number;
};

export type LivePass = {
  v: 1;
  /** Host the pass is valid for. */
  h: string;
  /** Party name. */
  p: string;
  /** Room id, or "*" for the registry. */
  r: string;
  /** Expiry, Unix ms. */
  exp: number;
};

export type RoomReport = {
  party: string;
  id: string;
  kind: string | null;
  connections: number;
  eventCount: number;
  lastEventAt: number | null;
  lastSummary: string | null;
  historySize: number;
  packageVersion: string;
  deltas: HealthBucket[];
};

export type ObserverFrame =
  | { t: "hello"; stats: RoomStats }
  | { t: "entry"; entry: HistoryEntry }
  | { t: "stats"; stats: RoomStats }
  | { t: "registry-hello"; snapshot: RegistrySnapshot }
  | { t: "room"; entry: RegistryEntry }
  | { t: "expired"; party: string; id: string }
  | { t: "health"; bucket: HealthBucket };

export type ErrorBody = { error: string };
