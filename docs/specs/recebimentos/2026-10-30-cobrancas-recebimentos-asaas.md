# Especificação técnica — Cobranças e Recebimentos
Versão: 1.0 · Data: 30/10/2026 · Responsável pelo produto: Carlos Reis
Repositório de entrega: careis-junior/DeskcommCRM
Branch de planejamento: feat/cobrancas-recebimentos-asaas
Status: especificado; implementação, testes executáveis e deploy ainda não realizados por este documento.

## 1. Objetivo e decisão de arquitetura
Criar um módulo opcional, genérico e multiempresa para cobrar os clientes das empresas usuárias do CRM. Cada empresa conecta sua própria conta Asaas, configura regras e acompanha recebimentos. Saúde, comércio, oficinas, educação e outros serviços compartilham o mesmo domínio financeiro e recebem modelos editáveis.

A cobrança de assinatura do CRM pelo revendedor já existente em lib/cobranca é outro domínio: suas credenciais, pagadores, webhooks, tabelas e regras NÃO serão reutilizados como se fossem recebimentos de clientes. Aproveitar primitivas de transporte e criptografia somente após revisão. Namespace proposto: lib/recebimentos, tabelas recebimentos_* e capacidade recebimentos. Asaas é o primeiro adaptador; a aplicação usa contrato de provedor.

A geração automática será acionada por evento de negócio persistido, sem depender de MCP externo, decisão do modelo de IA ou n8n. n8n pode consumir eventos futuramente. Sem ativação do módulo, a operação atual permanece íntegra.

## 2. Contexto técnico verificado e base de entrega
Referências inspecionadas no código público: lib/financeiro/comanda.ts; app/api/v1/financeiro; lib/cobranca/provedores/asaas.ts; lib/agenda/laco.ts; lib/agenda/aviso-de-agendamento.ts; lib/agent-engine/edge/crm/mcp-tools.ts; lib/ai/runtime/escopo-das-escritas.ts.

Existem sales, sale_items, financial_entries, contatos, agenda, catálogo de serviços e infraestrutura de eventos/workers. appointment.created existe; os demais gatilhos terão sua existência e semântica confirmadas na base escolhida. Nenhum nome de evento proposto abaixo deve ser tratado como já implementado.

O MCP externo da v1.94.0 exige ferramenta selecionada e recusa escritas remotas durante atendimento; o preview do agente é somente leitura. A nova funcionalidade não remove essas proteções.

O fork pessoal tem main em f13d26f6b00d65730f101e92fac50e3205b97211 na consulta desta especificação. A atualização anterior usou feat/roteamento-remetente-v1.85 em c4b2f591c7ce51ee58e227a4e819ed48e021c1a2. A tela atual anuncia atualização v1.94.0; o rótulo não prova o SHA das imagens em execução.

Pré-requisito da implementação: inventariar no host o SHA/digest de app, worker e scheduler, compose efetivo, migrations aplicadas e customizações; escolher branch de integração que preserve o comportamento atual e o roteamento por remetente. Não substituir a produção pela branch v1.85, nem sincronizar cegamente a main oficial. Consultar upstream para compatibilidade não cria dependência de aprovação do mantenedor.

## 3. Escopo da primeira entrega
- Configuração de conta Asaas por tenant e ambiente; teste de conexão; segredos cifrados.
- Cobranças avulsas em BRL por Pix, boleto ou cartão na página hospedada do Asaas; escolha de meios conforme conta/provedor.
- Valor total, sinal fixo ou percentual e saldo; múltiplas etapas explicitamente identificadas.
- Vínculo com agendamento, pedido, venda/comanda, serviço/ordem de serviço ou cobrança avulsa.
- Adaptadores de origem para os registros que realmente existirem na base. Ordem de serviço pode ser referência externa validada; o módulo não cria um ERP de oficina.
- Geração manual e automática; listagem, detalhe, consulta ao provedor, envio e reenvio de link, cancelamento de cobrança ainda não paga.
- Webhooks, conciliação, notificações e atualização do financeiro sem duplicidade.
- Regras e modelos de mensagens por empresa; configurações inicialmente desligadas.
- Histórico, erros operacionais, tentativas, recuperação e trilha de auditoria.

