import process from "node:process";
import WebSocket from "ws";

const url = process.env.DASHBOARD_WS_URL;
const token = process.env.DASHBOARD_TOKEN;
if (!url || !token) throw new Error("DASHBOARD_WS_URL and DASHBOARD_TOKEN are required");

const encodedToken = Buffer.from(token, "utf8").toString("base64url");
const socket = new WebSocket(url, ["news-signal", `auth.${encodedToken}`]);
const timeout = setTimeout(() => {
  console.error("Timed out waiting for a dashboard event");
  socket.terminate();
  process.exit(1);
}, 15_000);

socket.on("message", (data) => {
  const event = JSON.parse(data.toString());
  console.log(JSON.stringify(event));
  if (event.type !== "connected") {
    clearTimeout(timeout);
    socket.close();
    process.exit(0);
  }
});

socket.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exit(1);
});
