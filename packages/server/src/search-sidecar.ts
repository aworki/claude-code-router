import { startSearchSidecarServer } from "./search/sidecar-server";

const server = startSearchSidecarServer();

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
