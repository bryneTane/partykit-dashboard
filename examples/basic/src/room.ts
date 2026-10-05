import { withDashboard } from "partykit-dashboard";
import { PubSubRoom } from "./pubsub";

export default withDashboard(PubSubRoom, {
  classify: (roomId) => (roomId.startsWith("demo-") ? "demo" : "room"),
  summarize: (body) => {
    const status = (body as { status?: unknown } | undefined)?.status;
    return typeof status === "string" ? status : null;
  },
});