Fora da primeira entrega: split de recebíveis, repasse ao dono da plataforma, abertura de subcontas, carteira, transferências, antecipação, captura de cartão no CRM, assinatura recorrente dos clientes, parcelamento de cartão e execução de estorno pelo agente. O modelo permite extensão futura. Reconhecer webhook de estorno/chargeback é obrigatório desde a v1 mesmo sem botão para iniciá-lo.

## 4. Configuração por empresa e segmento
Cada tenant define conexão, ambiente, conta financeira de destino, plano de contas, meios permitidos, modo manual/automático, gatilhos, percentual/valor do sinal, vencimento, mensagens, lembretes, canais e efeitos após pagamento.

| Modelo inicial | Origem | Gatilho sugerido | Plano | Efeito sugerido |
| --- | --- | --- | --- | --- |
| Saúde | Agendamento | Reserva concluída | Total ou sinal | Situação financeira; confirmação depende da regra |
| Comércio | Pedido/venda | Pedido aprovado | Total ou entrada/saldo | Avisar equipe para liberar pedido |
| Oficina/motopeças | Comanda/serviço | Orçamento aprovado | Entrada e saldo | Avisar início/liberação |
| Serviços gerais | Serviço/comanda | Contratação ou conclusão | Total ou entrada/saldo | Avisar responsável |
| Educação | Matrícula/serviço referenciado | Confirmação comercial | Cobrança avulsa | Atualizar situação financeira |

Modelos são configurações copiadas, versionadas e editáveis; não condicionais por nome de empresa. Nenhum modelo envia mensagem ou cobra retroativamente ao ser aplicado. Prévia mostra gatilho, valor e mensagem antes de ativação. Uma única regra vencedora por origem/etapa: prioridade explícita; empate é erro visível, não duas cobranças.

Defaults: geração manual, automações e lembretes desligados; agendamento preservado se cobrança falhar; não cancelar consulta/pedido nem liberar estoque automaticamente. Ativar produção por tenant exige teste de credencial e configuração válida; não pode ser disparado pela IA.

Separar: estado do negócio, estado da cobrança, pagamento confirmado e liquidação financeira. Para saúde, reservar horário até pagar pode ser opção futura com prazo/expiração explícitos; a v1 não cancela agenda por atraso.

## 5. Modelo de domínio e invariantes
Todos os valores são centavos inteiros no CRM. Percentuais usam pontos-base (0..10000), com arredondamento único documentado; entrada + saldo deve igualar total. Converter para decimal somente na borda Asaas. Datas de vencimento são datas civis no fuso configurado, inicialmente America/Sao_Paulo; instantes são UTC.

Uma cobrança não é um recebimento. Um negócio pode ter sinal e saldo; uma cobrança pode ter recebimentos, taxas e reversões. IDs de provedor nunca são aceitos como autorização.

Invariantes:
1. Tenant e titularidade de todos os vínculos são obtidos/validados no servidor.
2. Uma etapa de um plano possui no máximo uma intenção de cobrança ativa por versão.
3. Repetição de evento, clique, job, webhook e reenvio não gera nova obrigação nem nova entrada financeira.
4. Valor vem do registro comercial e de regras aprovadas. IA não escolhe preço, conta, chave nem destinatário.
5. Timeout após POST remoto resulta em estado de resultado desconhecido; não repetir cegamente.
6. Não reduzir saldo pendente por criação de link, screenshot, texto da paciente ou retorno do navegador.
7. Mensagens e lançamentos são emitidos somente após estado persistido e com chave idempotente.
8. Remarcar preserva cobrança, salvo mudança aprovada; cancelar origem não equivale a estornar.
9. Correção de valor cria revisão rastreável; não editar cobrança já liquidada.
10. Asaas sandbox e produção nunca compartilham mapeamentos, segredos ou IDs.

