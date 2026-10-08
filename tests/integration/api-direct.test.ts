/** External lab API contract. Requires explicit Scylla, or opt-in local contract-only mode. */
const base = process.env.API_TEST_URL ?? "http://localhost:3000";
const run = `contract-${Date.now()}`;
async function request(method: string, route: string, body?: unknown) {
  const response = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: (await response.json()) as any };
}
describe("External storage contract", () => {
  let channel: string;
  beforeAll(async () => {
    const health = await request("GET", "/health");
    expect(health.status).toBe(200);
    if (process.env.API_TEST_ALLOW_LOCAL !== "1")
      expect(health.data.storage).toBe("scylla");
    const result = await request("POST", "/api/channels", { name: run });
    expect(result.status).toBe(201);
    channel = result.data.channel.id;
  });
  it("retries return the original full message and reject changed payload", async () => {
    const payload = {
      channel_id: channel,
      user_id: "Lab",
      content: "Retry",
      client_msg_id: "same",
    };
    const first = await request("POST", "/api/messages", payload);
    const retry = await request("POST", "/api/messages", payload);
    expect(first.status).toBe(200);
    expect(first.data.deduped).toBe(false);
    expect(retry.status).toBe(200);
    expect(retry.data.deduped).toBe(true);
    expect(retry.data.message).toEqual(first.data.message);
    expect(
      (
        await request("POST", "/api/messages", {
          ...payload,
          content: "Changed",
        })
      ).status,
    ).toBe(409);
  });
  it("accepts supported read/write consistency and rejects explicit invalid levels", async () => {
    for (const consistency of [
      "ONE",
      "QUORUM",
      "ALL",
      "LOCAL_ONE",
      "LOCAL_QUORUM",
    ]) {
      expect(
        (
          await request("POST", "/api/messages", {
            channel_id: channel,
            user_id: "Lab",
            content: consistency,
            consistency,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            "GET",
            `/api/channels/${channel}/messages?consistency=${consistency}`,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await request("POST", "/api/messages", {
          channel_id: channel,
          user_id: "Lab",
          content: "bad",
          consistency: "INVALID",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "GET",
          `/api/channels/${channel}/messages?consistency=ANY`,
        )
      ).status,
    ).toBe(400);
  });
  it("isolates channels and paginates without overlap", async () => {
    const other = await request("POST", "/api/channels", {
      name: `${run}-other`,
    });
    expect(other.status).toBe(201);
    expect(
      (await request("GET", `/api/channels/${other.data.channel.id}/messages`))
        .data.items,
    ).toEqual([]);
    const first = await request(
      "GET",
      `/api/channels/${channel}/messages?limit=3`,
    );
    expect(first.data.items).toHaveLength(3);
    const second = await request(
      "GET",
      `/api/channels/${channel}/messages?limit=3&before=${first.data.page.next_before}`,
    );
    expect(second.data.items).toHaveLength(3);
    expect(second.data.page.next_before).toBeNull();
    const ids = new Set(
      [...first.data.items, ...second.data.items].map((m: any) => m.message_id),
    );
    expect(ids.size).toBe(6);
    for (const page of [first, second])
      expect(page.data.items.every((m: any) => m.channel_id === channel)).toBe(
        true,
      );
  });
});
