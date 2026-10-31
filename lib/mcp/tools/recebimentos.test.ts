// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { McpContext } from "../types";
vi.mock("@/lib/recebimentos/cobrancas-service", () => ({
  exigirModulo: vi.fn(async () => {}),
  listarCobrancas: vi.fn(async () => []),
  lerLinha: vi.fn(),
  provedorDaCobranca: vi.fn(),
  referenciaDaCobranca: (id: string) => `rcb_${id}`,
}));
import {
  exigirModulo,
  listarCobrancas,
  lerLinha,
  provedorDaCobranca,
} from "@/lib/recebimentos/cobrancas-service";
import { crmConsultarRecebimentos } from "./recebimentos";
const C = "b5610000-0000-4000-8000-000000000001";
const ctx = {
  organizationId: "a5610000-0000-4000-8000-000000000001",
  contatoDoTurno: C,
  supabase: {},
} as McpContext;
beforeEach(() => vi.clearAllMocks());
it("contato diferente do turno é recusado antes de qualquer consulta", async () => {
  expect(
    await crmConsultarRecebimentos.handler(
      { contact_id: "b5610000-0000-4000-8000-000000000002" },
      ctx,
    ),
  ).toEqual({ permitido: false, motivo: "fora_da_conversa" });
  expect(exigirModulo).not.toHaveBeenCalled();
  expect(listarCobrancas).not.toHaveBeenCalled();
});
it("nunca entrega link pago ou dados privados ao agente", async () => {
  const row = {
    id: C,
    contact_id: C,
    amount_cents: 1000,
    due_date: "2099-11-01",
    currency: "BRL",
    status: "pendente",
    invoice_url: "https://sandbox.asaas.com/i/teste",
    reason: "observação clínica",
    provider_customer_id: "cus_abc",
    provider_payment_id: "pay_abc",
  };
  vi.mocked(listarCobrancas).mockResolvedValue([row as never]);
  vi.mocked(lerLinha).mockResolvedValue(row as never);
  vi.mocked(provedorDaCobranca).mockResolvedValue({
    consultar: vi.fn(async () => ({
      id: "pay_abc",
      customer: "cus_abc",
      value: 10,
      dueDate: row.due_date,
      externalReference: `rcb_${C}`,
      status: "CONFIRMED",
      invoiceUrl: row.invoice_url,
    })),
  } as never);
  const r = await crmConsultarRecebimentos.handler({ contact_id: C }, ctx);
  expect(r).toMatchObject({
    somente_teste: true,
    cobrancas: [{ situacao: "confirmada", link_pagamento: null }],
  });
  expect(JSON.stringify(r)).not.toMatch(/clínica|cus_abc|pay_abc/);
  expect(listarCobrancas).toHaveBeenCalledWith(ctx.supabase, ctx.organizationId, C);
});