## 6. Modelo de dados proposto
Nomes finais dependem da conferência de colisões no fork. Todas as tabelas tenant-aware levam organization_id, timestamps e RLS; referências tenant-aware usam FK composta (organization_id, id) ou verificação transacional equivalente. Não confiar em FK uuid simples para isolamento.

| Entidade | Conteúdo e restrições principais |
| --- | --- |
| recebimentos_conexoes | id, tenant, provider, ambiente, identificador da conta, status, credencial cifrada/iv/tag/last4, token de webhook protegido, versão, diagnóstico. Uma conexão ativa por tenant/provedor/ambiente na v1. Segredos não retornam ao browser. |
| recebimentos_clientes_provedor | conexão, contact_id, provider_customer_id, external_reference; UNIQUE conexão/contato e conexão/id remoto. Pagador pode diferir do atendido (responsável por menor). |
| recebimentos_regras | origem, gatilho, filtros tipados, prioridade, modo, sinal, vencimento, meios, mensagens, efeitos e versão; sem execução de código arbitrário. |
| recebimentos_planos | origem validada, contato atendido, pagador, total congelado, moeda, revisão e regra aplicada. Vínculos tipados a agenda, sales ou pedido; referência externa com tipo, namespace e titularidade. |
| recebimentos_cobrancas | plano/etapa, conexão, valor, vencimento, estado local, estado bruto remoto, provider_payment_id, external_reference, invoice_url, job/claim, tentativa e próximo processamento. UNIQUE conexão/external_reference e conexão/provider_payment_id quando presente. |
| recebimentos_eventos_provedor | conexão e provider_event_id únicos, tipo, hash, payload mínimo protegido, recebido/processado, tentativas e erro seguro; inbox durável. |
| recebimentos_movimentos | pagamento confirmado, liquidação, taxa, estorno/chargeback, valor bruto/líquido e vínculo à cobrança; chave externa única. Registro append-only. |
| recebimentos_alocacoes | vínculo entre movimento e financial_entries, com idempotência para conciliação e trilha de ajuste. |
| recebimentos_notificacoes | cobrança, evento/motivo, destinatário validado, conversa/canal, status, idempotency_key e próxima tentativa. Não é segundo motor de WhatsApp. |

Índices: tenant/estado/vencimento; jobs pendentes/next_attempt_at; provider ids; origem/etapa/revisão. Constraints para valores positivos, moeda BRL, estágio válido e teto do plano. Payloads possuem retenção limitada; não armazenar dados completos de cartão ou informação clínica.

Migrações: arquivo versionado com -- manifest:, apêndice idempotente em supabase/baseline.sql, tipos atualizados, testes de fresh-install e update em banco com dados. Não alterar migrations aplicadas. Alocar número e timestamp após comparar a base real, migrations oficiais e customizações; sem número inventado nesta especificação.

## 7. Contrato do provedor Asaas
Interface sugerida: PaymentProvider.testConnection, resolveCustomer, createCharge, getCharge, findByExternalReference, cancelUnpaidCharge, normalizePayment e validateWebhook.

Bases permitidas fixas:
- sandbox: https://api-sandbox.asaas.com/v3
- produção: https://api.asaas.com/v3

Autenticação access_token somente no servidor. Vincular explicitamente ambiente e conta; validar consistência da chave quando o formato permitir, sem depender apenas do prefixo. A credencial da assinatura do revendedor não entra nesta interface.

Criação: POST /payments com customer, billingType, value, dueDate, externalReference opaca e description neutra. Retornar ID, status e invoiceUrl após validar schema e host HTTPS permitido. Usar página hospedada: CRM/WhatsApp não recebem número de cartão ou CVV. CPF/CNPJ e endereço somente quando necessários ao meio e à conta; coleta segura separada, sem forçar paciente a informar documento no chat público.

