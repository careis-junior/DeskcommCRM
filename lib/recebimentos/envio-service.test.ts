// @vitest-environment node
import type * as CobrancasService from "./cobrancas-service";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn(async () => true) }));
vi.mock("@/lib/automation/janela-do-canal", () => ({
  adiarAteAJanelaAbrir: vi.fn(async () => null),
}));
vi.mock("@/lib/automation/throttle", () => ({
  checkDailyLimit: vi.fn(async () => ({ allowed: true })),
  espacarEnvio: vi.fn(async () => {}),
}));
vi.mock("@/app/api/v1/messages/_handler", () => ({
  sendMessageHandler: vi.fn(async () => ({ status: "sent" })),
}));
vi.mock("./cobrancas-service", async (importOriginal) => ({
  ...(await importOriginal<typeof CobrancasService>()),
  sincronizarCobranca: vi.fn(async () => ({})),
}));
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { bancoRecebimentos } from "@/tests/helpers/recebimentos/banco";
import { enviarCobranca } from "./envio-service";
const ORG = "a5550000-0000-4000-8000-000000000001";
const CONTATO = "b5550000-0000-4000-8000-000000000001";
const ID = "c5550000-0000-4000-8000-000000000001";
const CONVERSA = "d5550000-0000-4000-8000-000000000001";
const OP = "e5550000-0000-4000-8000-000000000001";
const ctx = { organization_id: ORG, actor: { type: "user" as const, id: ID }, requestId: "teste" };
function setup(status = "pendente", contact = CONTATO) {
  return bancoRecebimentos({
    recebimentos_cobrancas: [
      {
        id: ID,
        organization_id: ORG,
        connection_id: ID,
        credential_fingerprint: createHash("sha256").update("key").digest("hex"),
        operation_id: OP,
        request_hash: "hash",
        contact_id: CONTATO,
        appointment_id: null,
        amount_cents: 1000,
        currency: "BRL",
        due_date: "2099-11-01",
        billing_type: "PIX",
        reason: "Motivo privado da clínica",
        status,
        provider_customer_id: "cus_abc",
        provider_payment_id: "pay_abc",
        provider_status: "PENDING",
        invoice_url: "https://sandbox.asaas.com/i/abc",
        diagnostic: null,
        revision: 1,
        send_state: "nao_enviada",
        send_operation_id: null,
        message_id: null,
        conversation_id: null,
        send_requested_at: null,
        created_at: "2026-10-31T00:00:00Z",
        updated_at: "2026-10-31T00:00:00Z",
      },
    ],
    conversations: [
      {
        id: CONVERSA,
        organization_id: ORG,
        contact_id: contact,
        channel_session_id: ID,
        is_group: false,
      },
    ],
  });
}
beforeEach(() => vi.clearAllMocks());
describe("envio idempotente e restrito ao pagador", () => {
  it("empresa suspensa falha sem envio e preserva a possibilidade de ação humana após reativar", async () => {
    const b = setup(); vi.mocked(sendMessageHandler).mockRejectedValueOnce(new OrgNaoOperanteError(ORG, "suspended"));
    await expect(enviarCobranca(b.db, ctx, ID, OP, CONVERSA)).rejects.toBeInstanceOf(OrgNaoOperanteError);
    expect(b.tabelas.recebimentos_cobrancas![0]!.send_state).toBe("failed");
  });
  it("duas requisições concorrentes usam uma única mensagem pela porta nativa", async () => {
    const b = setup();
    const resultados = await Promise.allSettled([
      enviarCobranca(b.db, ctx, ID, OP, CONVERSA),
      enviarCobranca(b.db, ctx, ID, OP, CONVERSA),
    ]);
    expect(resultados.some((r) => r.status === "fulfilled")).toBe(true);
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
    const chamada = vi.mocked(sendMessageHandler).mock.calls[0]!;
    expect(chamada[1].internalMessageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(chamada[2].body).toContain("[TESTE");
    expect(chamada[2].body).not.toContain("clínica");
    await enviarCobranca(b.db, ctx, ID, OP, CONVERSA);
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });
  it("não envia cobrança paga nem para conversa de outro contato", async () => {
    for (const b of [setup("confirmada"), setup("pendente", ID)])
      await expect(enviarCobranca(b.db, ctx, ID, OP, CONVERSA)).rejects.toThrow();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
  it("falha ambígua do canal exige revisão e bloqueia novo envio", async () => {
    const b = setup();
    vi.mocked(sendMessageHandler).mockRejectedValueOnce(new Error("resposta perdida"));
    expect((await enviarCobranca(b.db, ctx, ID, OP, CONVERSA)).send_state).toBe("revisao_manual");
    await expect(
      enviarCobranca(b.db, ctx, ID, "f5550000-0000-4000-8000-000000000001", CONVERSA),
    ).rejects.toThrow();
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
  });
});
