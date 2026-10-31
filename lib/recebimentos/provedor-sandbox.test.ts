// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { provedorSandbox, ProvedorSandboxError } from "./provedor-sandbox";
const KEY = "$aact_hmlg_credencial_sintetica_sem_validade_1234";
const p = {
  customer: "cus_abc",
  amount_cents: 12345,
  due_date: "2026-11-01",
  billing_type: "PIX",
  referencia: "rcb_abc",
};
const pagamento = {
  id: "pay_abc",
  customer: "cus_abc",
  value: 123.45,
  dueDate: p.due_date,
  externalReference: p.referencia,
  status: "PENDING",
  invoiceUrl: "https://sandbox.asaas.com/i/abc",
};
describe("transporte de cobrança separado do revendedor", () => {
  it("recusa chave de produção antes de qualquer HTTP", () => {
    const f = vi.fn();
    expect(() => provedorSandbox(KEY.replace("hmlg", "prod"), f)).toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("converte centavos apenas na borda e fixa destino/header/descrição neutra", async () => {
    const f = vi.fn(async () => Response.json(pagamento));
    await provedorSandbox(KEY, f).criar(p);
    const [url, opts] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect(opts.redirect).toBe("error");
    expect(opts.headers).toMatchObject({ access_token: KEY });
    expect(JSON.parse(opts.body as string)).toEqual({
      customer: "cus_abc",
      value: 123.45,
      dueDate: p.due_date,
      billingType: "PIX",
      externalReference: p.referencia,
      description: "Cobrança de teste",
    });
  });
  it("jamais repete POST com resposta perdida ou 5xx", async () => {
    for (const f of [
      vi.fn(async () => {
        throw new Error("network");
      }),
      vi.fn(async () => new Response("bad gateway", { status: 502 })),
    ]) {
      await expect(provedorSandbox(KEY, f).criar(p)).rejects.toMatchObject({ ambiguo: true });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("não expõe resposta do provedor ou link fora do Sandbox", async () => {
    const f = vi.fn(async () =>
      Response.json({ ...pagamento, invoiceUrl: "https://evil.test/i/foo" }),
    );
    await expect(provedorSandbox(KEY, f).criar(p)).rejects.toBeInstanceOf(ProvedorSandboxError);
    const erro = await provedorSandbox(
      KEY,
      vi.fn(async () => new Response(JSON.stringify({ documento: "secreto" }), { status: 400 })),
    )
      .criar(p)
      .catch((e: Error) => e);
    expect(String(erro)).not.toContain("secreto");
  });
  it("cria pagador isolado sem notificação paralela e não reutiliza CPF divergente", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [], hasMore: false }))
      .mockResolvedValueOnce(Response.json({ id: "cus_abc" }));
    await provedorSandbox(KEY, f).cliente({
      referencia: "rcp_empresa_contato",
      nome: "Teste",
      documento: "52998224725",
    });
    expect(JSON.parse(f.mock.calls[1]![1].body)).toMatchObject({
      notificationDisabled: true,
      cpfCnpj: "52998224725",
      externalReference: "rcp_empresa_contato",
    });
    const divergente = vi.fn(async () =>
      Response.json({ data: [{ id: "cus_abc", cpfCnpj: "outro" }] }),
    );
    await expect(
      provedorSandbox(KEY, divergente).cliente({
        referencia: "ref",
        nome: "Teste",
        documento: "52998224725",
      }),
    ).rejects.toThrow();
    expect(divergente).toHaveBeenCalledTimes(1);
  });
});
