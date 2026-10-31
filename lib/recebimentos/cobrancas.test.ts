import { describe, expect, it } from "vitest";
import {
  criarCobrancaSchema,
  linkSandboxSeguro,
  estadoDoPagamento,
  cobrancaPodeSerEnviada,
} from "./cobrancas";
const input = {
  contact_id: "c5550000-0000-4000-8000-000000000001",
  amount_cents: 1000,
  due_date: "2026-11-01",
  billing_type: "PIX",
  reason: "Teste interno",
  documento: "52998224725",
};
describe("contrato de cobrança Sandbox", () => {
  it("recusa centavos fracionados, CPF inválido, data impossível e autoridade no corpo", () => {
    expect(criarCobrancaSchema.safeParse(input).success).toBe(true);
    for (const extra of [
      { amount_cents: 1.5 },
      { amount_cents: 0 },
      { documento: "11111111111" },
      { due_date: "2026-02-30" },
      { organization_id: input.contact_id },
      { api_key: "segredo" },
    ])
      expect(criarCobrancaSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it("só aceita a fatura hospedada do Sandbox, sem credencial ou domínio semelhante", () => {
    expect(linkSandboxSeguro("https://sandbox.asaas.com/i/abc123")).toBe(
      "https://sandbox.asaas.com/i/abc123",
    );
    for (const url of [
      "https://www.asaas.com/i/abc",
      "http://sandbox.asaas.com/i/abc",
      "https://sandbox.asaas.com.evil.test/i/abc",
      "https://segredo@sandbox.asaas.com/i/abc",
      "https://sandbox.asaas.com:444/i/abc",
      "javascript:alert(1)",
      "https://sandbox.asaas.com/other",
    ])
      expect(linkSandboxSeguro(url)).toBeNull();
  });
  it("não confunde confirmação, liquidação e reversão", () => {
    expect(estadoDoPagamento("CONFIRMED")).toBe("confirmada");
    expect(estadoDoPagamento("RECEIVED")).toBe("recebida");
    for (const s of [
      "REFUNDED",
      "REFUND_IN_PROGRESS",
      "CHARGEBACK_REQUESTED",
      "CHARGEBACK_DISPUTE",
    ])
      expect(estadoDoPagamento(s)).toBe("revertida");
    expect(estadoDoPagamento("STATUS_FUTURO")).toBe("revisao_manual");
    expect(
      cobrancaPodeSerEnviada({
        status: "confirmada",
        invoice_url: "https://sandbox.asaas.com/i/abc",
      }),
    ).toBe(false);
  });
});
