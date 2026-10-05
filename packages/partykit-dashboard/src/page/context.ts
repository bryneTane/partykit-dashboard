import type { Route } from "./router.js";

export type EnvInfo = {
  name: string;
  host: string;
  prod: boolean;
  secretEnv: string;
  secretSet: boolean;
  publishSecretEnv: string;
  publishSecretSet: boolean;
};

export type ProjectInfo = {
  name: string;
  configPath: string | null;
  parties: string[];
  party: string;
  registryParty: string;
  environments: EnvInfo[];
  presets: { name: string; body: unknown }[];
  hasLabels: boolean;
  packageVersion: string;
};

export type Ctx = {
  project: ProjectInfo;
  env: EnvInfo;
  route: Route;
  href: (route: Route) => string;
};

/** Mounts a view into root; returns a function that stops its timers and live links. */
export type ViewFn = (root: HTMLElement, ctx: Ctx) => () => void;
