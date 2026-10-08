// TimeUUID puts time_low first; compare timestamp fields before node/clock bits.
function chronologicalId(id) {
  const value = String(id).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  )
    ? value.slice(15, 18) +
        value.slice(9, 13) +
        value.slice(0, 8) +
        value.slice(19)
    : value;
}
export function mergeMessages(existing, incoming, channel) {
  const messages = new Map(
    existing.map((message) => [message.message_id, message]),
  );
  for (const message of incoming) {
    if (message && message.message_id && message.channel_id === channel)
      messages.set(message.message_id, message);
  }
  return [...messages.values()].sort(
    (a, b) =>
      new Date(a.created_at) - new Date(b.created_at) ||
      chronologicalId(a.message_id).localeCompare(
        chronologicalId(b.message_id),
      ),
  );
}
export function draftForSend(draft, user, id) {
  if (draft.pending && draft.pending.content === draft.text)
    return draft.pending;
  return { content: draft.text, user_id: user, client_msg_id: id };
}
export function matchesSearch(message, query) {
  return `${message.user_id} ${message.content}`
    .toLocaleLowerCase("pt-BR")
    .includes(query.toLocaleLowerCase("pt-BR"));
}
