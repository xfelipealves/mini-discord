/** Small external lab load; timings are observations, not production benchmarks. */
describe("External concurrent retry lab", () => {
  const base = process.env.API_TEST_URL ?? "http://localhost:3000";
  it("persists one message for twelve concurrent retries", async () => {
    const health = (await (await fetch(base + "/health")).json()) as any;
    if (process.env.API_TEST_ALLOW_LOCAL !== "1")
      expect(health.storage).toBe("scylla");
    const created = await fetch(base + "/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `load-${Date.now()}` }),
    });
    expect(created.status).toBe(201);
    const channel = ((await created.json()) as any).channel.id;
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 12 }, async () => {
        const r = await fetch(base + "/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel_id: channel,
            user_id: "Lab",
            content: "Concurrent retry",
            client_msg_id: "same",
          }),
          signal: AbortSignal.timeout(15000),
        });
        expect(r.status).toBe(200);
        return (await r.json()) as any;
      }),
    );
    expect(new Set(results.map((r) => r.message_id)).size).toBe(1);
    expect(results.filter((r) => !r.deduped)).toHaveLength(1);
    const history = (await (
      await fetch(`${base}/api/channels/${channel}/messages`)
    ).json()) as any;
    expect(history.items).toHaveLength(1);
    console.log(
      `12 retries: ${Math.round(performance.now() - start)}ms; storage=${health.storage}`,
    );
  });
});