Cadastro do pagador: reusar mapeamento da conexão e contato; lookup por externalReference controlada antes de cadastrar novamente. Não deduplicar globalmente por telefone/CPF entre tenants. Responsável financeiro pode pagar consulta de outra pessoa.

Avisos do próprio Asaas devem ser configurados para evitar duplicação com a régua do CRM; não alterar preferências globais sem configuração explícita. Taxas dependem da conta e do contrato; não codificar valores fixos.

## 8. Geração, concorrência e recuperação
1. Transação comercial termina e persiste evento/outbox; nunca HTTP no trigger do banco.
2. Worker resolve regra ativa e congela plano/valor; reserva intenção local com UNIQUE de negócio.
3. Adquire lease/claim por cobrança, localiza/cria pagador e consulta eventual cobrança remota.
4. Envia criação ao Asaas usando externalReference única e estável.
5. Persiste resposta e agenda notificação. Só então o link pode ser entregue.
6. Webhook e reconciliação atualizam pagamento e financeiro.

Não há transação distribuída entre Postgres e Asaas. externalReference é referência de busca, não promessa de unicidade remota. Portanto UNIQUE local não resolve sozinho falha entre POST e commit:
- GET pode repetir com backoff/jitter.
- POST de criação não repete automaticamente em timeout/5xx com resultado ambíguo.
- Marcar criacao_indeterminada, bloquear novas criações para a etapa e reconciliar via consulta.
- Se não houver prova suficiente do resultado, manter revisão operacional; não emitir outro POST só porque uma busca momentânea veio vazia.
- Múltiplos resultados para a referência geram incidente de duplicidade e bloqueio.
- Reexecução de job utiliza fencing token/lease; sem claim válido não aplica resultado nem envia link.
- Reenvio reutiliza cobrança vigente; não gera nova externalReference.

Estados operacionais separados do estado financeiro: aguardando_dados, fila, criando, criacao_indeterminada, ativa, falha_recuperavel, revisao_manual. Falhas permanentes 400/401/403 não entram em loop; rate-limit usa espera limitada. Métrica e aviso para credencial inválida, fila parada e conciliação atrasada.

## 9. Pagamento, webhooks e financeiro
Endpoint público proposto: POST /api/v1/recebimentos/webhooks/asaas/:connectionPublicId. organization_id é resolvido pela conexão no servidor, nunca pelo body. ID público opaco não é segredo; autenticar via asaas-access-token com comparação segura e token próprio por conexão.

Validar tamanho, schema, rate limit e ambiente; nunca registrar header/token. Persistir inbox deduplicada antes de responder 200. Falha na persistência retorna erro para o provedor tentar novamente. Processamento assíncrono; eventos desconhecidos válidos são registrados/ignorados sem quebrar fila.

Verificar payment id, referência, conta, moeda e valor; valor divergente vai para revisão, sem quitação silenciosa. Webhook acorda releitura canônica do provedor para evitar aplicar eventos fora de ordem. Evento antigo não reabre pagamento sem evidência de reversão. Guardar último estado reconciliado e histórico.

| Sinal remoto | Efeito de domínio |
| --- | --- |
| PENDING / AWAITING_RISK_ANALYSIS | Aguardando pagamento/análise; não baixar caixa |
| CONFIRMED | Pagamento confirmado; baixa da obrigação conforme política, ainda sem caixa disponível |
| RECEIVED | Liquidação recebida; registrar entrada e taxas sem duplicar o confirmado |
| OVERDUE | Em atraso, interromper lembrete se pago/cancelado durante a fila |
| DELETED | Cancelada apenas se situação canônica permitir; conservar histórico |
| REFUNDED / parcial | Reversão conforme valor efetivo; recompor obrigação só pela política |
| Chargeback/contestação | Suspender liberação automática, avisar gestor e registrar ajuste |

