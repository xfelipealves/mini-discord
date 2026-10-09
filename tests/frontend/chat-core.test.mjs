import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../../public/chat-core.js", import.meta.url),
  "utf8",
);
const { mergeMessages, draftForSend, matchesSearch } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const message = (id, time, channel = "general", content = "Olá") => ({
  message_id: id,
  created_at: `2026-10-08T12:00:${time}Z`,
  channel_id: channel,
  user_id: "Felipe",
  content,
});
test("Older pagination and live delivery produce chronological unique messages", () => {
  const current = [message("b", "02"), message("c", "03")];
  const merged = mergeMessages(
    current,
    [message("b", "02"), message("a", "01"), message("d", "04")],
    "general",
  );
  assert.deepEqual(
    merged.map((item) => item.message_id),
    ["a", "b", "c", "d"],
  );
  assert.equal(current.length, 2);
});
test("Stale channel events and malformed messages cannot enter a conversation", () => {
  assert.deepEqual(
    mergeMessages([], [message("x", "01", "design"), null, {}], "general"),
    [],
  );
});
test("Retry keeps exact content, identity and idempotency key after ambiguous failure", () => {
  const first = draftForSend(
    { text: "Uma mensagem\ncom linhas" },
    "Visitante",
    "first-id",
  );
  const retry = draftForSend(
    { text: first.content, pending: first },
    "Visitante",
    "second-id",
  );
  assert.equal(retry, first);
  assert.equal(retry.client_msg_id, "first-id");
});
test("Editing a failed message creates a new key rather than reusing an old payload", () => {
  const pending = {
    content: "Original",
    user_id: "Visitante",
    client_msg_id: "old",
  };
  assert.equal(
    draftForSend({ text: "Editada", pending }, "Visitante", "new")
      .client_msg_id,
    "new",
  );
});
test("Loaded-message search includes author and text, ignoring case", () => {
  assert.equal(
    matchesSearch(
      message("a", "01", "general", "Uma ideia sobre design"),
      "DESIGN",
    ),
    true,
  );
  assert.equal(matchesSearch(message("a", "01"), "felipe"), true);
  assert.equal(matchesSearch(message("a", "01"), "ausente"), false);
});

test("Changing profile name does not change an ambiguous retry identity", () => {
  const pending = {
    content: "Original",
    user_id: "Antes",
    client_msg_id: "original-id",
  };
  assert.equal(
    draftForSend({ text: "Original", pending }, "Depois", "new-id"),
    pending,
  );
});

test("TimeUUID rollover within one millisecond preserves server chronology", () => {
  const earlier = message("fffffffe-0000-1001-8000-000000000001", "00.000");
  const later = message("00000000-0001-1001-8000-000000000001", "00.000");
  assert.deepEqual(
    mergeMessages([], [later, earlier], "general").map(
      (item) => item.message_id,
    ),
    [earlier.message_id, later.message_id],
  );
});
