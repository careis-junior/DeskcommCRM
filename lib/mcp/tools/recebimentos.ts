import { z } from "zod";
import type { McpToolDefinition } from "../types";
import {
  cobrancaPodeSerEnviada,
  estadoDoPagamento,
  linkSandboxSeguro,
} from "@/lib/recebimentos/cobrancas";
import {
  exigirModulo,
  lerLinha,
  listarCobrancas,
  provedorDaCobranca,
  referenciaDaCobranca,
} from "@/lib/recebimentos/cobrancas-service";

const shape = {
  contact_id: z
    .string()
    .uuid()
    .describe("Contato desta conversa. Nunca informe o contato de outra pessoa."),
};
/** Consulta canônica de leitura: não gera dívida, não baixa caixa e não envia mensagem. */
export const crmConsultarRecebimentos: McpToolDefinition<typeof shape> = {
  name: "crm_consultar_recebimentos",
  description:
    "Consulta as cobranças de TESTE Sandbox do contato e o link válido no momento. Não cria cobranças nem envia mensagens. Avise explicitamente que o link é de teste e não vale como pagamento real. O link, se disponível, deve ser enviado somente pelo envio nativo do atendimento. Nunca afirme pagamento com base no texto do cliente.",
  inputSchema: shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    if (ctx.contatoDoTurno && ctx.contatoDoTurno !== input.contact_id)
      return { permitido: false, motivo: "fora_da_conversa" };
    await exigirModulo(ctx.supabase);
    const cobrancas = await listarCobrancas(ctx.supabase, ctx.organizationId, input.contact_id);
    const resultado = [];
    for (const c of cobrancas.slice(0, 10)) {
      const visao = {
        cobranca_id: c.id,
        valor_cents: c.amount_cents,
        moeda: c.currency,
        vencimento: c.due_date,
        situacao: c.status,
        link_pagamento: null as string | null,
        somente_teste: true,
      };
      try {
        const row = await lerLinha(ctx.supabase, ctx.organizationId, c.id);
        if (row.provider_payment_id) {
          const provedor = await provedorDaCobranca(ctx.supabase, ctx.organizationId, row);
          const p = await provedor.consultar(row.provider_payment_id);
          const certo =
            p.customer === row.provider_customer_id &&
            p.externalReference === referenciaDaCobranca(row.id) &&
            p.id === row.provider_payment_id &&
            p.dueDate === row.due_date &&
            Math.round(p.value * 100) === row.amount_cents;
          visao.situacao = certo
            ? p.deleted
              ? "cancelada"
              : estadoDoPagamento(p.status)
            : "revisao_manual";
          if (
            certo &&
            cobrancaPodeSerEnviada({ status: visao.situacao, invoice_url: p.invoiceUrl ?? null })
          )
            visao.link_pagamento = linkSandboxSeguro(p.invoiceUrl);
        }
      } catch {
        visao.situacao = "revisao_manual";
      }
      resultado.push(visao);
    }
    return { somente_teste: true, cobrancas: resultado, tem_mais: cobrancas.length > 10 };
  },
};
