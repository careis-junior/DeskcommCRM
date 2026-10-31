import { z } from "zod";

import { condicaoDeRecebimentoSchema } from "./plano";

export const origemDeRecebimentoSchema = z.enum([
  "agendamento",
  "pedido",
  "venda",
  "servico",
  "avulsa",
]);

/** Só vocabulário de configuração: não afirma que estes eventos já existem. */
export const regraDeRecebimentoSchema = z.strictObject({
  id: z.string().uuid(),
  origem: origemDeRecebimentoSchema,
  gatilho: z.enum(["manual", "reserva_concluida", "aprovacao_comercial", "servico_concluido"]),
  ativa: z.boolean().default(false),
  modo: z.enum(["manual", "automatico"]).default("manual"),
  prioridade: z.number().int().min(0).max(1_000_000).default(0),
  condicao: condicaoDeRecebimentoSchema,
});

export type RegraDeRecebimento = z.infer<typeof regraDeRecebimentoSchema>;

export type SelecaoDaRegra =
  | { estado: "sem_regra" }
  | { estado: "configuracao_invalida" }
  | { estado: "conflito"; regra_ids: string[] }
  | { estado: "selecionada"; regra: RegraDeRecebimento };

/**
 * Quem chama carrega SOMENTE regras do tenant autorizado. Não é guard de
 * autorização. Prioridade maior vence; empate bloqueia a emissão (§4).
 * Regras manuais jamais concorrem quando a entrada é um evento automático.
 */
export function selecionarRegraDeRecebimento(
  regras: unknown,
  alvo: {
    origem: RegraDeRecebimento["origem"];
    gatilho: RegraDeRecebimento["gatilho"];
    automatico: boolean;
  },
): SelecaoDaRegra {
  const lidas = z.array(regraDeRecebimentoSchema).max(1_000).safeParse(regras);
  if (!lidas.success) return { estado: "configuracao_invalida" };
  // IDs repetidos indicam erro na configuração/leitura, não duas regras.
  if (new Set(lidas.data.map((r) => r.id)).size !== lidas.data.length) {
    return { estado: "configuracao_invalida" };
  }
  const candidatas = lidas.data.filter(
    (r) =>
      r.ativa &&
      r.origem === alvo.origem &&
      r.gatilho === alvo.gatilho &&
      (!alvo.automatico || r.modo === "automatico"),
  );
  if (candidatas.length === 0) return { estado: "sem_regra" };
  const prioridade = Math.max(...candidatas.map((r) => r.prioridade));
  const vencedoras = candidatas.filter((r) => r.prioridade === prioridade);
  if (vencedoras.length > 1) {
    return { estado: "conflito", regra_ids: vencedoras.map((r) => r.id).sort() };
  }
  return { estado: "selecionada", regra: vencedoras[0]! };
}
