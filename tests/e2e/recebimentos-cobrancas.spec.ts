import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

/** Contrato da tela em app real com login real. Pagamentos/canal são dublês:
 * transporte, persistência e RLS têm provas independentes; esta spec não
 * afirma emissão real nem entrega no WhatsApp de uma pessoa. */
test("cobrança de teste tem prévia, pagador e conversa antes de enviar", async ({ page }, info) => {
  await loginComoDono(page, lerCreds());
  await page.goto("/admin/modulos");
  const instalar = page.getByTestId("instalar-recebimentos");
  if (await instalar.isVisible()) await instalar.click();
  await expect(page.getByTestId("modulo-recebimentos").getByText(/instalado/i)).toBeVisible();
  const contato = "b5610000-0000-4000-8000-000000000001";
  const conversa = "d5610000-0000-4000-8000-000000000001";
  const row = {
    id: "a5610000-0000-4000-8000-000000000001",
    contact_id: contato,
    appointment_id: null,
    amount_cents: 1000,
    currency: "BRL",
    due_date: "2099-11-01",
    billing_type: "PIX",
    reason: "Teste avulso",
    status: "pendente",
    invoice_url: "https://sandbox.asaas.com/i/teste",
    send_state: "nao_enviada",
    diagnostic: null,
  };
  let criada = false;
  let enviados = 0;
  await page.route("**/api/v1/recebimentos/opcoes**", async (route) => {
    const data = route.request().url().includes("contact_id=")
      ? { agendamentos: [], conversas: [{ id: conversa, created_at: "2026-10-31T00:00:00Z" }] }
      : { contatos: [{ id: contato, name: "Pagador fictício", display_name: null }] };
    await route.fulfill({ json: { data } });
  });
  await page.route("**/api/v1/recebimentos/cobrancas**", async (route) => {
    const req = route.request();
    if (req.method() === "GET")
      return route.fulfill({ json: { data: { cobrancas: criada ? [row] : [] } } });
    expect(req.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    if (req.url().endsWith("/enviar")) {
      enviados++;
      expect(req.postDataJSON()).toEqual({ conversation_id: conversa });
      return route.fulfill({ json: { data: { cobranca: { ...row, send_state: "sent" } } } });
    }
    expect(req.postDataJSON()).toMatchObject({
      contact_id: contato,
      amount_cents: 1000,
      documento: "52998224725",
    });
    criada = true;
    await route.fulfill({ json: { data: { cobranca: row } } });
  });
  await page.goto("/app/settings/recebimentos");
  await page.getByLabel("Pagador", { exact: true }).selectOption(contato);
  await page.getByLabel("Valor em reais").fill("10,00");
  await page.getByLabel("CPF ou CNPJ fictício do pagador").fill("52998224725");
  await page.getByLabel("Vencimento", { exact: true }).fill("2099-11-01");
  await page.getByLabel("Motivo interno da cobrança").fill("Teste avulso");
  await page.getByRole("button", { name: "Gerar cobrança de teste", exact: true }).click();
  await expect(page.getByLabel("CPF ou CNPJ fictício do pagador")).toHaveValue("");
  await page.getByRole("button", { name: "Preparar envio pelo WhatsApp", exact: true }).click();
  const enviar = page.getByRole("button", {
    name: "Enviar link de teste pelo WhatsApp",
    exact: true,
  });
  await expect(enviar).toBeDisabled();
  expect(enviados).toBe(0);
  await expect(page.getByText(/\[TESTE — sem valor financeiro\]/)).toBeVisible();
  await page.getByLabel("Conversa do pagador").selectOption(conversa);
  await info.attach("previa-do-link-de-teste", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await enviar.click();
  await expect(page.getByText("Situação do envio: sent", { exact: true })).toBeVisible();
  expect(enviados).toBe(1);
});
