"use client";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { randomId } from "@/lib/random-id";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import {
  cobrancaPodeSerEnviada,
  MENSAGENS_COBRANCA,
  MENSAGENS_ENVIO,
  mensagemDaCobranca,
  type CobrancaPublica,
} from "@/lib/recebimentos/cobrancas";

type Contato = { id: string; name: string | null; display_name: string | null };
type Opcoes = {
  agendamentos: Array<{ id: string; nome: string; starts_at: string; amount_cents: number | null }>;
  conversas: Array<{ id: string; created_at: string }>;
};
const URL_BASE = "/api/v1/recebimentos";
const estiloSelect = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const dinheiro = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);

export function CobrancasDeRecebimentos({
  orgId,
  podeEditar,
}: {
  orgId: string;
  podeEditar: boolean;
}) {
  const t = useT();
  const cache = useQueryClient();
  const [contato, setContato] = useState("");
  const [agendamento, setAgendamento] = useState("");
  const [valor, setValor] = useState("");
  const [documento, setDocumento] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [motivo, setMotivo] = useState("");
  const [meio, setMeio] = useState("UNDEFINED");
  const [operacao, setOperacao] = useState(() => randomId());
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [previa, setPrevia] = useState<CobrancaPublica | null>(null);
  const [conversa, setConversa] = useState("");
  const [operacaoEnvio, setOperacaoEnvio] = useState(() => randomId());
  const key = ["recebimentos", "cobrancas", orgId];
  const cobrancas = useQuery({
    queryKey: key,
    queryFn: () =>
      apiClient.get<{ data: { cobrancas: CobrancaPublica[] } }>(`${URL_BASE}/cobrancas`),
    retry: false,
  });
  const contatos = useQuery({
    queryKey: ["recebimentos", "contatos", orgId],
    queryFn: () => apiClient.get<{ data: { contatos: Contato[] } }>(`${URL_BASE}/opcoes`),
    retry: false,
  });
  const opcoes = useQuery({
    queryKey: ["recebimentos", "opcoes", orgId, contato],
    queryFn: () => apiClient.get<{ data: Opcoes }>(`${URL_BASE}/opcoes?contact_id=${contato}`),
    enabled: !!contato,
    retry: false,
  });
  const envioOpcoes = useQuery({
    queryKey: ["recebimentos", "opcoes", orgId, previa?.contact_id],
    queryFn: () =>
      apiClient.get<{ data: Opcoes }>(`${URL_BASE}/opcoes?contact_id=${previa!.contact_id}`),
    enabled: !!previa,
    retry: false,
  });
  const bloqueado = !podeEditar || ocupado;
  const nome = (id: string) => {
    const c = contatos.data?.data.contatos.find((v) => v.id === id);
    return nomeDoContato(c) ?? t("Sem nome");
  };
  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    if (bloqueado) return;
    setOcupado(true);
    setAviso("");
    try {
      const cents = /^\d+([.,]\d{1,2})?$/.test(valor)
        ? Math.round(Number(valor.replace(",", ".")) * 100)
        : null;
      const resposta = await apiClient.post<{ data: { cobranca: CobrancaPublica } }>(
        `${URL_BASE}/cobrancas`,
        {
          contact_id: contato,
          ...(agendamento ? { appointment_id: agendamento } : { amount_cents: cents }),
          due_date: vencimento,
          billing_type: meio,
          reason: motivo,
          documento,
        },
        { idempotencyKey: operacao, timeoutMs: 100_000 },
      );
      setDocumento("");
      setAviso(t(MENSAGENS_COBRANCA[resposta.data.cobranca.status]));
      // Não reutiliza a mesma chave com um formulário alterado nem repete uma
      // emissão incerta. Nova cobrança avulsa exige clicar no botão dedicado.
      await cache.invalidateQueries({ queryKey: key });
    } catch (err) {
      showApiError(err);
      setAviso(t("Confira a lista e consulte a situação antes de repetir uma emissão."));
    } finally {
      setOcupado(false);
    }
  }
  async function executar(c: CobrancaPublica, acao: "sincronizar" | "cancelar" | "enviar") {
    if (bloqueado) return;
    setOcupado(true);
    setAviso("");
    try {
      const r = await apiClient.post<{ data: { cobranca: CobrancaPublica } }>(
        `${URL_BASE}/cobrancas/${c.id}/${acao}`,
        acao === "enviar" ? { conversation_id: conversa } : {},
        {
          idempotencyKey: acao === "enviar" ? operacaoEnvio : randomId(),
          timeoutMs: 100_000,
        },
      );
      setAviso(
        acao === "enviar"
          ? `${t("Situação do envio:")} ${t(MENSAGENS_ENVIO[r.data.cobranca.send_state])}`
          : t(MENSAGENS_COBRANCA[r.data.cobranca.status]),
      );
      setPrevia(null);
      await cache.invalidateQueries({ queryKey: key });
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="space-y-6" aria-label={t("Cobranças de teste")}>
      <Card>
        <CardHeader>
          <CardTitle>{t("Nova cobrança no Sandbox")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-text-muted">
            {t(
              "Somente testes. O documento é enviado ao Asaas para identificar o pagador e não é salvo neste formulário. Use dados fictícios. O envio pelo WhatsApp é uma ação separada.",
            )}
          </p>
          <form onSubmit={emitir} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rcb-contato">{t("Pagador")}</Label>
              <select
                id="rcb-contato"
                required
                className={estiloSelect}
                value={contato}
                disabled={bloqueado}
                onChange={(e) => {
                  setContato(e.target.value);
                  setAgendamento("");
                }}
              >
                <option value="">{t("Selecione entre os 100 contatos recentes")}</option>
                {contatos.data?.data.contatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomeDoContato(c) ?? t("Sem nome")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rcb-origem">{t("Origem")}</Label>
              <select
                id="rcb-origem"
                className={estiloSelect}
                value={agendamento}
                disabled={bloqueado || !contato}
                onChange={(e) => setAgendamento(e.target.value)}
              >
                <option value="">{t("Cobrança avulsa")}</option>
                {opcoes.data?.data.agendamentos.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.amount_cents}>
                    {a.nome} — {new Date(a.starts_at).toLocaleString()} —{" "}
                    {a.amount_cents ? dinheiro(a.amount_cents) : t("Sem preço")}
                  </option>
                ))}
              </select>
            </div>
            {!agendamento && (
              <div className="space-y-2">
                <Label htmlFor="rcb-valor">{t("Valor em reais")}</Label>
                <Input
                  id="rcb-valor"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,2})?"
                  value={valor}
                  disabled={bloqueado}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="10,00"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="rcb-doc">{t("CPF ou CNPJ fictício do pagador")}</Label>
              <Input
                id="rcb-doc"
                required
                value={documento}
                autoComplete="off"
                maxLength={30}
                disabled={bloqueado}
                onChange={(e) => setDocumento(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rcb-vencimento">{t("Vencimento")}</Label>
              <Input
                id="rcb-vencimento"
                required
                type="date"
                value={vencimento}
                disabled={bloqueado}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rcb-meio">{t("Forma de pagamento")}</Label>
              <select
                id="rcb-meio"
                className={estiloSelect}
                value={meio}
                disabled={bloqueado}
                onChange={(e) => setMeio(e.target.value)}
              >
                <option value="UNDEFINED">{t("Escolher na fatura")}</option>
                <option value="PIX">Pix</option>
                <option value="BOLETO">{t("Boleto")}</option>
                <option value="CREDIT_CARD">{t("Cartão na página do Asaas")}</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="rcb-motivo">{t("Motivo interno da cobrança")}</Label>
              <Input
                id="rcb-motivo"
                required
                minLength={3}
                maxLength={300}
                value={motivo}
                disabled={bloqueado}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <p className="text-xs text-text-muted">
                {t("Este texto fica no CRM. A descrição enviada ao Asaas é neutra.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={bloqueado || !contato}>
                {t("Gerar cobrança de teste")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={bloqueado}
                onClick={() => {
                  setOperacao(randomId());
                  setDocumento("");
                  setValor("");
                  setMotivo("");
                  setAviso(
                    t(
                      "Novo pedido avulso preparado. Confira se já existe cobrança antes de gerar.",
                    ),
                  );
                }}
              >
                {t("Preparar outra cobrança avulsa")}
              </Button>
            </div>
          </form>
          {(contatos.isError || opcoes.isError) && (
            <p role="alert">
              {t("Não foi possível carregar contatos ou agendamentos. Atualize a página.")}
            </p>
          )}
        </CardContent>
      </Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("Cobranças recentes")}</h2>
        <Button variant="outline" disabled={ocupado} onClick={() => void cobrancas.refetch()}>
          {t("Atualizar lista")}
        </Button>
      </div>
      <p className="text-sm text-text-muted">
        {t(
          "A situação é atualizada ao consultar o Asaas. Esta etapa não faz baixa no financeiro nem altera a agenda.",
        )}
      </p>
      {cobrancas.isPending && <p role="status">{t("Carregando cobranças…")}</p>}
      {cobrancas.isError && (
        <p role="alert">{t("Não foi possível carregar as cobranças desta empresa.")}</p>
      )}
      {cobrancas.data?.data.cobrancas.length === 0 && (
        <p>{t("Nenhuma cobrança de teste criada.")}</p>
      )}
      {cobrancas.data?.data.cobrancas.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle>
              {nome(c.contact_id)} — {dinheiro(c.amount_cents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>{t(MENSAGENS_COBRANCA[c.status])}</p>
            <p className="text-sm">
              {t("Vencimento:")} {c.due_date.split("-").reverse().join("/")} · {c.reason}
            </p>
            {c.diagnostic && (
              <p role="status" className="text-sm">
                {t(c.diagnostic)}
              </p>
            )}
            <p className="text-sm">
              {t("Situação do envio:")} {t(MENSAGENS_ENVIO[c.send_state])}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={bloqueado}
                onClick={() => void executar(c, "sincronizar")}
              >
                {t("Consultar situação")}
              </Button>
              {cobrancaPodeSerEnviada(c) && (
                <>
                  <a
                    className="inline-flex items-center underline"
                    href={c.invoice_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Abrir fatura de teste")}
                  </a>
                  <Button
                    disabled={
                      bloqueado || ["enviando", "queued", "revisao_manual"].includes(c.send_state)
                    }
                    onClick={() => {
                      setPrevia(c);
                      setConversa("");
                      setOperacaoEnvio(randomId());
                    }}
                  >
                    {t("Preparar envio pelo WhatsApp")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={bloqueado}
                    onClick={() => setPrevia({ ...c, invoice_url: null })}
                  >
                    {t("Cancelar cobrança de teste")}
                  </Button>
                </>
              )}
              {c.conversation_id && (
                <a
                  className="inline-flex items-center underline"
                  href={`/app/inbox?conversation_id=${c.conversation_id}`}
                >
                  {t("Conferir na Inbox")}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      {previa && (
        <Card>
          <CardHeader>
            <CardTitle>
              {previa.invoice_url
                ? t("Confira antes de enviar")
                : t("Confirmar cancelamento no Sandbox")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {previa.invoice_url ? (
              <>
                <p>
                  {nome(previa.contact_id)} — {dinheiro(previa.amount_cents)}
                </p>
                <p className="rounded-md border p-3 text-sm break-words whitespace-pre-wrap">
                  {mensagemDaCobranca(previa)}
                </p>
                <Label htmlFor="rcb-conversa">{t("Conversa do pagador")}</Label>
                <select
                  id="rcb-conversa"
                  className={estiloSelect}
                  value={conversa}
                  onChange={(e) => setConversa(e.target.value)}
                >
                  <option value="">{t("Selecione a conversa")}</option>
                  {envioOpcoes.data?.data.conversas.map((v, i) => (
                    <option key={v.id} value={v.id}>
                      {t("Conversa")} {i + 1} — {new Date(v.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-muted">
                  {t(
                    "O WhatsApp recebe uma mensagem real com link de teste. Confira o pagador e a conversa.",
                  )}
                </p>
                <Button
                  disabled={bloqueado || !conversa}
                  onClick={() => void executar(previa, "enviar")}
                >
                  {t("Enviar link de teste pelo WhatsApp")}
                </Button>
              </>
            ) : (
              <>
                <p>
                  {t(
                    "Apenas a cobrança de teste pendente será cancelada. A agenda e o atendimento são preservados.",
                  )}
                </p>
                <Button disabled={bloqueado} onClick={() => void executar(previa, "cancelar")}>
                  {t("Confirmar cancelamento da cobrança")}
                </Button>
              </>
            )}
            <Button variant="outline" disabled={ocupado} onClick={() => setPrevia(null)}>
              {t("Voltar")}
            </Button>
          </CardContent>
        </Card>
      )}
      {ocupado && (
        <p role="status">{t("Aguarde. Não repita a operação enquanto ela é processada.")}</p>
      )}
      {aviso && <p role="status">{aviso}</p>}
    </section>
  );
}
