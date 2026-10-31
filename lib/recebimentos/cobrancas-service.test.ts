// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn(async () => true) }));
vi.mock("./conexao-service", () => ({
  credencialValidadaSandbox: vi.fn(async () => ({
    id: "c5550000-0000-4000-8000-000000000001",
    revision: 2,
    chave: "$aact_hmlg_credencial_sintetica_sem_validade_1234",
  })),
}));
import { credencialValidadaSandbox } from "./conexao-service";
import { bancoRecebimentos } from "@/tests/helpers/recebimentos/banco";
import { criarCobranca, sincronizarCobranca } from "./cobrancas-service";
import type { ProvedorSandbox } from "./provedor-sandbox";
const ORG = "a5550000-0000-4000-8000-000000000001";
const CONTATO = "b5550000-0000-4000-8000-000000000001";
const OP = "d5550000-0000-4000-8000-000000000001";
const input = {
  contact_id: CONTATO,
  amount_cents: 12345,
  due_date: "2099-11-01",
  billing_type: "PIX",
  reason: "Teste avulso",
  documento: "52998224725",
};
const setup = () =>
  bancoRecebimentos({
    contacts: [
      {
        id: CONTATO,
        organization_id: ORG,
        name: "Pessoa Teste",
        is_anonymized: false,
        is_blocked: false,
        kind: "person",
      },
    ],
  });
function provedor() {
  const criar = vi.fn(async (p) => ({
    id: "pay_abc",
    customer: p.customer,
    value: p.amount_cents / 100,
    dueDate: p.due_date,
    externalReference: p.referencia,
    status: "PENDING",
    invoiceUrl: "https://sandbox.asaas.com/i/abc",
  }));
  return {
    cliente: vi.fn(async () => "cus_abc"),
    criar,
    localizar: vi.fn(async () => []),
    consultar: vi.fn(),
    cancelar: vi.fn(),
  } as unknown as ProvedorSandbox;
}
beforeEach(() => vi.clearAllMocks());
describe("intenção antes do efeito externo", () => {
  it("dois cliques concorrentes e replay geram só um POST", async () => {
    const b = setup();
    const p = provedor();
    const resultado = await Promise.all([
      criarCobranca(b.db, ORG, OP, input, p),
      criarCobranca(b.db, ORG, OP, input, p),
    ]);
    expect(resultado[0]!.id).toBe(resultado[1]!.id);
    expect(p.criar).toHaveBeenCalledTimes(1);
    expect((await criarCobranca(b.db, ORG, OP, input, p)).status).toBe("pendente");
    expect(p.criar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(resultado)).not.toMatch(/credential|52998224725|provider_customer_id/);
  });
  it("mesma chave com valor diferente recusa, sem novo POST", async () => {
    const b = setup();
    const p = provedor();
    await criarCobranca(b.db, ORG, OP, input, p);
    await expect(
      criarCobranca(b.db, ORG, OP, { ...input, amount_cents: 222 }, p),
    ).rejects.toMatchObject({ code: "recebimentos_conflict" });
    expect(p.criar).toHaveBeenCalledTimes(1);
  });
  it("resposta perdida vira indeterminada; consulta vazia nunca cria novamente", async () => {
    const b = setup();
    const p = provedor();
    vi.mocked(p.criar).mockRejectedValue(new Error("timeout"));
    const c = await criarCobranca(b.db, ORG, OP, input, p);
    expect(c.status).toBe("criacao_indeterminada");
    await criarCobranca(b.db, ORG, OP, input, p);
    expect((await sincronizarCobranca(b.db, ORG, c.id, p)).status).toBe("criacao_indeterminada");
    expect(p.criar).toHaveBeenCalledTimes(1);
  });
  it("recupera pagamento existente por referência sem emitir outro", async () => {
    const b = setup();
    const p = provedor();
    vi.mocked(p.criar).mockRejectedValue(new Error("timeout"));
    const c = await criarCobranca(b.db, ORG, OP, input, p);
    vi.mocked(p.localizar).mockResolvedValue([
      {
        id: "pay_abc",
        customer: "cus_abc",
        value: 123.45,
        dueDate: input.due_date,
        externalReference: `rcb_${c.id}`,
        status: "CONFIRMED",
        invoiceUrl: "https://sandbox.asaas.com/i/abc",
      },
    ]);
    expect((await sincronizarCobranca(b.db, ORG, c.id, p)).status).toBe("confirmada");
    expect(p.criar).toHaveBeenCalledTimes(1);
  });
  it("valor divergente ou duas cobranças não quitam a obrigação", async () => {
    const b = setup();
    const p = provedor();
    const c = await criarCobranca(b.db, ORG, OP, input, p);
    vi.mocked(p.consultar).mockResolvedValue({
      id: "pay_abc",
      customer: "cus_abc",
      value: 1,
      dueDate: input.due_date,
      externalReference: `rcb_${c.id}`,
      status: "RECEIVED",
      invoiceUrl: "https://sandbox.asaas.com/i/abc",
    });
    const r = await sincronizarCobranca(b.db, ORG, c.id, p);
    expect(r.status).toBe("revisao_manual");
    expect(r.invoice_url).toBeNull();
  });
  it("contato de outra empresa é recusado antes de credencial ou HTTP", async () => {
    const b = setup();
    const p = provedor();
    await expect(
      criarCobranca(b.db, "a5550000-0000-4000-8000-000000000002", OP, input, p),
    ).rejects.toMatchObject({ code: "recebimentos_invalid_source" });
    expect(p.cliente).not.toHaveBeenCalled();
    expect(credencialValidadaSandbox).not.toHaveBeenCalled();
    expect(b.consultas.every((q) => q.filtros.some(([k]) => k === "organization_id"))).toBe(true);
  });
});
