import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
import { apiClient } from "@/lib/api/client";
import { CobrancasDeRecebimentos } from "./_cobrancas";
const C = "b5610000-0000-4000-8000-000000000001";
const A = "a5610000-0000-4000-8000-000000000001";
const V = "d5610000-0000-4000-8000-000000000001";
const row = {
  id: A,
  contact_id: C,
  appointment_id: null,
  amount_cents: 1000,
  currency: "BRL",
  due_date: "2099-11-01",
  reason: "Teste",
  status: "pendente",
  invoice_url: "https://sandbox.asaas.com/i/teste",
  send_state: "nao_enviada",
  diagnostic: null,
};
let rows: unknown[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.endsWith("/cobrancas")) return { data: { cobrancas: rows } };
    if (url.includes("contact_id="))
      return {
        data: { agendamentos: [], conversas: [{ id: V, created_at: "2026-10-31T00:00:00Z" }] },
      };
    return { data: { contatos: [{ id: C, name: "Pagador de teste", display_name: null }] } };
  });
});
function tela(podeEditar = true) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <CobrancasDeRecebimentos orgId={A} podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
  return cache;
}
describe("formulário e prévia de cobrança", () => {
  it("emite centavos, limpa documento e só envia depois da escolha de conversa e prévia", async () => {
    vi.mocked(apiClient.post).mockImplementation(async (url: string) => {
      rows = [row];
      return {
        data: {
          cobranca: { ...row, send_state: url.endsWith("/enviar") ? "sent" : "nao_enviada" },
        },
      };
    });
    const cache = tela();
    await screen.findByRole("option", { name: "Pagador de teste" });
    fireEvent.change(screen.getByLabelText("Pagador"), { target: { value: C } });
    fireEvent.change(screen.getByLabelText("Valor em reais"), { target: { value: "10,00" } });
    fireEvent.change(screen.getByLabelText("CPF ou CNPJ fictício do pagador"), {
      target: { value: "52998224725" },
    });
    fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: "2099-11-01" } });
    fireEvent.change(screen.getByLabelText("Motivo interno da cobrança"), {
      target: { value: "Teste avulso" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gerar cobrança de teste" }));
    await waitFor(() =>
      expect(screen.getByLabelText("CPF ou CNPJ fictício do pagador")).toHaveValue(""),
    );
    expect(vi.mocked(apiClient.post).mock.calls[0]![1]).toMatchObject({
      contact_id: C,
      amount_cents: 1000,
      documento: "52998224725",
    });
    expect(
      JSON.stringify(
        cache
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("52998224725");
    fireEvent.click(await screen.findByRole("button", { name: "Preparar envio pelo WhatsApp" }));
    const enviar = await screen.findByRole("button", {
      name: "Enviar link de teste pelo WhatsApp",
    });
    expect(enviar).toBeDisabled();
    expect(vi.mocked(apiClient.post).mock.calls.length).toBe(1);
    expect(screen.getByText(/\[TESTE — sem valor financeiro\]/)).toBeVisible();
    await screen.findByRole("option", { name: /Conversa 1/ });
    fireEvent.change(screen.getByLabelText("Conversa do pagador"), { target: { value: V } });
    fireEvent.click(enviar);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiClient.post).mock.calls[1]![1]).toEqual({ conversation_id: V });
  });
  it("sessão de suporte não consegue emitir", async () => {
    tela(false);
    expect(screen.getByRole("button", { name: "Gerar cobrança de teste" })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
