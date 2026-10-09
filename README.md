# Mini Discord

Um chat de portfólio por Felipe Alves: canais, conversas persistentes e atualizações em tempo real, com TypeScript e uma interface responsiva em português. Funciona imediatamente com armazenamento local; o modo ScyllaDB preserva o objetivo educacional do projeto.

![Interface real do Mini Discord](docs/screenshots/desktop.png)

## Começar

Requer Node.js 20+ e npm. Após clonar e instalar com `npm ci`, um único comando inicia a interface e a API:

```sh
npm run dev
```

Abra **http://localhost:3000**. Não é necessário banco, servidor separado para o frontend ou arquivo `.env`. A primeira execução cria `data/chat.json` com quatro canais e sete mensagens marcadas como demonstrativas. As mensagens novas são reais e compartilhadas por todos que acessam esse servidor.

Se a porta estiver ocupada, escolha outra sem encerrar serviços existentes:

```sh
API_PORT=4318 npm run dev
```

## O que funciona

- Criar e trocar canais, enviar com Enter e inserir linhas com Shift + Enter.
- Histórico com páginas de 50 mensagens, apresentado do mais antigo para o mais recente.
- Eventos SSE de canais e mensagens, reconexão automática e recuperação de mensagens perdidas, inclusive além de uma página.
- Repetir um envio não confirmado com a mesma identidade, evitando duplicatas.
- Nome de exibição e rascunhos por canal salvos no navegador.
- Busca por texto ou autor **apenas nas mensagens carregadas**; carregar páginas anteriores amplia o alcance.
- Drawer móvel, diálogos nativos, estados de erro/repetição, foco visível e conteúdo de usuário renderizado como texto.

Os autores listados no contexto são perfis encontrados no histórico, sem indicar presença online. O nome de exibição é livre e não representa autenticação. Não há voz, anexos ou login.

<details>
<summary>Captura móvel real (390 × 844)</summary>

![Interface móvel](docs/screenshots/mobile.png)

</details>

## Arquitetura

```text
Navegador: HTML + CSS + módulos JavaScript
  ├─ fetch da mesma origem → Express → validação → Storage
  └─ EventSource /api/events ← eventos após persistência
                                               ├─ LocalStorage: JSON no disco
                                               └─ ScyllaStorage: CQL preparado + LWT
```

`src/index.ts` serve os assets de `public/` e a API no mesmo processo. `src/validators.ts` valida payloads, limites, cursores e consistência. `src/storage.ts` serializa alterações locais, grava um arquivo temporário com fsync e troca atômica, além de impedir dois escritores vivos no mesmo arquivo. `src/scylla-storage.ts` implementa o mesmo contrato usando o driver Cassandra. `public/chat-core.js` centraliza merge, ordenação TimeUUID, busca e identidade de retries; `public/app.js` coordena os fluxos da interface. `src/db.ts` mantém helpers CQL educacionais históricos; a API atual usa os adapters Storage.

## Configuração e persistência

A aplicação carrega `.env` automaticamente quando existir; `.env.example` contém as opções. Variáveis exportadas pelo processo têm prioridade.

| Variável                    | Padrão             | Uso                                          |
| --------------------------- | ------------------ | -------------------------------------------- |
| `API_PORT`                  | `3000`             | Porta HTTP da interface/API                  |
| `STORAGE_MODE`              | `local`            | `local` ou `scylla` explícito                |
| `LOCAL_DATA_FILE`           | `./data/chat.json` | Caminho do JSON local                        |
| `REQUEST_BODY_LIMIT`        | `32kb`             | Limite do corpo HTTP                         |
| `SCYLLA_CONTACT_POINTS`     | `127.0.0.1`        | Hosts separados por vírgula                  |
| `SCYLLA_DATACENTER`         | `datacenter1`      | Datacenter do driver                         |
| `SCYLLA_KEYSPACE`           | `chat`             | Keyspace previamente inicializado            |
| `DEFAULT_WRITE_CONSISTENCY` | `ONE`              | Consistência padrão de escrita               |
| `DEFAULT_READ_CONSISTENCY`  | `ONE`              | Consistência padrão de leitura               |
| `CORS_ORIGIN`               | ausente            | Origem extra opcional; desnecessária na demo |

O JSON e os registros de retry sobrevivem a reloads e reinícios do servidor; nome e rascunhos dependem do localStorage daquele navegador/origem. Uma nova origem/porta tem seu próprio perfil. Não remova arquivos `.lock`/`.recovery` enquanto houver escritores: uma recuperação incerta falha de forma segura e requer inspeção. JSON inválido causa falha de startup, sem apagar dados silenciosamente.

Para servir o build:

```sh
npm ci
npm run build
npm start
```

Execute a partir da raiz do projeto e distribua `dist/`, `public/`, `package.json`, lockfile e dependências de runtime. Para uma demo hospedada, configure `LOCAL_DATA_FILE` em volume persistente, rode **uma única instância**, e coloque TLS/reverse proxy à frente. O proxy deve permitir SSE duradouro, desabilitar buffering em `/api/events` e permitir reconexões. Encerrar com SIGINT/SIGTERM libera o lock. Não há Dockerfile novo; os arquivos Compose existentes fornecem apenas o laboratório Scylla.

## Laboratório ScyllaDB

