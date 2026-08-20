import http from "node:http";

const port = Number(process.env.PORT || 3100);
const request = http.request(
  {
    host: "127.0.0.1",
    port,
    path: "/healthz",
    method: "GET",
    timeout: 3000
  },
  (response) => {
    let data = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      data += chunk;
    });
    response.on("end", () => {
      if (response.statusCode !== 200) {
        console.error(`Unexpected status ${response.statusCode}`);
        process.exit(1);
      }
      const parsed = JSON.parse(data);
      if (!parsed.ok || parsed.phase !== "phase1-inert") {
        console.error("Unexpected health payload");
        process.exit(1);
      }
      process.exit(0);
    });
  }
);

request.on("timeout", () => {
  request.destroy(new Error("healthcheck timeout"));
});
request.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
request.end();
