import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

/** Instalação e gravação REAIS; nenhuma chamada ao Asaas, nem chave real. */
test.describe("Recebimentos: conexão Sandbox pela tela", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  });
  test("instala, salva chave sintética cifrada e relê somente os metadados", async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/admin/modulos");
    const card = page.getByTestId("modulo-recebimentos");
    const instalar = page.getByTestId("instalar-recebimentos");
    if (await instalar.isVisible()) await instalar.click();
    await expect(card.getByText(/instalado/i)).toBeVisible({ timeout: 30_000 });
    await page.goto("/app/settings");
    await page.locator('a[href="/app/settings/recebimentos"]').click();
    await expect(page.getByRole("heading", { name: "Recebimentos", exact: true })).toBeVisible();
    const input = page.getByLabel("Chave de API do Sandbox");
    const salvar = page.getByRole("button", { name: "Salvar chave", exact: true });
    await expect(input).toBeEnabled();
    await input.fill("$aact_prod_chave_sintetica_nao_valida_1234");
    await expect(salvar).toBeDisabled();
    const sintetica = "$aact_hmlg_chave_sintetica_nao_valida_1234";
    await input.fill(sintetica);
    const resposta = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/recebimentos/conexao") && r.request().method() === "PUT",
    );
    await salvar.click();
    const gravado = await resposta;
    expect(gravado.status()).toBe(200);
    const dados = await gravado.json();
    expect(dados.data.conexao.status).toBe("nao_testada");
    expect(JSON.stringify(dados)).not.toContain(sintetica);
    expect(JSON.stringify(dados)).not.toContain("credential_ciphertext");
    await expect(input).toHaveValue("");
    await page.reload();
    await expect(page.getByText(/Final da chave:/)).toContainText("1234");
    await expect(input).toHaveValue("");
    await info.attach("conexao-sandbox-salva", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    // Não clicar Testar: a chave é sintética. O transporte é medido nos
    // testes do adaptador e a homologação real depende da chave do operador.
  });
});
