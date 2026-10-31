# Emissão manual de cobranças Sandbox

Extensão da especificação de 30/10/2026. Destino: módulo opcional `recebimentos`.
Sem instalação do módulo, nenhuma rota, tabela nova ou ferramenta é oferecida. A base continua
sendo a integração v1.85 e o roteamento por remetente já implantados; não se mescla a main oficial
v1.97 durante esta entrega, conforme o escopo de atualização do fork.

## Entrega e limites

- Administrador da empresa emite cobrança **de teste**, avulsa (valor humano e motivo obrigatório)
  ou de agendamento confirmado (valor do tipo de agendamento relido no servidor).
- CPF/CNPJ fictício vai direto ao Sandbox para identificar o pagador. Não fica no cache de
  mutações, audit ou tabela da cobrança. A descrição externa é sempre neutra.
- Fatura hospedada com meio Pix, boleto, cartão ou escolha na fatura. Não se captura cartão no CRM.
- Criação da intenção precede qualquer POST. Chave repetida e agendamento já cobrado não geram
  outro POST. Uma resposta perdida fica indeterminada; a consulta por referência só recupera,
  nunca autoriza uma segunda emissão. Múltiplos resultados ou divergência de valor vão para revisão.
- Chave/conta trocada bloqueia consulta/envio da obrigação antiga até revisão na conta original.
- Consulta canônica diferencia pendente, confirmação, liquidação, cancelamento e reversão.
  Não faz lançamento financeiro. Cancelamento só de pendente relida, sem alterar agenda.
- Prévia humana do WhatsApp, com pagador e conversa vinculados no servidor. A própria Inbox
  faz a entrega. Chave da operação, mensagem estável, CAS e intervalo de 60s evitam duplicação.
  Envio ambíguo ou enfileirado exige conferir a Inbox, sem repetição automática.
- A consulta MCP é leitura externa, escopada por contato. Revalida no provedor antes de mostrar
  link e nunca gera uma dívida. O envio da IA continua exclusivamente no harness nativo.

Não inclui nesta etapa: sinal/saldo persistidos, regras automáticas após agendamento, webhook,
conciliação financeira, cobrança de produção, envio automático ou conta bancária do revendedor.
Os cálculos de sinal/saldo já existentes continuam sendo prévia sem efeito financeiro.

## Dados e migração

Migration 9061 foi alocada após conferir a main oficial e os 66 PRs abertos em 31/10/2026:
maior número encontrado 9060; nenhum PR indisponível ou página omitida. Número não é reserva
permanente: conferir novamente antes de integrar. A migração é aditiva e reaplicável.

`recebimentos_cobrancas` só nasce na provisionadora do módulo. Segredos, hash de credencial e
referências internas não são selecionáveis pelo navegador. RLS de administrador e tenant;
trigger confere conexão, contato, agendamento e conversa da mesma empresa. A intenção é imutável.
A seção de LGPD redige motivo e URL quando o contato é anonimizado; valores/histórico permanecem.
Os DTOs do módulo são schemas Zod próprios; o dump tipado do núcleo não afirma tabelas opcionais
como instaladas universalmente.

## Living System Checklist

1. Entrada: formulário `_cobrancas.tsx`, origem `calendar_appointments` ou valor avulso humano.
2. Saída: `provedor-sandbox.ts`, tabela da intenção e `envio-service.ts` → porta da Inbox.
3. Registro: `recebimentos.charge_*` em `api_audit_log`; `message_id` na cobrança.
4. Tela: listagem e diagnóstico em Configurações → Recebimentos, link para Inbox.
5. Porta: destino de Recebimentos já registrado na navegação e Recursos opcionais.
6. Anti-morte: resposta incerta fica na lista com próxima ação Consultar situação; envio incerto
   instrui conferir Inbox. Nenhum retry automático de emissão ou envio ambíguo.
7. Configuração: chave/teste na tela; formulário só emite com conexão validada no servidor.
8. Continuidade: humano prepara emissão e envio; IA consulta apenas a obrigação desta pessoa.
   Não altera handoff, pausa, agendamento ou status comercial.
9. Retorno: consulta muda o estado visível e bloqueia envio de pago/cancelado/divergente;
   correção da chave não reativa automaticamente cobranças da conta anterior.
10. Mapa: `docs/architecture/recebimentos-cobrancas.architecture.json`.

## Verificação exigida

Testes de transporte, concorrência, resposta perdida, envio e DTO; migração fresh/update,
RLS/FKs/reaplicação/LGPD em Postgres; typecheck/lint/build; fluxo da tela sem envio para paciente
real. A prova da capacidade IA não equivale a provar um agente de produção: ativação e teste
pelo agente precisam ser registrados separadamente, com ferramenta direta e mesmo texto.
