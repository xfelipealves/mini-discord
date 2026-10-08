import { mergeMessages, draftForSend, matchesSearch } from "./chat-core.js";
const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`md:${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`md:${key}`, JSON.stringify(value));
    } catch {}
  },
};
const state = {
  channels: [],
  channel: null,
  messages: [],
  cursor: null,
  generation: 0,
  loading: false,
  sending: new Set(),
  drafts: store.get("drafts", {}),
  name: store.get("name", "Visitante"),
  events: null,
  recovering: false,
  historyFailed: false,
};
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function initials(name) {
  return (
    String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}
async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("O servidor retornou uma resposta inesperada.");
  }
  if (!response.ok || !result.ok)
    throw new Error(
      result.error?.message ||
        result.error ||
        "Não foi possível concluir a solicitação.",
    );
  return result;
}
function draft(channel = state.channel) {
  return state.drafts[channel] || { text: "" };
}
function saveDraft() {
  if (!state.channel) return;
  const previous = draft();
  state.drafts[state.channel] = { ...previous, text: $("composer").value };
  store.set("drafts", state.drafts);
  updateComposer();
}
function updateComposer() {
  const sending = state.sending.has(state.channel);
  $("send").disabled = sending || !$("composer").value.trim() || !state.channel;
  $("composer").disabled = sending || !state.channel;
  $("send").querySelector("span").textContent = sending
    ? "Enviando…"
    : "Enviar";
  $("send").setAttribute(
    "aria-label",
    sending ? "Enviando mensagem" : "Enviar mensagem",
  );
  $("composer").style.height = "auto";
  $("composer").style.height = `${Math.min($("composer").scrollHeight, 130)}px`;
}
function updateProfile() {
  $("profile-name").textContent = state.name;
  $("profile-avatar").textContent = initials(state.name);
}
function setNav(open) {
  document.querySelector(".app").classList.toggle("nav-visible", open);
  $("drawer-backdrop").hidden = !open;
  $("nav-open").setAttribute("aria-expanded", String(open));
  document.querySelector(".conversation").inert = open;
  $("details").inert = open;
  $("sidebar").inert = !open && matchMedia("(max-width:760px)").matches;
  if (open) $("nav-close").focus();
  else if (matchMedia("(max-width:760px)").matches) $("nav-open").focus();
}
function renderChannels() {
  $("channels").replaceChildren();
  for (const channel of state.channels) {
    const button = node("button", "channel-list-button");
    button.append(node("span", "hash", "#"), node("span", "", channel.name));
    button.setAttribute(
      "aria-current",
      channel.id === state.channel ? "page" : "false",
    );
    button.addEventListener("click", () => {
      selectChannel(channel.id);
      if (matchMedia("(max-width:760px)").matches) setNav(false);
    });
    $("channels").append(button);
  }
}
async function loadChannels() {
  try {
    const result = await api("/api/channels");
    state.channels = result.items;
    renderChannels();
    if (!state.channel && state.channels.length)
      await selectChannel(state.channels[0].id);
    if (!state.channels.length)
      $("channels").append(
        node(
          "p",
          "sidebar-note",
          "Nenhum canal ainda. Use + para criar o primeiro.",
        ),
      );
    return true;
  } catch {
    $("channels").replaceChildren(
      node("p", "sidebar-note", "Não foi possível carregar os canais."),
    );
    const retry = node("button", "channel-list-button", "Tentar novamente");
    retry.onclick = loadChannels;
    $("channels").append(retry);
    $("history-status").textContent =
      "Escolha um canal assim que a conexão voltar.";
    return false;
  }
}
async function selectChannel(id) {
  if (state.channel === id) return;
  const channel = state.channels.find((item) => item.id === id);
  if (!channel) return;
  state.channel = id;
  state.generation++;
  state.messages = [];
  state.cursor = null;
  state.loading = false;
  state.historyFailed = false;
  for (const key of ["channel-title", "detail-title"])
    $(key).textContent = channel.name;
  for (const key of [
    "channel-subtitle",
    "detail-description",
    "intro-description",
  ])
    $(key).textContent =
      channel.description || "Um espaço para conversar sobre este assunto.";
  $("intro-title").textContent = `Bem-vindo ao #${channel.name}`;
  $("composer").placeholder = `Conversar em #${channel.name}`;
  $("composer").value = draft().text || "";
  $("search").value = "";
  $("send-status").hidden = !draft().pending;
  if (draft().pending)
    $("send-status").textContent = state.sending.has(id)
      ? "Mensagem em envio…"
      : "Há uma mensagem não confirmada neste canal. Seu texto está preservado; envie novamente para tentar com segurança.";
  renderChannels();
  renderMessages();
  updateComposer();
  await loadHistory();
}
function messageURL(channel, cursor) {
  return `/api/channels/${encodeURIComponent(channel)}/messages?limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`;
}
async function loadHistory(older = false) {
  if (!state.channel || state.loading) return;
  const channel = state.channel,
    generation = state.generation,
    height = $("timeline").scrollHeight,
    top = $("timeline").scrollTop;
  state.loading = true;
  state.historyFailed = false;
  $("history-status").textContent = older
    ? "Carregando mensagens anteriores…"
    : "Carregando conversa…";
  $("history-status").hidden = false;
  $("older").disabled = true;
  $("history-retry").hidden = true;
  try {
    const result = await api(messageURL(channel, older ? state.cursor : null));
    if (generation !== state.generation) return;
    state.messages = mergeMessages(state.messages, result.items, channel);
    state.cursor = result.page?.next_before || null;
    renderMessages();
    if (older)
      $("timeline").scrollTop = top + $("timeline").scrollHeight - height;
    else scrollBottom();
  } catch {
    if (generation !== state.generation) return;
    state.historyFailed = true;
    $("history-status").textContent =
      "Não foi possível carregar a conversa. Tente novamente.";
    $("history-status").hidden = false;
    $("history-retry").hidden = false;
  } finally {
    if (generation === state.generation) {
      state.loading = false;
      $("older").disabled = false;
      $("older").hidden = !state.cursor;
    }
  }
}
function scrollBottom() {
  $("timeline").scrollTop = $("timeline").scrollHeight;
}
function renderMessages() {
  const query = $("search").value.trim(),
    visible = state.messages.filter((message) => matchesSearch(message, query));
  $("messages").replaceChildren();
  let lastDate = "";
  for (const message of visible) {
    const date = new Date(message.created_at),
      validDate = !Number.isNaN(date.getTime());
    const day = validDate
      ? date.toLocaleDateString("pt-BR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "Data não disponível";
    if (day !== lastDate) {
      $("messages").append(node("div", "date-divider", day));
      lastDate = day;
    }
    const article = node("article", "message"),
      avatar = node("span", "avatar", initials(message.user_id));
    avatar.setAttribute("aria-hidden", "true");
    const body = node("div", "message-body"),
      heading = node("div", "message-heading"),
      time = node(
        "time",
        "",
        validDate
          ? date.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
      );
    if (validDate) {
      time.dateTime = date.toISOString();
      time.title = date.toLocaleString("pt-BR");
    }
    heading.append(node("span", "message-author", message.user_id), time);
    body.append(heading, node("p", "message-content", message.content));
    article.append(avatar, body);
    $("messages").append(article);
  }
  $("history-status").textContent = query
    ? visible.length
      ? `${visible.length} resultado(s) nas mensagens carregadas.`
      : "Nenhum resultado nas mensagens carregadas. Carregue mensagens anteriores para ampliar a busca."
    : "Ainda não há mensagens. Comece esta conversa!";
  $("history-status").hidden = !query && !!state.messages.length;
  $("search-scope").textContent =
    `Somente ${state.messages.length} ${state.messages.length === 1 ? "mensagem carregada" : "mensagens carregadas"}`;
  $("older").hidden = !state.cursor;
  $("history-retry").hidden = !state.historyFailed;
  $("participants").replaceChildren();
  for (const name of [
    ...new Set(state.messages.map((message) => message.user_id)),
  ]) {
    const participant = node("li");
    participant.append(
      node("span", "avatar", initials(name)),
      node("span", "", name),
    );
    $("participants").append(participant);
  }
  if (!state.messages.length)
    $("participants").append(
      node("li", "", "Nenhum perfil nesta conversa ainda."),
    );
}
async function sendMessage(event) {
  event.preventDefault();
  const channel = state.channel;
  if (!channel || state.sending.has(channel) || !$("composer").value.trim())
    return;
  saveDraft();
  const pending = draftForSend(draft(channel), state.name, uid());
  state.drafts[channel] = { ...draft(channel), pending };
  store.set("drafts", state.drafts);
  state.sending.add(channel);
  updateComposer();
  $("send-status").hidden = true;
  try {
    const result = await api("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pending, channel_id: channel }),
    });
    state.drafts[channel] = { text: "" };
    store.set("drafts", state.drafts);
    if (channel === state.channel) {
      $("composer").value = "";
      if (result.message) {
        state.messages = mergeMessages(
          state.messages,
          [result.message],
          channel,
        );
        renderMessages();
        scrollBottom();
      } else {
        try {
          await recoverHistory();
        } catch {
          $("send-status").textContent =
            "Mensagem confirmada. Não foi possível atualizar o histórico; reconecte para recuperá-la.";
          $("send-status").hidden = false;
        }
      }
    }
  } catch (error) {
    if (channel === state.channel) {
      $("send-status").textContent =
        `Mensagem não confirmada. ${error.message} Seu texto foi preservado; envie novamente para tentar com segurança.`;
      $("send-status").hidden = false;
    }
  } finally {
    state.sending.delete(channel);
    updateComposer();
    if (channel === state.channel) $("composer").focus();
  }
}
// Fetch backwards from latest until a known message is reached: recovers gaps larger than one page without relying on an undocumented after cursor.
async function recoverHistory() {
  const channel = state.channel,
    generation = state.generation;
  if (!channel) return;
  const known = new Set(state.messages.map((message) => message.message_id));
  let cursor = null,
    incoming = [],
    oldestCursor = null;
  const visited = new Set();
  do {
    const result = await api(messageURL(channel, cursor));
    if (generation !== state.generation) return;
    incoming.push(...result.items);
    oldestCursor = result.page?.next_before || null;
    if (
      result.items.some((message) => known.has(message.message_id)) ||
      !oldestCursor ||
      !result.items.length ||
      visited.has(oldestCursor)
    )
      break;
    visited.add(oldestCursor);
    cursor = oldestCursor;
  } while (true);
  if (generation !== state.generation) return;
  const nearBottom =
    $("timeline").scrollHeight -
      $("timeline").scrollTop -
      $("timeline").clientHeight <
    100;
  const previousTop = $("timeline").scrollTop;
  state.messages = mergeMessages(state.messages, incoming, channel);
  if (!known.size) state.cursor = oldestCursor;
  state.historyFailed = false;
  renderMessages();
  if (nearBottom) scrollBottom();
  else $("timeline").scrollTop = previousTop;
}
function connection(text, retry = false) {
  $("connection-status").textContent = text;
  $("connection-retry").hidden = !retry;
}
function connect() {
  state.events?.close();
  connection("Conectando às atualizações…");
  if (!globalThis.EventSource) {
    connection("Este navegador não suporta atualizações ao vivo.", true);
    return;
  }
  const events = new EventSource("/api/events");
  state.events = events;
  events.addEventListener("open", async () => {
    if (state.events !== events) return;
    connection("Sincronizando conversa…");
    try {
      if (!(await loadChannels())) throw new Error("Canais indisponíveis");
      await recoverHistory();
      if (state.events === events && events.readyState === EventSource.OPEN)
        connection("Atualizações em tempo real");
    } catch {
      if (state.events === events)
        connection(
          "Conexão aberta. Falha ao recuperar histórico; tente reconectar.",
          true,
        );
    }
  });
  events.addEventListener("error", () => {
    if (state.events === events)
      connection("Conexão interrompida. Reconectando automaticamente…", true);
  });
  events.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.channel_id !== state.channel) return;
      const nearBottom =
        $("timeline").scrollHeight -
          $("timeline").scrollTop -
          $("timeline").clientHeight <
        100;
      state.messages = mergeMessages(state.messages, [message], state.channel);
      renderMessages();
      if (nearBottom) scrollBottom();
    } catch {
      connection(
        "Uma atualização não pôde ser lida. Reconecte para recuperar.",
        true,
      );
    }
  });
  events.addEventListener("channel", (event) => {
    try {
      const channel = JSON.parse(event.data);
      if (!channel.id) return;
      const index = state.channels.findIndex((item) => item.id === channel.id);
      if (index < 0) state.channels.push(channel);
      else state.channels[index] = channel;
      renderChannels();
    } catch {
      loadChannels();
    }
  });
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog
    .querySelectorAll("[data-close]")
    .forEach((button) => (button.onclick = () => dialog.close()));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
}
$("profile-open").onclick = () => {
  $("display-name").value = state.name;
  $("profile-dialog").showModal();
  $("display-name").focus();
};
$("profile-form").onsubmit = (event) => {
  event.preventDefault();
  const name = $("display-name").value.trim();
  if (!name) {
    $("display-name").setCustomValidity("Digite um nome.");
    $("display-name").reportValidity();
    return;
  }
  state.name = name;
  store.set("name", name);
  updateProfile();
  $("profile-dialog").close();
};
$("display-name").oninput = () => $("display-name").setCustomValidity("");
$("channel-open").onclick = () => {
  $("channel-error").textContent = "";
  $("channel-dialog").showModal();
  $("channel-name").focus();
};
$("channel-form").onsubmit = async (event) => {
  event.preventDefault();
  const name = $("channel-name").value.trim();
  if (!name) return;
  $("channel-submit").disabled = true;
  $("channel-error").textContent = "";
  try {
    const result = await api("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: $("channel-description").value.trim(),
      }),
    });
    if (!state.channels.some((channel) => channel.id === result.channel.id))
      state.channels.push(result.channel);
    $("channel-dialog").close();
    $("channel-form").reset();
    await selectChannel(result.channel.id);
    if (matchMedia("(max-width:760px)").matches) setNav(false);
    $("composer").focus();
  } catch (error) {
    $("channel-error").textContent = error.message;
  } finally {
    $("channel-submit").disabled = false;
  }
};
function showAbout() {
  $("about-dialog").showModal();
  api("/health")
    .then((result) => {
      $("storage-info").textContent =
        result.storage === "scylla"
          ? `ScyllaDB${result.dc ? ` · ${result.dc}` : ""}`
          : "Persistência local no servidor";
    })
    .catch(() => {
      $("storage-info").textContent = "Não foi possível consultar o servidor.";
    });
}
$("about-open").onclick = showAbout;
$("about-details").onclick = showAbout;
$("nav-open").onclick = () => setNav(true);
$("nav-close").onclick = () => setNav(false);
$("drawer-backdrop").onclick = () => setNav(false);
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Tab" &&
    document.querySelector(".app").classList.contains("nav-visible") &&
    !document.querySelector("dialog[open]")
  ) {
    const elements = [
      ...$("sidebar").querySelectorAll("button:not(:disabled),a[href],input"),
    ].filter((element) => element.getClientRects().length);
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (
    event.key === "Escape" &&
    document.querySelector(".app").classList.contains("nav-visible")
  )
    setNav(false);
});
$("details-toggle").onclick = () => {
  const app = document.querySelector(".app");
  const wide = matchMedia("(min-width:1181px)").matches;
  if (wide) app.classList.toggle("details-hidden");
  else app.classList.toggle("details-visible");
  const expanded = wide
    ? !app.classList.contains("details-hidden")
    : app.classList.contains("details-visible");
  $("details-toggle").setAttribute("aria-expanded", String(expanded));
  $("details-toggle").setAttribute(
    "aria-label",
    expanded ? "Ocultar contexto do canal" : "Mostrar contexto do canal",
  );
};
const detailQuery = matchMedia("(min-width:1181px)");
function syncDetails() {
  const app = document.querySelector(".app");
  const expanded = detailQuery.matches
    ? !app.classList.contains("details-hidden")
    : app.classList.contains("details-visible");
  $("details-toggle").setAttribute("aria-expanded", String(expanded));
  $("details-toggle").setAttribute(
    "aria-label",
    expanded ? "Ocultar contexto do canal" : "Mostrar contexto do canal",
  );
}
detailQuery.addEventListener("change", syncDetails);
syncDetails();
$("composer").addEventListener("input", saveDraft);
$("composer").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("message-form").requestSubmit();
  }
});
$("message-form").onsubmit = sendMessage;
$("older").onclick = () => loadHistory(true);
$("history-retry").onclick = () => loadHistory(!!state.cursor);
$("search").oninput = renderMessages;
$("connection-retry").onclick = connect;
// Keep the composer above an on-screen keyboard on browsers exposing VisualViewport.
if (globalThis.visualViewport) {
  const resize = () => {
    document.querySelector(".app").style.height = `${visualViewport.height}px`;
  };
  visualViewport.addEventListener("resize", resize);
  resize();
}
const mobileQuery = matchMedia("(max-width:760px)");
const syncNavigation = () => {
  if (!mobileQuery.matches) {
    document.querySelector(".app").classList.remove("nav-visible");
    $("drawer-backdrop").hidden = true;
    document.querySelector(".conversation").inert = false;
    $("details").inert = false;
  }
  $("sidebar").inert =
    mobileQuery.matches &&
    !document.querySelector(".app").classList.contains("nav-visible");
};
mobileQuery.addEventListener("change", syncNavigation);
syncNavigation();
updateProfile();
updateComposer();
await loadChannels();
connect();
