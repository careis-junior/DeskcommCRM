// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ConexaoService from "@/lib/recebimentos/conexao-service";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  support: vi.fn(),
  modulo: vi.fn(),
  ler: vi.fn(),
  salvar: vi.fn(),
  desativar: vi.fn(),
  testar: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.auth }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: m.support }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: m.modulo }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marcador: "admin" }) }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/recebimentos/conexao-service", async (original) => ({
  ...(await original<typeof ConexaoService>()),
  lerConexaoSandbox: m.ler,
  salvarConexaoSandbox: m.salvar,
  desativarConexaoSandbox: m.desativar,
  testarConexaoSandbox: m.testar,
}));
import { GET, PUT, PATCH } from "./route";
import { POST } from "./testar/route";
import { ConexaoRecebimentosError } from "@/lib/recebimentos/conexao-service";

const ORG = "a5550000-0000-4000-8000-000000000001";
const KEY = "$aact_hmlg_chave_sintetica_de_teste_1234";
const conexao = {
  id: "e5550000-0000-4000-8000-000000000001",
  ambiente: "sandbox",
  revision: 1,
  status: "nao_testada",
};
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/v1/recebimentos/conexao", {
    method,
    headers: { "content-type": "application/json", "X-Request-Id": "teste" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, user: { id: "admin" }, org: { orgId: ORG } });
  m.support.mockResolvedValue(null);
  m.modulo.mockResolvedValue(true);
  m.ler.mockResolvedValue(null);
  m.salvar.mockResolvedValue(conexao);
  m.desativar.mockResolvedValue({ ...conexao, status: "desativada", revision: 2 });
  m.testar.mockResolvedValue({ ...conexao, status: "validada", revision: 2 });
});

describe("API da conexão de recebimentos", () => {
  it.each([
    [GET, "GET"],
    [PUT, "PUT"],
    [PATCH, "PATCH"],
    [POST, "POST"],
  ] as const)("%s preserva a recusa de autorização", async (handler, method) => {
    const negado = Response.json({ error: { code: "forbidden_role" } }, { status: 403 });
    m.auth.mockResolvedValue({ ok: false, response: negado });
    expect(await handler(req(method))).toBe(negado);
    expect(m.auth).toHaveBeenCalledWith("admin", {
      requestId: "teste",
      resource: "recebimentos_conexoes",
    });
    expect(m.salvar).not.toHaveBeenCalled();
    expect(m.testar).not.toHaveBeenCalled();
  });
  it("suporte somente leitura não salva, testa nem desativa", async () => {
    m.support.mockResolvedValue(Response.json({}, { status: 403 }));
    for (const [handler, method] of [
      [PUT, "PUT"],
      [PATCH, "PATCH"],
      [POST, "POST"],
    ] as const) {
      expect((await handler(req(method, {}))).status).toBe(403);
    }
    expect(m.salvar).not.toHaveBeenCalled();
    expect(m.testar).not.toHaveBeenCalled();
    expect(m.desativar).not.toHaveBeenCalled();
  });
  it("módulo não instalado recusa a escrita", async () => {
    m.modulo.mockResolvedValue(false);
    const res = await PUT(req("PUT", { ambiente: "sandbox", api_key: KEY, expected_revision: 0 }));
    expect(res.status).toBe(404);
    expect(m.salvar).not.toHaveBeenCalled();
  });
  it("GET resolve a org no servidor e não recebe filtro de tenant do cliente", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(m.ler).toHaveBeenCalledWith({ marcador: "admin" }, ORG);
  });
  it("grava na empresa autorizada, com auditoria sem chave", async () => {
    const res = await PUT(req("PUT", { ambiente: "sandbox", api_key: KEY, expected_revision: 0 }));
    expect(res.status).toBe(200);
    expect(m.salvar).toHaveBeenCalledWith({ marcador: "admin" }, ORG, KEY, 0);
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recebimentos.connection_saved", organizationId: ORG }),
    );
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(KEY);
    expect(await res.text()).not.toContain(KEY);
  });
  it.each([
    { ambiente: "sandbox", api_key: KEY, expected_revision: 0, organization_id: "intruso" },
    { ambiente: "producao", api_key: KEY, expected_revision: 0 },
    { ambiente: "sandbox", api_key: KEY.replace("hmlg", "prod"), expected_revision: 0 },
  ])("recusa escopo externo ou chave de produção", async (body) => {
    expect((await PUT(req("PUT", body))).status).toBe(422);
    expect(m.salvar).not.toHaveBeenCalled();
  });
  it("corpo acima do limite não chega ao serviço", async () => {
    expect((await PUT(req("PUT", { api_key: "x".repeat(7000) }))).status).toBe(400);
    expect(m.salvar).not.toHaveBeenCalled();
  });
  it("teste recebe só revisão, resolve a org e audita o resultado seguro", async () => {
    const res = await POST(req("POST", { expected_revision: 1 }));
    expect(res.status).toBe(200);
    expect(m.testar).toHaveBeenCalledWith({ marcador: "admin" }, ORG, 1);
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recebimentos.connection_tested" }),
    );
  });
  it("conflito de revisão não vira 500 nem audita uma alteração inexistente", async () => {
    m.desativar.mockRejectedValue(
      new ConexaoRecebimentosError("recebimentos_revision_conflict", 409),
    );
    expect((await PATCH(req("PATCH", { expected_revision: 1 }))).status).toBe(409);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
