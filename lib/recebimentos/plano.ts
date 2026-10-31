/**
 * Prévia de recebimentos (§§4–5 da especificação de 30/10/2026).
 * Pura: não consulta o provedor, não persiste dívida e não envia mensagem.
 * A emissão real deverá recalcular estes valores sobre a origem autorizada
 * no servidor; o resultado de uma prévia nunca autoriza uma cobrança.
 */
import { z } from "zod";

const centavos = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const condicaoDeRecebimentoSchema = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("total") }),
  z.strictObject({ tipo: z.literal("sinal_fixo"), valor_cents: centavos }),
  z.strictObject({
    tipo: z.literal("sinal_percentual"),
    percentual_bps: z.number().int().min(1).max(10_000),
  }),
]);

export const simulacaoDeRecebimentoSchema = z.strictObject({
  total_cents: centavos,
  currency: z.literal("BRL").default("BRL"),
  condicao: condicaoDeRecebimentoSchema,
});

export type SimulacaoDeRecebimento = z.infer<typeof simulacaoDeRecebimentoSchema>;
export type CondicaoDeRecebimento = z.infer<typeof condicaoDeRecebimentoSchema>;

export interface EtapaDeRecebimento {
  etapa: "total" | "sinal" | "saldo";
  valor_cents: number;
}

export type ResultadoDaSimulacao =
  | {
      ok: true;
      simulacao: true;
      gera_cobranca: false;
      envia_mensagem: false;
      currency: "BRL";
      total_cents: number;
      etapas: EtapaDeRecebimento[];
    }
  | {
      ok: false;
      motivo: "dados_invalidos" | "sinal_maior_que_total" | "sinal_arredondado_para_zero";
    };

/**
 * Percentual em pontos-base. Meio centavo arredonda para cima uma única vez;
 * o saldo é a diferença, nunca um segundo arredondamento. BigInt evita erro
 * binário e overflow do produto mesmo no maior inteiro seguro do contrato.
 */
export function simularRecebimento(entrada: unknown): ResultadoDaSimulacao {
  const validado = simulacaoDeRecebimentoSchema.safeParse(entrada);
  if (!validado.success) return { ok: false, motivo: "dados_invalidos" };
  const { total_cents, condicao } = validado.data;
  let etapas: EtapaDeRecebimento[];
  if (condicao.tipo === "total") {
    etapas = [{ etapa: "total", valor_cents: total_cents }];
  } else {
    const sinal =
      condicao.tipo === "sinal_fixo"
        ? condicao.valor_cents
        : Number((BigInt(total_cents) * BigInt(condicao.percentual_bps) + 5_000n) / 10_000n);
    if (sinal > total_cents) return { ok: false, motivo: "sinal_maior_que_total" };
    if (sinal === 0) return { ok: false, motivo: "sinal_arredondado_para_zero" };
    etapas = [{ etapa: "sinal", valor_cents: sinal }];
    // Um sinal integral não cria obrigação de zero centavos para o saldo.
    if (sinal < total_cents) etapas.push({ etapa: "saldo", valor_cents: total_cents - sinal });
  }
  return {
    ok: true,
    simulacao: true,
    gera_cobranca: false,
    envia_mensagem: false,
    currency: "BRL",
    total_cents,
    etapas,
  };
}
