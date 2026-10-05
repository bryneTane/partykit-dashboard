import { withDashboard } from "partykit-dashboard";
import { PubSubRoom } from "./pubsub";

export default withDashboard(PubSubRoom, { historySize: 10 });
