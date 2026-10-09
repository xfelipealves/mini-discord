import { Client, types } from "cassandra-driver";
import {
  Storage,
  HttpError,
  channelSlug,
  makeMessage,
  checkRetry,
} from "./storage";
import { Channel, Message, PostMessageRequest } from "./types";
export class ScyllaStorage implements Storage {
  private constructor(
    private client: Client,
    public info: { storage: "scylla"; dc: string; keyspace: string },
  ) {}
  static async create() {
    const dc = process.env.SCYLLA_DATACENTER ?? "datacenter1";
    const keyspace = process.env.SCYLLA_KEYSPACE ?? "chat";
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(keyspace))
      throw new Error("Invalid SCYLLA_KEYSPACE");
    const client = new Client({
      contactPoints: (process.env.SCYLLA_CONTACT_POINTS ?? "127.0.0.1")
        .split(",")
        .map((s) => s.trim()),
      localDataCenter: dc,
      keyspace,
    });
    try {
      await client.connect();
      await client.execute(
        "CREATE TABLE IF NOT EXISTS channels (id text PRIMARY KEY, name text, description text)",
      );
      // Store the chosen message in the LWT record: a retry can finish an interrupted insert.
      await client.execute(
        "CREATE TABLE IF NOT EXISTS message_retries (channel_id text, client_msg_id text, payload text, PRIMARY KEY ((channel_id), client_msg_id))",
      );
      for (const [id, name] of [
        ["general", "Geral"],
        ["projetos", "Projetos"],
        ["design", "Design"],
        ["aleatorio", "Aleatorio"],
      ])
        await client.execute(
          "INSERT INTO channels (id,name,description) VALUES (?,?,?) IF NOT EXISTS",
          [id, name, "Canal da comunidade"],
          { prepare: true },
        );
      return new ScyllaStorage(client, { storage: "scylla", dc, keyspace });
    } catch (error) {
      await client.shutdown();
      throw error;
    }
  }
  async channels() {
    const result = await this.client.execute(
      "SELECT id,name,description FROM channels",
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
    }));
  }
  async hasChannel(id: string) {
    const result = await this.client.execute(
      "SELECT id FROM channels WHERE id=?",
      [id],
      { prepare: true },
    );
    return !!result.rowLength;
  }
  async createChannel(name: string, description: string): Promise<Channel> {
    const id = channelSlug(name);
    const result = await this.client.execute(
      "INSERT INTO channels (id,name,description) VALUES (?,?,?) IF NOT EXISTS",
      [id, name, description],
      {
        prepare: true,
        consistency: types.consistencies.localQuorum,
        serialConsistency: types.consistencies.localSerial,
      },
    );
    if (!result.first()["[applied]"])
      throw new HttpError(
        409,
        "CHANNEL_EXISTS",
        "A channel with this name already exists",
      );
    return { id, name, description };
  }
  async post(input: PostMessageRequest, consistency: number) {
    if (!(await this.hasChannel(input.channel_id)))
      throw new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found");
    let message = makeMessage(input);
    let deduped = false;
    if (input.client_msg_id) {
      const result = await this.client.execute(
        "INSERT INTO message_retries (channel_id,client_msg_id,payload) VALUES (?,?,?) IF NOT EXISTS",
        [input.channel_id, input.client_msg_id, JSON.stringify(message)],
        {
          prepare: true,
          consistency: types.consistencies.localQuorum,
          serialConsistency: types.consistencies.localSerial,
        },
      );
      if (!result.first()["[applied]"]) {
        message = JSON.parse(result.first().payload);
        checkRetry(message, input);
        deduped = true;
      }
    }
    // The same primary key makes recovery/retry safe even after ambiguous write failures.
    await this.client.execute(
      "INSERT INTO messages (channel_id,message_id,user_id,content,created_at) VALUES (?,?,?,?,?)",
      [
        message.channel_id,
        types.TimeUuid.fromString(message.message_id),
        message.user_id,
        message.content,
        new Date(message.created_at),
      ],
      { prepare: true, consistency },
    );
    return { message, deduped };
  }
  async history(
    id: string,
    limit: number,
    before?: string,
    after?: string,
    consistency = types.consistencies.one,
  ): Promise<Message[]> {
    const cursor = before ?? after;
    const clause = cursor ? ` AND message_id ${before ? "<" : ">"} ?` : "";
    const params: unknown[] = [id];
    if (cursor) params.push(types.TimeUuid.fromString(cursor));
    params.push(limit);
    const result = await this.client.execute(
      `SELECT channel_id,message_id,user_id,content,created_at FROM messages WHERE channel_id=?${clause} LIMIT ?`,
      params,
      { prepare: true, consistency },
    );
    return result.rows.map((row) => ({
      channel_id: row.channel_id,
      message_id: row.message_id.toString(),
      user_id: row.user_id,
      content: row.content,
      created_at: row.created_at.toISOString(),
    }));
  }
  async close() {
    await this.client.shutdown();
  }
}
