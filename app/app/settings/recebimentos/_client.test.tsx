import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
import { ConexaoDeRecebimentos } from "./_client";

const KEY = "$aact_hmlg_chave_sintetica_de_teste_1234";
const row = {
  id: "e5550000-0000-4000-8000-000000000001",
  provider: "asaas",
  ambiente: "sandbox",
  status: "nao_testada",
  credential_last4: "1234",
  revision: 1,
  validated_at: null,
  tested_at: null,
  updated_at: "2026-10-31T00:00:00Z",
};
function montar(podeEditar = true) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <ConexaoDeRecebimentos orgId="empresa-a" podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { conexao: null } });
  api.put.mockResolvedValue({ data: { conexao: row } });
  api.post.mockResolvedValue({ data: { conexao: { ...row, status: "validada", revision: 2 } } });
});
describe("tela da conexão Sandbox", () => {
  it("salva com a revisão vista, limpa o input e não coloca o segredo no cache", async () => {
    const cache = montar();
    await screen.findByText("Nenhuma chave cadastrada nesta empresa.");
    const input = screen.getByLabelText("Chave de API do Sandbox");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar chave" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(api.put).toHaveBeenCalledWith("/api/v1/recebimentos/conexao", {
      ambiente: "sandbox",
      api_key: KEY,
      expected_revision: 0,
    });
    expect(
      JSON.stringify(cache.getQueryData(["recebimentos", "conexao", "empresa-a"])),
    ).not.toContain(KEY);
    expect(cache.getMutationCache().getAll()).toHaveLength(0);
  });
  it("não libera salvar uma chave de produção", async () => {
    montar();
    await screen.findByText("Nenhuma chave cadastrada nesta empresa.");
    fireEvent.change(screen.getByLabelText("Chave de API do Sandbox"), {
      target: { value: KEY.replace("hmlg", "prod") },
    });
    expect(screen.getByRole("button", { name: "Salvar chave" })).toBeDisabled();
  });
  it("testa a conexão cadastrada enviando somente a revisão", async () => {
    api.get.mockResolvedValue({ data: { conexao: row } });
    montar();
    const button = await screen.findByRole("button", { name: "Testar conexão" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/recebimentos/conexao/testar",
        { expected_revision: 1 },
        { timeoutMs: 90_000 },
      ),
    );
    await screen.findAllByText("Acesso ao Sandbox verificado. Nenhuma cobrança foi criada.");
  });
  it("sessão de suporte não altera a chave", async () => {
    montar(false);
    await screen.findByText("Nenhuma chave cadastrada nesta empresa.");
    expect(screen.getByLabelText("Chave de API do Sandbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar chave" })).toBeDisabled();
  });
});
