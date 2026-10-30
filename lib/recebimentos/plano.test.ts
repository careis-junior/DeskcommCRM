import { describe, expect, it } from "vitest";

import { simularRecebimento } from "./plano";

describe("prévia de recebimentos em centavos", () => {
  it("consulta de R$1.000: cobra o total em uma etapa na prévia", () => {
    expect(simularRecebimento({ total_cents: 100_000, condicao: { tipo: "total" } })).toEqual({
      ok: true,
      simulacao: true,
      gera_cobranca: false,
      envia_mensagem: false,
      currency: "BRL",
      total_cents: 100_000,
      etapas: [{ etapa: "total", valor_cents: 100_000 }],
    });
  });

  it.each([
    { tipo: "sinal_fixo", valor_cents: 30_000 },
    { tipo: "sinal_percentual", percentual_bps: 3_000 },
  ])("oficina: R$300 de sinal e R$700 de saldo (%j)", (condicao) => {
    const r = simularRecebimento({ total_cents: 100_000, condicao });
    expect(r.ok && r.etapas).toEqual([
      { etapa: "sinal", valor_cents: 30_000 },
      { etapa: "saldo", valor_cents: 70_000 },
    ]);
  });

  it("meio centavo arredonda para cima; o saldo guarda o total", () => {
    const r = simularRecebimento({
      total_cents: 101,
      condicao: { tipo: "sinal_percentual", percentual_bps: 5_000 },
    });
    expect(r.ok && r.etapas.map((e) => e.valor_cents)).toEqual([51, 50]);
  });

  it("sinal integral não cria cobrança de saldo zero", () => {
    const r = simularRecebimento({
      total_cents: 25_000,
      condicao: { tipo: "sinal_percentual", percentual_bps: 10_000 },
    });
    expect(r.ok && r.etapas).toEqual([{ etapa: "sinal", valor_cents: 25_000 }]);
  });

  it.each([0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10000"])(
    "recusa total inválido %s",
    (total_cents) => {
      expect(simularRecebimento({ total_cents, condicao: { tipo: "total" } })).toEqual({
        ok: false,
        motivo: "dados_invalidos",
      });
    },
  );

  it.each([0, -1, 10_001, 1.5])("recusa pontos-base inválidos %s", (percentual_bps) => {
    expect(
      simularRecebimento({
        total_cents: 100,
        condicao: { tipo: "sinal_percentual", percentual_bps },
      }).ok,
    ).toBe(false);
  });

  it("não aceita metadados de autoridade nem moeda diferente no input", () => {
    for (const extra of [
      { organization_id: "outro-tenant" },
      { currency: "USD" },
      { provider_payment_id: "pay_falso" },
    ]) {
      expect(
        simularRecebimento({ total_cents: 100, condicao: { tipo: "total" }, ...extra }).ok,
      ).toBe(false);
    }
  });

  it("recusa sinal maior que o total e sinal arredondado para zero", () => {
    expect(
      simularRecebimento({ total_cents: 100, condicao: { tipo: "sinal_fixo", valor_cents: 101 } }),
    ).toEqual({ ok: false, motivo: "sinal_maior_que_total" });
    expect(
      simularRecebimento({
        total_cents: 1,
        condicao: { tipo: "sinal_percentual", percentual_bps: 1 },
      }),
    ).toEqual({ ok: false, motivo: "sinal_arredondado_para_zero" });
  });

  it("mantém sinal + saldo = total, inclusive nos limites seguros", () => {
    for (const total_cents of [1, 3, 99, 101, 25_000, 100_000, 999_999, Number.MAX_SAFE_INTEGER]) {
      for (const percentual_bps of [1, 123, 3_333, 5_000, 9_999, 10_000]) {
        const r = simularRecebimento({
          total_cents,
          condicao: { tipo: "sinal_percentual", percentual_bps },
        });
        if (!r.ok) {
          expect(r.motivo).toBe("sinal_arredondado_para_zero");
          continue;
        }
        expect(r.etapas.reduce((s, e) => s + e.valor_cents, 0)).toBe(total_cents);
        expect(
          r.etapas.every((e) => Number.isSafeInteger(e.valor_cents) && e.valor_cents > 0),
        ).toBe(true);
      }
    }
  });
});
