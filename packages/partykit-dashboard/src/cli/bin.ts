#!/usr/bin/env node
import { main } from "./main.js";

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
