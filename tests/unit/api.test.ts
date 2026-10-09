import request from "supertest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as backend from "../../src/index";
import http from "node:http";
let dir: string;
let runtime: any;
async function open() {
  return (backend as any).createApplication({
    storage: "local",
    file: path.join(dir, "chat.json"),
    seed: false,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mini-chat-"));
  runtime = await open();
});
afterEach(async () => {
  await runtime.close();
  await rm(dir, { recursive: true, force: true });
});
async function channel(name = "Sala") {
  const r = await request(runtime.app)
    .post("/api/channels")
    .send({ name, description: " Conversa " });
  expect(r.status).toBe(201);
  return r.body.channel.id;
}
async function post(id: string, content = "olá", retry?: string) {
  return request(runtime.app)
    .post("/api/messages")
    .send({ channel_id: id, user_id: "Ana", content, client_msg_id: retry });
}
test("health and same-origin public assets work without Scylla", async () => {
  expect((await request(runtime.app).get("/health")).body).toMatchObject({
    ok: true,
    storage: "local",
  });
  expect((await request(runtime.app).get("/")).status).toBe(200);
});
test("creates and validates channels", async () => {
  const id = await channel();
  expect((await request(runtime.app).get("/api/channels")).body.items).toEqual([
    { id, name: "Sala", description: "Conversa" },
  ]);
  expect(
    (await request(runtime.app).post("/api/channels").send({ name: " sala " }))
      .status,
  ).toBe(409);
  for (const input of [
    null,
    [],
    { name: " " },
    { name: "a".repeat(61) },
    { name: "ok", description: 4 },
  ])
    expect(
      (
        await request(runtime.app)
          .post("/api/channels")
          .send(JSON.stringify(input))
          .set("Content-Type", "application/json")
      ).status,
    ).toBe(400);
});
test("HTTP malformed JSON, invalid inputs, missing channels and routes are structured errors", async () => {
  expect(
    (
      await request(runtime.app)
        .post("/api/messages")
        .set("Content-Type", "application/json")
        .send("{")
    ).body.error.code,
  ).toBe("BAD_REQUEST");
  for (const input of [
    null,
    [],
    { channel_id: "x", user_id: " ", content: "hi" },
    { channel_id: "x", user_id: "Ana", content: "hi", consistency: null },
  ]) {
    const r = await request(runtime.app)
      .post("/api/messages")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(input));
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  }
  expect((await post("missing")).status).toBe(404);
  expect((await request(runtime.app).get("/api/nope")).status).toBe(404);
});
test("isolates channels and paginates TimeUUID history without overlap", async () => {
  const a = await channel("Um"),
    b = await channel("Dois");
  const ids = [];
  for (const text of ["primeira", "segunda", "terceira"])
    ids.push((await post(a, text)).body.message_id);
  await post(b, "outro");
  const first = await request(runtime.app).get(
    `/api/channels/${a}/messages?limit=2`,
  );
  expect(first.body.items.map((m: any) => m.content)).toEqual([
    "terceira",
    "segunda",
  ]);
  const second = await request(runtime.app).get(
    `/api/channels/${a}/messages?limit=2&before=${first.body.page.next_before}`,
  );
  expect(second.body.items.map((m: any) => m.content)).toEqual(["primeira"]);
  expect(second.body.page.next_before).toBeNull();
  expect(
    (
      await request(runtime.app).get(
        `/api/channels/${a}/messages?after=${ids[1]}`,
      )
    ).body.items.map((m: any) => m.content),
  ).toEqual(["terceira"]);
  for (const q of [
    "limit=2x",
    "limit=0",
    "before=550e8400-e29b-41d4-a716-446655440000",
    "limit=2&limit=3",
    "consistency=ANY",
  ])
    expect(
      (await request(runtime.app).get(`/api/channels/${a}/messages?${q}`))
        .status,
    ).toBe(400);
});
test("concurrent retries produce one durable message and detect changed payload", async () => {
  const id = await channel();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => post(id, "mensagem", "retry-1")),
  );
  expect(new Set(results.map((r) => r.body.message_id)).size).toBe(1);
  expect(results.filter((r) => r.body.deduped === false)).toHaveLength(1);
  expect((await post(id, "mudou", "retry-1")).status).toBe(409);
  await runtime.close();
  runtime = await open();
  expect((await post(id, "mensagem", "retry-1")).body.deduped).toBe(true);
  expect(
    (await request(runtime.app).get(`/api/channels/${id}/messages`)).body.items,
  ).toHaveLength(1);
});
test("seeds demo once across restarts", async () => {
  await runtime.close();
  runtime = await (backend as any).createApplication({
    storage: "local",
    file: path.join(dir, "seed.json"),
  });
  const before = (
    await request(runtime.app).get("/api/channels/general/messages")
  ).body.items;
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((m: any) => m.demo === true)).toBe(true);
  await runtime.close();
  runtime = await (backend as any).createApplication({
    storage: "local",
    file: path.join(dir, "seed.json"),
  });
  expect(
    (await request(runtime.app).get("/api/channels/general/messages")).body
      .items,
  ).toEqual(before);
});
test("fails safely for corrupt storage and concurrent writers", async () => {
  await expect(open()).rejects.toThrow(/already|lock/i);
  await runtime.close();
  await writeFile(path.join(dir, "chat.json"), "broken");
  await expect(open()).rejects.toThrow();
});
test("SSE emits full messages and channels once after persistence", async () => {
  const server = runtime.app.listen(0);
  const chunks: string[] = [];
  const port = (server.address() as any).port;
  let response: http.IncomingMessage | undefined;
  const stream = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
    response = res;
    res.on("data", (chunk) => chunks.push(chunk.toString()));
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const id = await channel();
    const r = await post(id, "ao vivo", "event-1");
    await post(id, "ao vivo", "event-1");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const all = chunks.join("");
    expect(all).toContain("event: channel");
    expect(all).toContain("event: message");
    expect(all).toContain(r.body.message_id);
    expect(all.match(/event: message/g)).toHaveLength(1);
  } finally {
    stream.destroy();
    response?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("rejects oversized JSON with structured 413", async () => {
  const r = await request(runtime.app)
    .post("/api/messages")
    .send({ content: "x".repeat(2000000) });
  expect(r.status).toBe(413);
  expect(r.body.error.code).toBe("PAYLOAD_TOO_LARGE");
});
test("rejects malformed persisted records rather than resetting data", async () => {
  await runtime.close();
  await writeFile(
    path.join(dir, "chat.json"),
    JSON.stringify({ version: 1, channels: [{}], messages: [], retries: {} }),
  );
  await expect(open()).rejects.toThrow(/format/);
});
test("rejects invalid configured consistency before opening storage", async () => {
  const original = process.env.DEFAULT_READ_CONSISTENCY;
  process.env.DEFAULT_READ_CONSISTENCY = "ANY";
  try {
    await expect(
      (backend as any).createApplication({
        storage: "local",
        file: path.join(dir, "invalid.json"),
      }),
    ).rejects.toThrow(/consistency/i);
  } finally {
    if (original === undefined) delete process.env.DEFAULT_READ_CONSISTENCY;
    else process.env.DEFAULT_READ_CONSISTENCY = original;
  }
});