Pagamento confirmado pode reduzir saldo do cliente antes da liquidação, mas relatório de disponível só soma recursos recebidos. Valores bruto, taxas e líquido são separados. CONFIRMED seguido de RECEIVED não cria duas receitas.

financial_entries é integrado por movimento idempotente. Antes de implementar, revisar a finalização de sales: a versão atual pode criar entrada paga ao finalizar. O novo caminho deve preservar o modo manual existente e permitir venda finalizada com saldo a receber sem registrar caixa fictício. Recebimento antecipado de consulta é adiantamento alocado depois, não nova receita ao concluir atendimento. Nunca chamar finalize-sale indiscriminadamente no webhook.

Lançamentos pagos são imutáveis; reversões geram contra-lançamentos rastreáveis. Mudança de regra contábil não reescreve passado. Reconciliação periódica de pendentes e janela recente recupera webhook perdido; falha persistente vai para fila de revisão.

## 10. Gatilhos e adaptadores de origem
Usar registro de adaptadores: loadSource, validateOwnership, calculateOutstanding, describeForPayer, onPayment e onSourceChanged. Um serviço central é chamado por UI, worker e ferramentas da IA.

Gatilhos propostos: agendamento concluído, pedido aprovado, negócio aprovado, serviço concluído, comanda fechada e comando manual. Mapear cada um a evento real ou adicionar outbox no mesmo commit da mutação. Filtro por status final evita cobrar reserva falhada, consulta de agenda ou simples conversa.

Mudanças: remarcar não duplica; cancelamento com cobrança pendente cria pedido de cancelamento condicionado ao provedor; pagamento em trânsito impede cancelamento cego. Pedido pago depois de cancelado gera aviso/revisão. Alteração de preço exige revisão do plano e ajuste aprovado. Sem gatilho retroativo sobre registros antigos.

Ações após pagar são tipadas e idempotentes: marcador financeiro, mover etapa permitida, tarefa ao responsável, mensagem de confirmação, sinal para liberar pedido. Desligadas inicialmente. Liberação física, baixa de estoque e decisão clínica não acontecem por texto da IA.

## 11. API e RBAC
Rotas propostas sob /api/v1/recebimentos:
- GET/POST /conexoes; PATCH /conexoes/:id; POST /conexoes/:id/testar.
- GET/POST /regras; PATCH /regras/:id; POST /regras/:id/simular.
- GET/POST /cobrancas; GET /cobrancas/:id.
- POST /cobrancas/:id/enviar, /sincronizar e /cancelar.
- GET /cobrancas/:id/historico.
- POST /webhooks/asaas/:connectionPublicId (sem cookie; segredo próprio).

POST aceita referência da origem/etapa e idempotency key. Cliente não fornece chave de provedor nem tenant de autoridade. Valor avulso exige permissão humana e motivo; geração de saldo é calculada pelo servidor. 202 para processamento, 409 para conflito/resultado indefinido, 422 dados incompletos, 403 sem permissão. Sempre wrappers ok/fail e Zod conforme projeto.

| Papel | Permissão |
| --- | --- |
| Admin do tenant | Configurar conta, regras e permissões |
| Gestor financeiro | Consultar, gerar, sincronizar e cancelar pendentes conforme grant |
| Atendente | Consultar cobranças do escopo permitido e reenviar link autorizado |
| Leitura | Consultar somente visão financeira autorizada |
| Agente IA | Operações restritas ao contato/origem do turno e à política publicada |

Não dar ao atendente ou à IA acesso ao saldo bancário global, documentos completos, credenciais, estorno ou alterações de conta. Segredos são write-only e cifrados com infraestrutura do projeto; DTO de configuração devolve só status e last4.

## 12. Agente de IA e envio WhatsApp
Capacidades nativas propostas: consultar_cobrancas_do_contato, solicitar_cobranca_da_origem, reenviar_link_da_cobranca. Registrar no catálogo, controles de permissão e mapa de escopo do turno. Não transformar geração real em leitura para contornar MCP.

