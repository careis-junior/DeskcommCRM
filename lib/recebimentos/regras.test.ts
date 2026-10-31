import { describe, expect, it } from "vitest";

import {
  regraDeRecebimentoSchema,
  selecionarRegraDeRecebimento,
  type RegraDeRecebimento,
} from "./regras";

const A = "9c9d25be-4f1e-42c9-a6f2-14ac41d24b01";
const B = "9c9d25be-4f1e-42c9-a6f2-14ac41d24b02";
const alvo = { origem: "agendamento", gatilho: "reserva_concluida", automatico: true } as const;
const regra = (extra: Partial<RegraDeRecebimento> = {}): RegraDeRecebimento => ({
  id: A,
  origem: "agendamento",
  gatilho: "reserva_concluida",
  ativa: true,
  modo: "automatico",
  prioridade: 0,
  condicao: { tipo: "total" },
  ...extra,
});

describe("seleção da regra de recebimentos", () => {
  it("configuração nova nasce desligada e manual", () => {
    expect(
      regraDeRecebimentoSchema.parse({
        id: A,
        origem: "agendamento",
        gatilho: "manual",
        condicao: { tipo: "total" },
      }),
    ).toMatchObject({ ativa: false, modo: "manual", prioridade: 0 });
  });
  it("a maior prioridade vence independentemente da ordem", () => {
    const regras = [regra(), regra({ id: B, prioridade: 10 })];
    for (const lista of [regras, [...regras].reverse()]) {
      expect(selecionarRegraDeRecebimento(lista, alvo)).toMatchObject({
        estado: "selecionada",
        regra: { id: B },
      });
    }
  });
  it("empate bloqueia: não desempata por ordem ou por ID", () => {
    expect(selecionarRegraDeRecebimento([regra({ id: B }), regra()], alvo)).toEqual({
      estado: "conflito",
      regra_ids: [A, B],
    });
  });
  it.each([
    { ativa: false },
    { modo: "manual" },
    { origem: "pedido" },
    { gatilho: "manual" },
  ] as Partial<RegraDeRecebimento>[])("não executa regra incompatível %j", (extra) => {
    expect(selecionarRegraDeRecebimento([regra(extra)], alvo)).toEqual({ estado: "sem_regra" });
  });
  it("modo manual pode ser escolhido em solicitação humana", () => {
    expect(
      selecionarRegraDeRecebimento([regra({ modo: "manual" })], { ...alvo, automatico: false }),
    ).toMatchObject({ estado: "selecionada" });
  });
  it("lista vazia não aciona cobrança", () => {
    expect(selecionarRegraDeRecebimento([], alvo)).toEqual({ estado: "sem_regra" });
  });
  it("configuração inválida não cai silenciosamente em outra regra", () => {
    expect(
      selecionarRegraDeRecebimento([regra(), regra({ id: B, prioridade: NaN })], alvo),
    ).toEqual({ estado: "configuracao_invalida" });
    expect(selecionarRegraDeRecebimento([regra(), regra()], alvo)).toEqual({
      estado: "configuracao_invalida",
    });
  });
});