O modo local não simula replicação, quórum nem LWT. Para exercitar CQL de verdade, inicialize o serviço com Docker Compose:

```sh
docker compose up -d
# Aguarde o scylla saudável e scylla-init terminar sem erro.
docker compose logs scylla-init
STORAGE_MODE=scylla npm run dev
```

O schema `docker/init-schema.cql` cria o keyspace `chat` e `messages`. O adapter adiciona `channels` e `message_retries` e registra os canais padrão, sem popular mensagens demonstrativas. Dados locais não são migrados automaticamente. Em `docker-compose.cluster.yml`, os schemas usam NetworkTopologyStrategy/RF=3 para explorar replicação; confira os datacenters e contact points antes de conectar. Essas imagens/configurações são um laboratório histórico, não uma recomendação de operação em produção.

Conceitos preservados:

- **Partition key:** `PRIMARY KEY ((channel_id), message_id)` agrupa o histórico de um canal.
- **Clustering:** `message_id timeuuid` com ordem DESC permite buscar mensagens recentes e páginas por cursor. A UI inverte a apresentação; campos de timestamp do TimeUUID resolvem empates no mesmo milissegundo.
- **LWT:** `INSERT ... IF NOT EXISTS` em `message_retries` escolhe e salva o payload completo para `(channel_id, client_msg_id)`. Uma repetição pode completar uma escrita interrompida no mesmo primary key.
- **Consistência:** ONE, TWO, THREE, QUORUM, ALL, LOCAL_ONE, LOCAL_QUORUM e ANY (somente escrita). Níveis explícitos inválidos retornam 400; configuração padrão inválida impede startup. O retry LWT usa LOCAL_QUORUM/LOCAL_SERIAL independentemente da consistência da inserção de mensagem.
- **RF e datacenter:** SimpleStrategy/RF=1 no laboratório simples; NetworkTopologyStrategy/RF=3 nos exemplos de cluster. Quórum não é uma promessa de desempenho, e um teste com JSON não comprova comportamento distribuído.

`message_dedupe` nos schemas antigos pertence aos helpers educacionais; a API usa `message_retries` com payload recuperável. Não foi executado teste com ScyllaDB vivo nesta entrega.

## API básica

Todas as respostas JSON usam `ok`; erros têm `error: { code, message }` e status HTTP apropriado.

| Método e rota                    | Contrato                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Modo de storage, datacenter e keyspace; não autentica usuários                                                      |
| `GET /api/channels`              | `{ ok, items }`                                                                                                     |
| `POST /api/channels`             | `{ name, description? }` → 201 `{ ok, channel }`; slug repetido → 409                                               |
| `POST /api/messages`             | `{ channel_id, user_id, content, client_msg_id?, consistency? }` → `{ ok, message_id, message, deduped }`           |
| `GET /api/channels/:id/messages` | `limit=1..100` (50 padrão), `before` **ou** `after` TimeUUID v1, `consistency?`; `{ items, page: { next_before } }` |
| `GET /api/events`                | SSE nomeado: `connected`, `channel`, `message`; comentários heartbeat                                               |

Histórico da API é DESC e `next_before` é null ao esgotar. Crie o canal antes de enviar; canal desconhecido retorna 404. Nome de canal: 1–60 caracteres e slug ASCII válido; descrição: até 240. Mensagem: 1–2000 caracteres não vazios; autor e retry ID: até 100. O formulário usa até 50 para nome de exibição. Repetir a mesma chave no mesmo canal devolve a mensagem original; mudar autor/conteúdo com a mesma chave retorna 409. Sem chave de retry, cada POST cria uma nova mensagem.

```sh
curl http://localhost:3000/api/channels
curl -X POST http://localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"channel_id":"general","user_id":"Visitante","content":"Olá!","client_msg_id":"example-1"}'
```

## Validação

```sh
npm test
npm run build
npm audit --omit=dev
```

`npm test` executa os testes backend e os helpers frontend sem banco externo. [TESTING.md](TESTING.md) detalha checks opcionais e QA manual; [relatório de integração](docs/reports/integration-qa.md) registra a evidência desta entrega. GitHub Actions executa testes/build/audit de runtime em Node 20 e 22.

## Limites atuais

Esta demo pública aceita nomes livres e mensagens de qualquer visitante. Não há autenticação, autorização, moderação, rate limiting, remoção/edição de mensagens ou recuperação de conta. Não compartilhe informações privadas.

O JSON regrava todo o conjunto, mantém histórico/retries indefinidamente e serve um processo pequeno. SSE é local ao processo: não há broker entre instâncias, buffer de replay ou garantia de entrega; o navegador reconcilia pelo histórico. Um retry Scylla que conclui uma inserção interrompida pode retornar `deduped: true` sem novo evento SSE; clientes precisam reconciliar histórico. Na reconexão sem histórico conhecido, a recuperação pode carregar todas as páginas disponíveis. Busca permanece restrita às mensagens carregadas, sem índice global.

Capturas móveis usam viewport emulado, sem comprovar teclado físico de telefone ou leitor de tela. Não foram testados cluster Scylla vivo, deploy remoto ou tolerância a falhas distribuídas. O audit de runtime está sem vulnerabilidades conhecidas; o audit completo ainda registra 20 achados moderados na cadeia Jest/ts-jest via sprintf-js. Não existe licença declarada neste repositório.