Geração automática pertence ao evento comercial. Se o agente também solicitar, ambos convergem à mesma intenção idempotente. Após agendar, a resposta informa a reserva e, se o link ainda não existir, informa que está em preparação; envio posterior é job durável, não promessa sem registro.

Toda mensagem usa a fila/canal já existente e suas regras de janela, opt-out, pausa, templates e ritmo. Não chamar Evolution/WAHA diretamente de um adaptador de pagamento. Uma só autoridade de envio por evento evita mensagem duplicada do agente, worker e n8n.

Revalidar vínculo e status antes de enviar; link pago/cancelado não entra em lembrete. Destinatário é o pagador validado; responsável financeiro diferente exige contato autorizado. Links nunca vêm do texto do cliente. Reenvio manual tem cooldown e auditoria.

Templates com variáveis allowlist: primeiro_nome, descricao_publica, referencia, valor, vencimento, link_pagamento. Escape e limite de tamanho. Mensagens neutras por padrão; não expor diagnóstico, procedimento sensível ou descrição clínica ao provedor.

Preview/dry-run simula saída e nunca cria cobrança real nem envia WhatsApp. Prova de IA exige comparar resultado do agente com chamada direta da capacidade para o mesmo cenário.

## 13. Interface
- Navegação CRM/Financeiro > Cobranças e Recebimentos, declarada no catálogo de navegação.
- Configurações > Recebimentos: conexão, sandbox/produção, regras e modelos.
- Lista: cliente/pagador, referência/origem, etapa, valor, vencimento, estado do pagamento e liquidação, envio, filtros e totais separados.
- Detalhe: origem, plano, histórico, link, eventos, conciliação, erros e ações permitidas.
- Painel contextual no Inbox e botões em agenda/comanda/pedido.
- Sandbox destacado em todas as telas e links; produção exige conexão própria.
- Estados vazios explicam configuração faltante; erros distinguem dados faltantes, indisponibilidade e resultado desconhecido, com ação de recuperação.

## 14. Testes e critérios de aceite
Testes unitários: regras por segmento; prioridade/empate; percentuais; sinal/saldo; fuso; transições; schemas; mensagens; classificação de erros; confirmação versus liquidação.

Integração com provedor simulado: criar/consultar/cancelar; 400/401/403/429; timeout antes/depois do aceite; POST aceito com resposta perdida; busca com múltiplos resultados; callbacks duplicados/fora de ordem; indisponibilidade prolongada.

Banco/RLS: dois tenants com dados parecidos, tentativa de FK cruzada, concorrência de dois workers, expiração de lease, evento repetido e reenvio. Provar uma obrigação e uma entrada financeira, nunca só contar respostas HTTP.

E2E visual com dados fictícios:
1. Saúde: agendar R$1.000, gerar link e confirmar pagamento.
2. Comércio: pedido de R$250, receber e avisar liberação.
3. Oficina: R$1.000, sinal R$300 e saldo R$700, sem sobreposição.
4. Tenant sem módulo mantém agenda/venda manual intactas.
5. Pagador responsável distinto do atendido.
6. Remarcação, cancelamento, pagamento tardio, estorno parcial e chargeback.
7. WhatsApp fechado/opt-out/pausa retém ou recusa mensagem sem duplicar cobrança.
8. Finalizar comanda após adiantamento não cria segunda receita.
9. IA do contato A não consulta/gera/reenvia cobrança de B.
10. Webhook perdido recuperado pela reconciliação.
11. Atualização preserva roteamento por remetente e agentes atuais.

Gates para código: typecheck, lint, lint:channels, unitários relevantes, build, RLS/db, migração fresh/update, E2E e test:shell se embalagem mudar. Executar também jobs reais do fork; não interpretar check ignorado como aprovado. Homologação Asaas sandbox com conta própria é distinta de testes locais simulados.

