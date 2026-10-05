// Publishes a status event to a few rooms every second, like an app or worker would.
const host = process.env.PARTYKIT_HOST ?? "localhost:1999";
const secret = process.env.PUBLISH_SECRET ?? "local-example-secret";
const scheme = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
const rooms = ["demo-alpha", "demo-beta", "demo-gamma"];
const statuses = ["queued", "running", "uploading", "done"];
let n = 0;

console.log(`publishing to ${rooms.join(", ")} on ${host} (Ctrl-C to stop)`);
setInterval(async () => {
  n++;
  const room = rooms[n % rooms.length];
  const body = JSON.stringify({ status: statuses[n % statuses.length], n, at: new Date().toISOString() });
  try {
    const res = await fetch(`${scheme}://${host}/parties/main/${room}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-dashboard-source": "demo" },
      body,
    });
    console.log(`${room} ${res.status}`);
  } catch (e) {
    console.log(`${room} unreachable: ${e.message}`);
  }
}, 1000);
