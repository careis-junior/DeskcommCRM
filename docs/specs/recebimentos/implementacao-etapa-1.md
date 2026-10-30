# Recebimentos — etapa 1: cálculo e prévia autenticada

Estado: incremento preparatório; não é uma integração Asaas operacional.
Destino: núcleo (prévia pura) e base de módulo opcional (regras). Sem ativação,
agenda, vendas, financeiro, agentes e envio de mensagens mantêm seus caminhos.

## Implementado neste incremento

- `lib/recebimentos/plano.ts`: BRL em centavos inteiros seguros; total, sinal
  fixo ou percentual em pontos-base; saldo calculado pela diferença. Meio
  centavo arredonda para cima uma única vez. Sinal integral não cria saldo zero;
  sinal maior que o total ou arredondado para zero é recusado.
- `lib/recebimentos/regras.ts`: configuração estrita, inicialmente desligada e
  manual; seleção por origem/gatilho, prioridade maior e bloqueio de empate.
  O seletor ainda não está conectado a eventos, banco ou emissão.
- `POST /api/v1/recebimentos/simular`: sessão de gestor ou administrador via
  `requireRole`, guarda de suporte, JSON estrito e limite de corpo de 4 KiB.
  Sem escrita, sem provedor, sem auditoria de mutação, sem envio.

O corpo da prévia aceita exclusivamente:

```json
{
  "total_cents": 100000,
  "currency": "BRL",
  "condicao": { "tipo": "sinal_percentual", "percentual_bps": 3000 }
}
```

Retorna `data` com `simulacao: true`, `gera_cobranca: false`,
`envia_mensagem: false`, total e etapas (`sinal: 30000`, `saldo: 70000`).
Não aceita `organization_id`, chave, ID remoto ou pagador. A prévia não valida
titularidade de origem: ela não recebe origem nem cria obrigação. Na emissão
futura, preço e pagador serão relidos de registros autorizados no servidor.

Respostas: 200 para prévia; 400 JSON inválido; 413 corpo excedido; 422 condição
inválida; 401/403 pelos guards. Nenhum dado recebido é ecoado em erro.

## Base e limitações verificadas

A branch foi baixada em `f3f09684e1ca12aa2d44ccdb5d1cd0af46dbd2bb`, sobre
o roteamento por remetente `c4b2f591c7ce51ee58e227a4e819ed48e021c1a2`.
A `main` do fork tem outras atualizações. Não foi incorporada automaticamente:
a especificação aprovada fixa a base de produção e proíbe sincronização cega.
A base continua provisória até conferir imagens e schema da instalação.

CONFIRMADO no código da base: `fn_finalizar_comanda` insere lançamento `paid`
ao finalizar a venda. A integração futura não pode chamar essa função para
registrar cada pagamento, sob risco de duplicar receita. Não houve alteração
nessa função neste incremento.

## O que falta para a funcionalidade completa

1. Confirmar inventário da instalação, imagens/digests e migrations aplicadas.
2. Provisionamento das tabelas do módulo conforme ADR-0002, RLS, grants,
   referências compostas e testes reais de dois tenants.
3. Conexão por tenant/ambiente, segredos cifrados e adaptador Asaas avulso.
4. Intenção durável, claim/fencing e recuperação de criação indeterminada.
5. Inbox de webhooks, releitura, conciliação e movimentos financeiros.
6. Tela/configuração, navegação, gatilhos comerciais, fila de canal e IA.
7. Homologação Asaas sandbox, regressões e deploy gradual com rollback.

Não foram criados schema, conexões, credenciais, cobranças ou imagens Docker.
A consulta à saúde da produção foi bloqueada pela revisão automática de acesso.
Não há homologação Asaas nem prova visual do módulo; ainda não existe tela.

## Checklist de sistema vivo para este incremento

| Pergunta     | Artefato ou limitação                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Entrada      | JSON autenticado de `POST /api/v1/recebimentos/simular`                 |
| Saída        | `simularRecebimento` entrega etapas à resposta `ok()`                   |
| Registro     | Nenhuma mutação; correlação pelo `X-Request-Id`                         |
| Tela e porta | Pendentes; este incremento não é anunciado como módulo pronto           |
| Anti-morte   | Nenhum job/demanda persistida; não há fila para abandonar               |
| Configuração | Corpo tipado de prévia; não salva regra nem ativa automação             |
| IA/humano    | Nenhuma capacidade IA adicionada; uso futuro depende de escopo          |
| Laço         | 422 corrige condição inválida sem criar dívida; empate bloqueia seleção |
| Mapa         | `docs/architecture/recebimentos-previa.architecture.json`               |

## Verificação

Os testes de cálculo, regras e rota ficam ao lado do código. Executar:

```bash
pnpm vitest run lib/recebimentos app/api/v1/recebimentos
pnpm typecheck
pnpm lint
pnpm lint:channels
pnpm test:unit
pnpm build
```

Resultados da sessão de 30/10/2026:

- 37 testes específicos passaram (cálculo, seleção e rota).
- `pnpm lint` completo passou (exit 0).
- `lint:channels` e conferência de fragmentos passaram com
  `node --import tsx scripts/lint-channels.ts` e
  `node --import tsx scripts/cortar-release.ts`. O CLI `tsx` tentava criar um
  socket IPC proibido pelo ambiente; estes comandos executam os mesmos scripts.
- Controle negativo: removido temporariamente o arredondamento de meio centavo,
  o teste correspondente falhou (1 falha, 18 acertos); código restaurado.
- Typecheck e build não concluíram por limite de memória. Não foram aprovados.
- A suíte unitária ampla não foi aprovada: apresentou falhas de scripts/ambiente
  e a revisão automática bloqueou continuação por tentativa de acesso à API da
  Anthropic com payload não verificado. Não foi repetida por outro meio.
- RLS, fresh/update, E2E, Asaas sandbox, CI e deploy não foram medidos neste
  incremento. A consulta à produção segue pendente de autorização de acesso.

RLS, fresh/update e E2E do módulo dependem das próximas etapas; não são cobertos
por testes puros. Estes resultados não autorizam merge ou deploy de produção.