## 15. Observabilidade e laço de recuperação
Auditoria sem dados sensíveis: usuário/agente, tenant, origem, cobrança, ação, resultado e correlação. Contadores de cobranças criadas, criação indeterminada, atraso de webhook, filas e erros; dashboard com pendências operacionais.

Consumidores concretos: worker de cobranças consome outbox; webhook alimenta inbox; reconciliador recupera pendentes; fila de canal envia notificação; financeiro recebe movimento; UI exibe estado. Falha em qualquer lado gera diagnóstico/ação, não desaparece no log. Atualizar mapa de arquitetura e checklist do sistema vivo ao implementar.

## 16. Entrega independente no fork e deploy
Etapas com commits pequenos:
A. Especificação e inventário da base.
B. Schema/RLS, configuração e contrato do provedor.
C. Cobrança manual, sandbox e UI.
D. Webhooks, conciliação e integração contábil.
E. Gatilhos comerciais, modelos e mensagens.
F. Capacidades de IA, regressões, documentação e imagens.
G. Homologação e implantação gradual.

PRs, se usados, têm base no próprio careis-junior/DeskcommCRM. Não abrir PR oficial como pré-requisito, não aguardar merge oficial e não publicar segredos no fork público.

GitHub Actions do fork testa e publica app/worker a partir do MESMO SHA. Tag humana recebimentos-asaas-<sha> e digests imutáveis registrados. Scheduler só atualiza se sua configuração/rotina mudar e após teste. Verificar nomes reais de packages, permissões packages:write e workflows antes de editar.

Runbook de deploy:
1. Identificar imagens/digests, base, compose, customizações e migrations atuais; guardar evidência.
2. Backup de banco e configuração com restauração verificável; nunca commitar .env.
3. Testar migração aditiva, app/worker e fluxo em ambiente isolado com sandbox.
4. Aplicar schema compatível; manter módulo desligado.
5. Puxar imagens homologadas do fork e atualizar serviços com compose efetivo do host e labels Traefik preservadas.
6. Verificar saúde interna e domínio externo, login, agenda, Inbox e roteamento.
7. Ativar primeiro tenant em sandbox e medir fluxo completo.
8. Produção financeira só com credenciais próprias e configuração explícita; este documento não autoriza cobrar pacientes reais em teste.

Rollback: desligar novas gerações/ações automáticas; manter eventos financeiros recebidos em inbox durável para não perder pagamentos. Se app antigo não suporta webhook novo, preservar consumidor compatível durante rollback. Voltar app/worker aos digests anteriores como conjunto. Migrações aditivas permanecem; não apagar cobrança/livro-caixa para reverter código. Não restaurar backup antigo sobre pagamentos novos sem plano de reconciliação.

Não considerar deploy realizado por publicar a especificação, abrir PR ou construir imagem. Evidência final exige SHA, digests, gates, migrações, verificação do host e teste funcional.

## 17. Decisões fixadas e dependências
Fixadas: módulo genérico por tenant; Asaas inicial; integração nativa; BRL; página hospedada; manual primeiro; automação configurável; preservar negócio se cobrança falhar; evitar duplicidades; fork independente.

A confirmar tecnicamente antes do código/deploy: SHA real em produção; base das customizações; eventos de pedido/serviço disponíveis; finalização/receita em sales; existência de credencial sandbox; acesso de implantação e restauração. Essa confirmação é levantamento técnico, não aprovação do repositório oficial.

## 18. Fontes
Código de referência do projeto: https://github.com/melgarafael/DeskcommCRM
Fork de entrega: https://github.com/careis-junior/DeskcommCRM
Asaas — cobranças: https://docs.asaas.com/docs/guia-de-cobrancas
Asaas — criar cobrança: https://docs.asaas.com/reference/criar-nova-cobranca
Asaas — cartão/fatura e timeout: https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito
Asaas — eventos: https://docs.asaas.com/docs/webhook-para-cobrancas
Asaas — recepção de webhook: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
Referências verificadas em 30/10/2026; conferir contratos do provedor novamente durante a implementação.
