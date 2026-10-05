// Default registry for partykit.json: reads the secret from env.DASHBOARD_SECRET.
import { createRegistry } from "./registry.js";

export default createRegistry();
