// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { autorizar, suporte } = vi.hoisted(() => ({ autorizar: vi.fn(), suporte: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: autorizar }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: suporte }));

import { POST } from "./route";

const ORG = "9c9d25be-4f1e-42c9-a6f2-14ac41d24b01";
const requisicao = (body: string) =>
  new Request("http://localhost/api/v1/recebimentos/simular", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": "teste-previa" },
    body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  autorizar.mockResolvedValue({ ok: true, org: { orgId: ORG }, user: { id: "gestor" } });
  suporte.mockResolvedValue(null);
});

describe("POST de prévia de recebimentos", () => {
  it("exige gestor autenticado e preserva a recusa do guard", async () => {
    const negada = Response.json({ error: { code: "forbidden_role" } }, { status: 403 });
    autorizar.mockResolvedValue({ ok: false, response: negada });
    expect(await POST(requisicao("{}"))).toBe(negada);
    expect(autorizar).toHaveBeenCalledWith("manager", {
      requestId: "teste-previa",
      resource: "recebimentos",
    });
    expect(suporte).not.toHaveBeenCalled();
  });

  it("suporte somente leitura não atravessa o POST", async () => {
    const negada = Response.json({}, { status: 403 });
    suporte.mockResolvedValue(negada);
    expect(await POST(requisicao("{}"))).toBe(negada);
    expect(suporte).toHaveBeenCalledWith(ORG);
  });

  it("retorna total e sinal/saldo sem dívida nem envio", async () => {
    const res = await POST(
      requisicao(
        JSON.stringify({
          total_cents: 100_000,
          condicao: { tipo: "sinal_percentual", percentual_bps: 3_000 },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBe("teste-previa");
    expect(await res.json()).toEqual({
      data: {
        ok: true,
        simulacao: true,
        gera_cobranca: false,
        envia_mensagem: false,
        currency: "BRL",
        total_cents: 100_000,
        etapas: [
          { etapa: "sinal", valor_cents: 30_000 },
          { etapa: "saldo", valor_cents: 70_000 },
        ],
      },
    });
  });

  it.each([
    { total_cents: -1, condicao: { tipo: "total" } },
    { total_cents: 100, condicao: { tipo: "sinal_fixo", valor_cents: 101 } },
    { total_cents: 100, condicao: { tipo: "total" }, organization_id: "tenant-externo" },
    { total_cents: 100, condicao: { tipo: "total" }, api_key: "segredo-ficticio" },
  ])("422 para corpo inválido, sem ecoar campos recebidos", async (input) => {
    const res = await POST(requisicao(JSON.stringify(input)));
    expect(res.status).toBe(422);
    const texto = await res.text();
    expect(texto).not.toContain("tenant-externo");
    expect(texto).not.toContain("segredo-ficticio");
  });

  it("400 para JSON malformado e 413 para corpo grande", async () => {
    expect((await POST(requisicao("{"))).status).toBe(400);
    expect((await POST(requisicao(JSON.stringify({ texto: "á".repeat(4_096) })))).status).toBe(413);
  });
});
