import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import http from "node:http";
import { LocalStorage, HttpError, Storage } from "./storage";
import { ScyllaStorage } from "./scylla-storage";
import {
  validateChannel,
  validatePostMessage,
  validateGetMessages,
  validateConsistency,
} from "./validators";
export interface AppOptions {
  storage?: string;
  file?: string;
  seed?: boolean;
  publicDir?: string;
}
export async function createApplication(options: AppOptions = {}) {
  const mode = options.storage ?? process.env.STORAGE_MODE ?? "local";
  if (!["local", "scylla"].includes(mode))
    throw new Error("STORAGE_MODE must be local or scylla");
  for (const setting of [
    "DEFAULT_WRITE_CONSISTENCY",
    "DEFAULT_READ_CONSISTENCY",
  ]) {
    const value = process.env[setting];
    if (
      value !== undefined &&
      (validateConsistency(value).warning ||
        (setting === "DEFAULT_READ_CONSISTENCY" &&
          value.trim().toUpperCase() === "ANY"))
    ) {
      throw new Error(`Invalid consistency configuration: ${setting}`);
    }
  }
  const storage: Storage =
    mode === "local"
      ? await LocalStorage.create(
          options.file ??
            process.env.LOCAL_DATA_FILE ??
            path.resolve("data/chat.json"),
          options.seed,
        )
      : await ScyllaStorage.create();
  const app = express();
  const streams = new Set<express.Response>();
  app.disable("x-powered-by");
  if (process.env.CORS_ORIGIN)
    app.use(cors({ origin: process.env.CORS_ORIGIN }));
  app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT ?? "32kb" }));
  const route =
    (
      fn: (req: express.Request, res: express.Response) => Promise<unknown>,
    ): express.RequestHandler =>
    (req, res, next) => {
      Promise.resolve(fn(req, res)).catch(next);
    };
  const invalid = (errors: string[]) => {
    throw new HttpError(400, "BAD_REQUEST", errors.join("; "));
  };
  const emit = (name: string, data: unknown) => {
    const event = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) {
      if (!res.write(event)) {
        streams.delete(res);
        res.end();
      }
    }
  };
  app.get("/health", (_req, res) => res.json({ ok: true, ...storage.info }));
  app.get(
    "/api/channels",
    route(async (_req, res) =>
      res.json({ ok: true, items: await storage.channels() }),
    ),
  );
  app.post(
    "/api/channels",
    route(async (req, res) => {
      const v = validateChannel(req.body);
      if (!v.valid) invalid(v.errors);
      const channel = await storage.createChannel(
        v.data!.name,
        v.data!.description,
      );
      emit("channel", channel);
      res.status(201).json({ ok: true, channel });
    }),
  );
  app.post(
    "/api/messages",
    route(async (req, res) => {
      const v = validatePostMessage(req.body);
      if (!v.valid) invalid(v.errors);
      const consistency = validateConsistency(v.data!.consistency);
      const result = await storage.post(v.data!, consistency.value);
      if (!result.deduped) emit("message", result.message);
      res.json({
        ok: true,
        message_id: result.message.message_id,
        ...result,
        ...(consistency.warning ? { warning: consistency.warning } : {}),
      });
    }),
  );
  app.get(
    "/api/channels/:channel_id/messages",
    route(async (req, res) => {
      const id = req.params.channel_id;
      if (!id.trim() || id.length > 100) invalid(["Invalid channel_id"]);
      const v = validateGetMessages(req.query);
      if (!v.valid) invalid(v.errors);
      const query = v.data!;
      if (query.consistency === "ANY")
        invalid(["ANY is a write-only consistency"]);
      if (!(await storage.hasChannel(id)))
        throw new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found");
      const level = validateConsistency(
        query.consistency ?? process.env.DEFAULT_READ_CONSISTENCY ?? "ONE",
      );
      const rows = await storage.history(
        id,
        query.limit + 1,
        query.before,
        query.after,
        level.value,
      );
      const items = rows.slice(0, query.limit);
      res.json({
        ok: true,
        items,
        page: {
          next_before:
            rows.length > query.limit
              ? items[items.length - 1].message_id
              : null,
        },
        ...(level.warning ? { warning: level.warning } : {}),
      });
    }),
  );
  app.get("/api/events", (req, res) => {
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write('event: connected\ndata: {"ok":true}\n\n');
    streams.add(res);
    req.on("close", () => streams.delete(res));
  });
  const heartbeat = setInterval(() => {
    for (const res of streams) {
      if (!res.write(": heartbeat\n\n")) {
        streams.delete(res);
        res.end();
      }
    }
  }, 25000);
  heartbeat.unref();
  app.use(
    express.static(options.publicDir ?? path.resolve(__dirname, "../public")),
  );
  app.use((_req, res) =>
    res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Endpoint not found" },
    }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        error instanceof HttpError
          ? error.status
          : error.type === "entity.too.large"
            ? 413
            : error.type === "entity.parse.failed"
              ? 400
              : 500;
      const code =
        error instanceof HttpError
          ? error.code
          : status === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 400
              ? "BAD_REQUEST"
              : "INTERNAL";
      if (status === 500) console.error("Request failed:", error.message);
      res.status(status).json({
        ok: false,
        error: {
          code,
          message:
            status === 500
              ? "Internal server error"
              : error instanceof HttpError
                ? error.message
                : status === 413
                  ? "Request body too large"
                  : "Invalid JSON body",
        },
      });
    },
  );
  let closed = false;
  return {
    app,
    storage,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const res of streams) res.end();
      streams.clear();
      await storage.close();
    },
  };
}
export async function start() {
  const runtime = await createApplication();
  const port = Number(process.env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    await runtime.close();
    throw new Error("Invalid API_PORT");
  }
  const server = http.createServer(runtime.app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  console.log(
    `Mini Discord: http://localhost:${(server.address() as any).port} (${runtime.storage.info.storage})`,
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => server.closeAllConnections(), 5000);
    timeout.unref();
    await Promise.all([
      runtime.close(),
      new Promise<void>((resolve) => server.close(() => resolve())),
    ]);
    clearTimeout(timeout);
  };
  const signal = () => {
    shutdown().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  return {
    server,
    close: async () => {
      process.off("SIGINT", signal);
      process.off("SIGTERM", signal);
      await shutdown();
    },
  };
}
if (require.main === module)
  start().catch((error) => {
    console.error("Startup failed:", error.message);
    process.exitCode = 1;
  });
