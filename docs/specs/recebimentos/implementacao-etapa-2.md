# Recebimentos — conexão Sandbox por empresa

Destino: módulo opcional `recebimentos` (ADR-0002). O núcleo de agenda, vendas,
WhatsApp e cobrança da assinatura do revendedor não depende dele. Esta entrega
configura a conexão; não emite cobranças, não configura webhook e não envia links.

## Caminho de uso

1. O administrador da instalação instala **Recebimentos — Asaas Sandbox** em
   `/admin/modulos`. A função fixa `fn_recebimentos_provisionar()` cria a tabela
   somente nessa instalação, com RLS e privilégios aplicados na mesma transação.
2. O administrador de cada empresa abre **Configurações → Recebimentos**.
3. Salva uma chave Sandbox; o servidor usa o AES-256-GCM já existente
   (`AI_CRED_AES_KEY`), com IV novo. A chave não volta ao navegador.
4. **Testar conexão** decifra a chave no servidor e reutiliza somente a consulta
   de leitura do adaptador Asaas (`GET /customers?limit=1`). Não testa permissão
   de criar cobranças e não comprova homologação financeira.
5. **Desativar conexão** preserva a credencial cifrada, mas impede novo teste
   até que uma chave seja salva novamente. Nenhum dado do Asaas é apagado.

## Contratos

- `GET /api/v1/recebimentos/conexao`: metadados permitidos ou `conexao: null`.
- `PUT` no mesmo caminho: JSON estrito com `ambiente: sandbox`, `api_key` e
  `expected_revision` (zero na primeira gravação). Só chave `$aact_hmlg_…`.
- `PATCH`: JSON estrito com `expected_revision`, desativa a conexão.
- `POST /api/v1/recebimentos/conexao/testar`: JSON estrito com a revisão vista.

Todas as rotas exigem administrador da empresa ativa. As mutações passam por
`requireSupportWrite`. Empresa nunca vem do corpo. O módulo ausente/suspenso
retorna 404. Corpos são limitados durante a leitura do stream (6 KiB). Erros
não incluem JSON original, exceção do provedor, resposta do driver ou chave.
Auditoria registra ator, empresa, conexão, revisão e resultado, sem credenciais.

INSERT tem unicidade por empresa/provedor/ambiente. UPDATE exige organização e
revisão esperada no mesmo comando. Trocar a chave invalida o teste anterior.
O teste relê a revisão antes do HTTP e compara novamente ao gravar: um retorno
antigo não valida uma chave substituída ou desativada durante a consulta.

`recebimentos_conexoes` aceita apenas Sandbox nesta etapa. O papel do navegador
não pode ler cifra/IV/tag nem escrever; administradores leem apenas colunas
públicas da própria empresa. Atendentes e outras empresas não leem a conexão.
A tabela não guarda contatos ou dados clínicos; exclusão da empresa remove a
credencial por FK. Não há mapeamento de pagadores ou cobranças nesta entrega.

## Migração e compatibilidade

A 9055 foi alocada após consulta da main oficial e das cabeças dos 87 PRs abertos
(incluindo forks): maior número observado 9054. O timestamp UTC do arquivo é
20261031003131 (noite de 30/10 no Brasil). A consulta não incorporou código da
main à base instalada. Migration e apêndice de baseline contêm o mesmo SQL.

Nenhum segredo novo de ambiente: se `AI_CRED_AES_KEY` estiver ausente ou inválida,
salvar/testar retorna erro público de proteção indisponível, sem gravar em claro.
Não foi criada chave automaticamente, para preservar a criptografia existente.

## Sistema vivo e limites

| Pergunta        | Artefato                                                                       |
| --------------- | ------------------------------------------------------------------------------ |
| Entrada e porta | `/admin/modulos`, catálogo de navegação e tela de Configurações                |
| Saída           | Metadados filtrados da conexão e diagnóstico legível na mesma tela             |
| Registro        | `recebimentos.connection_saved/tested/disabled` na auditoria                   |
| Configuração    | Administrador da empresa; instalação desligada por padrão                      |
| Recuperação     | Nova chave limpa validação; teste indisponível oferece nova tentativa          |
| Concorrência    | Compare-and-swap da revisão impede retorno de chave antiga                     |
| IA/humano       | Nenhuma ferramenta de IA pode salvar chave, ativar produção ou cobrar          |
| Anti-morte      | Operação síncrona com timeout do adaptador; não há fila persistida nesta etapa |
| Mapa            | `docs/architecture/recebimentos-conexao.architecture.json`                     |

Testes: cifra real e nova IV, revisão e tenant em todas as consultas, proteção de
respostas/auditoria, recusa de produção/suporte, componente de tela sem segredo no
cache, molde da provisionadora e RLS com duas empresas. O E2E canônico instala e
salva uma chave sintética por tela, sem chamar o Asaas; está listado na parte 1.

Homologação real Sandbox, emissão, conta do provedor, mapeamento de pagadores,
webhooks, cobranças/recebimentos, conciliação e envio de links continuam pendentes.
Esta documentação não declara deploy, E2E ou teste de banco aprovados sem os
resultados dessas execuções.

## Verificação desta implementação

Em 30/10/2026, o recorte de serviço/API/componente passou 32 testes e o
TypeScript completo terminou sem erros. O controle negativo que adulterou a
revisão provocou duas falhas esperadas; o código original foi restaurado.

Um PostgreSQL 16 descartável, sem rede, recebeu o prelude Supabase do harness e
o baseline nas passadas INSTALL e UPDATE. Passaram: ausência da tabela antes da
instalação, RLS ligada após provisionamento, privilégios de coluna, recusa de
escrita e execução da provisionadora pelo navegador, separação de duas empresas,
recusa de atendente e preservação de dados ao reprovisionar. Foram usadas somente
fixtures sintéticas. O container foi removido ao final. Essa execução SQL focada
não substitui a suíte completa de invariantes nas duas majors do CI nem o E2E.
