import { request } from "node:http";

const check = request(
  {
    host: "127.0.0.1",
    port: Number.parseInt(process.env.PORT || "3000", 10),
    path: "/health/ready",
    method: "GET",
    timeout: 4_000,
  },
  (response) => {
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);

check.on("error", () => process.exit(1));
check.on("timeout", () => {
  check.destroy();
  process.exit(1);
});
check.end();
