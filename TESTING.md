# Testes e verificação

## Checks sem serviços externos

```sh
npm ci
npm test
npm run build
npm audit --omit=dev
npm audit
```

`npm test` roda `test:unit` (Jest/ts-jest, 48 testes) e `test:frontend` (Node test runner, 7 testes). As suítes backend usam adapters temporários; não se conectam ao DEV nem ao Scylla. Verificam validação, malformed JSON, limites HTTP, canais, paginação antes/depois, retries concorrentes, persistência ao reabrir, seed único, corrupção, lock e SSE. Os helpers frontend cobrem merge cronológico, TimeUUID rollover, filtro por canal, busca e retry após edição/troca de perfil.

`npm run test:watch` acompanha apenas Jest. `scripts/run-tests.sh` executa os checks padrão; `--scylla` seleciona os testes externos. `tests/frontend/frontend-tests.html` é um harness puro de helpers, não uma suíte end-to-end nem uma prova de banco real.

## API externa / Scylla

```sh
# Em servidor de laboratório separado, com schema e Scylla prontos:
STORAGE_MODE=scylla API_PORT=4320 npm run dev
# Outro terminal:
API_TEST_URL=http://localhost:4320 npm run test:scylla
```

A suíte exige `/health.storage=scylla`, cria canais com nomes únicos e grava dados de teste. Não execute contra uma demo com dados importantes. Não exclui esses canais: reserve um keyspace de laboratório. `npm run test:integration` e `scripts/test-scylla-concepts.sh` apontam para essa mesma suíte de contrato e carga pequena. Ela valida retry/LWT observável, isolamento, paginação e consistência aceita, mas não estabelece garantias de cluster ou desempenho.

Para verificar **apenas o contrato HTTP** usando JSON local, permita esse modo explicitamente:

```sh
API_TEST_ALLOW_LOCAL=1 API_TEST_URL=http://localhost:4320 npm run test:integration
```

Esse resultado não é um teste ScyllaDB. Nesta entrega, os testes externos foram rodados em processo local isolado; nenhuma instância Scylla foi iniciada.

## QA manual

Use duas abas na mesma origem. Crie um canal na primeira, confirme que aparece na segunda sem reload, selecione-o e envie texto; confira uma única cópia em cada aba. Envie HTML literal e confirme que permanece texto. Troque o nome, recarregue, confira perfil e rascunho por canal. Simule resposta perdida após uma gravação; repita o envio e confira mesma mensagem/ID.

Com mais de 50 mensagens, recarregue, selecione o canal e carregue páginas anteriores. Confira ordem, ausência de sobreposição e botão oculto ao esgotar. Desconecte SSE, grave mais de uma página e reconecte: o histórico deve recuperar o intervalo. Atrase a resposta de um canal e troque de canal: dados antigos não devem substituir a seleção.

Em 390×844, verifique overflow, composer, drawer, foco no abrir/fechar, Tab/Shift+Tab e diálogos com Escape/Cancelar. A busca deve declarar o número carregado; participantes não devem alegar presença. Testes com viewport não substituem telefone físico, tecnologia assistiva nem teste remoto.

## Evidência desta entrega

Veja [integration-qa.md](docs/reports/integration-qa.md), logs em `docs/reports/` e capturas reais em `docs/screenshots/`. Os resultados antigos nos handoffs são históricos; os logs de integração são o checkpoint final. O audit completo pode sair com status 1 devido aos 20 achados moderados de desenvolvimento; runtime está em zero. CI exige testes, build e audit de runtime, sem alegar que o audit completo está limpo.
