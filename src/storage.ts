import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { types } from "cassandra-driver";
import { Channel, Message, PostMessageRequest } from "./types";
import {
  validateChannel,
  validateGetMessages,
  validatePostMessage,
} from "./validators";
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface Storage {
  info: { storage: "local" | "scylla"; dc: string; keyspace: string };
  channels(): Promise<Channel[]>;
  createChannel(name: string, description: string): Promise<Channel>;
  hasChannel(id: string): Promise<boolean>;
  post(
    input: PostMessageRequest,
    consistency: number,
  ): Promise<{ message: Message; deduped: boolean }>;
  history(
    id: string,
    limit: number,
    before?: string,
    after?: string,
    consistency?: number,
  ): Promise<Message[]>;
  close(): Promise<void>;
}
export function channelSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function makeMessage(input: PostMessageRequest): Message {
  const id = types.TimeUuid.now();
  return {
    channel_id: input.channel_id,
    message_id: id.toString(),
    user_id: input.user_id,
    content: input.content,
    created_at: id.getDate().toISOString(),
  };
}
export function compareIds(a: string, b: string) {
  // UUID fields place time_low first; lexical string ordering is not chronological.
  const key = (v: string) =>
    v.slice(15, 18) + v.slice(9, 13) + v.slice(0, 8) + v.slice(19);
  return key(a.toLowerCase()).localeCompare(key(b.toLowerCase()));
}
export function checkRetry(message: Message, input: PostMessageRequest) {
  if (message.user_id !== input.user_id || message.content !== input.content)
    throw new HttpError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "client_msg_id was already used with different content",
    );
}
interface State {
  version: 1;
  channels: Channel[];
  messages: Message[];
  retries: Record<string, string>;
}
export class LocalStorage implements Storage {
  info = { storage: "local" as const, dc: "local", keyspace: "chat" };
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(
    private file: string,
    private state: State,
  ) {}
  static async create(file: string, seed = true): Promise<LocalStorage> {
    file = path.resolve(file);
    await mkdir(path.dirname(file), { recursive: true });
    const lock = file + ".lock";
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(lock, "utf8"));
      let dead = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e: any) {
          dead = e.code === "ESRCH";
        }
      }
      if (!dead)
        throw new Error("Local storage already locked by another process");
      // Only one starter may recover a dead owner; never unlink a newer live lock.
      const recoveryPath = file + ".recovery";
      let recovery;
      try {
        recovery = await open(recoveryPath, "wx", 0o600);
      } catch {
        throw new Error("Local storage lock recovery already in progress");
      }
      try {
        if ((await readFile(lock, "utf8")) !== String(pid)) {
          throw new Error("Local storage lock owner changed during recovery");
        }
        await unlink(lock);
        return await LocalStorage.create(file, seed);
      } finally {
        await recovery.close();
        await unlink(recoveryPath);
      }
    }
    try {
      let state: State;
      try {
        state = JSON.parse(await readFile(file, "utf8"));
        if (
          state.version !== 1 ||
          !Array.isArray(state.channels) ||
          !Array.isArray(state.messages) ||
          !state.retries ||
          typeof state.retries !== "object" ||
          Array.isArray(state.retries) ||
          !state.channels.every(
            (c) =>
              c &&
              typeof c.id === "string" &&
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id) &&
              validateChannel(c).valid,
          ) ||
          new Set(state.channels.map((c) => c.id)).size !==
            state.channels.length ||
          !state.messages.every(
            (m) =>
              m &&
              validatePostMessage(m).valid &&
              validateGetMessages({ before: m.message_id }).valid &&
              typeof m.created_at === "string" &&
              Number.isFinite(Date.parse(m.created_at)) &&
              state.channels.some((c) => c.id === m.channel_id),
          ) ||
          !Object.values(state.retries).every(
            (id) =>
              typeof id === "string" &&
              state.messages.some((m) => m.message_id === id),
          )
        )
          throw new Error("Invalid local storage format");
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        state = { version: 1, channels: [], messages: [], retries: {} };
        if (seed) {
          state.channels = [
            {
              id: "general",
              name: "Geral",
              description: "Boas-vindas e conversas da comunidade",
            },
            {
              id: "projetos",
              name: "Projetos",
              description: "Ideias, código e projetos em andamento",
            },
            {
              id: "design",
              name: "Design",
              description: "Interfaces, referências e experiências",
            },
            {
              id: "aleatorio",
              name: "Aleatorio",
              description: "Um espaço para conversas leves",
            },
          ];
          const samples = [
            [
              "general",
              "Ana",
              "Bem-vindo! Esta conversa é uma demonstração do Mini Discord.",
            ],
            [
              "general",
              "Bruno",
              "Gostei de poder explorar o chat sem configurar um banco primeiro.",
            ],
            [
              "general",
              "Ana",
              "Escolha um canal e envie uma mensagem para experimentar.",
            ],
            [
              "projetos",
              "Lia",
              "Estou montando um portfólio com TypeScript. Alguém tem um projeto para compartilhar?",
            ],
            [
              "projetos",
              "Bruno",
              "Um chat é um bom exercício para aprender persistência e tempo real.",
            ],
            [
              "design",
              "Lia",
              "Separei este espaço para conversar sobre interfaces e acessibilidade.",
            ],
            [
              "aleatorio",
              "Ana",
              "Pausa para um café antes de voltar ao código ☕",
            ],
          ];
          state.messages = samples.map(([channel_id, user_id, content]) => ({
            ...makeMessage({ channel_id, user_id, content }),
            demo: true,
          }));
        }
      }
      const storage = new LocalStorage(file, state);
      await storage.persist(state);
      return storage;
    } catch (error) {
      await unlink(lock);
      throw error;
    }
  }
  private async persist(state: State) {
    const temp = this.file + ".tmp";
    const handle = await open(temp, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, this.file);
    const directory = await open(path.dirname(this.file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private mutate<T>(fn: (state: State) => T): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Storage closed"));
    const op = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const value = fn(next);
      await this.persist(next);
      this.state = next;
      return value;
    });
    this.queue = op.catch(() => {});
    return op;
  }
  async channels() {
    await this.queue;
    return structuredClone(this.state.channels);
  }
  async hasChannel(id: string) {
    await this.queue;
    return this.state.channels.some((c) => c.id === id);
  }
  createChannel(name: string, description: string) {
    return this.mutate((s) => {
      const id = channelSlug(name);
      if (s.channels.some((c) => c.id === id))
        throw new HttpError(
          409,
          "CHANNEL_EXISTS",
          "A channel with this name already exists",
        );
      const channel = { id, name, description };
      s.channels.push(channel);
      return channel;
    });
  }
  post(input: PostMessageRequest) {
    return this.mutate((s) => {
      if (!s.channels.some((c) => c.id === input.channel_id))
        throw new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found");
      const key = JSON.stringify([input.channel_id, input.client_msg_id]);
      const existing = input.client_msg_id && s.retries[key];
      if (existing) {
        const message = s.messages.find((m) => m.message_id === existing)!;
        checkRetry(message, input);
        return { message, deduped: true };
      }
      const message = makeMessage(input);
      s.messages.push(message);
      if (input.client_msg_id) s.retries[key] = message.message_id;
      return { message, deduped: false };
    });
  }
  async history(id: string, limit: number, before?: string, after?: string) {
    await this.queue;
    return structuredClone(
      this.state.messages
        .filter(
          (m) =>
            m.channel_id === id &&
            (!before || compareIds(m.message_id, before) < 0) &&
            (!after || compareIds(m.message_id, after) > 0),
        )
        .sort((a, b) => compareIds(b.message_id, a.message_id))
        .slice(0, limit),
    );
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    await unlink(this.file + ".lock");
  }
}
