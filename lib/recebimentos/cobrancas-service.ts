import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { documentoDoPagador } from "@/lib/cobranca/documento";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { credencialValidadaSandbox } from "./credencial-sandbox";
import {
  COLUNAS_COBRANCA,
  cobrancaPublicaSchema,
  criarCobrancaSchema,
  estadoDoPagamento,
  linkSandboxSeguro,
  type CobrancaPublica,
} from "./cobrancas";
import { provedorSandbox, type PagamentoSandbox, type ProvedorSandbox } from "./provedor-sandbox";

const TABELA = "recebimentos_cobrancas";
const INTERNAS = `${COLUNAS_COBRANCA},organization_id,operation_id,request_hash,connection_id,credential_fingerprint,provider_customer_id,provider_payment_id,send_operation_id`;
const linhaSchema = cobrancaPublicaSchema.extend({
  organization_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  request_hash: z.string(),
  connection_id: z.string().uuid(),
  credential_fingerprint: z.string(),
  provider_customer_id: z.string().nullable(),
  provider_payment_id: z.string().nullable(),
  send_operation_id: z.string().uuid().nullable(),
});
export type LinhaCobranca = z.infer<typeof linhaSchema>;
export class CobrancaError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "recebimentos_conflict"
      | "recebimentos_invalid_source"
      | "recebimentos_connection_changed"
      | "recebimentos_unavailable",
    readonly status = 409,
  ) {
    super(code);
  }
}
function banco(error: unknown) {
  if (error) throw new CobrancaError("recebimentos_unavailable", 503);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const referenciaDaCobranca = (id: string) => `rcb_${id}`;
export async function exigirModulo(db: SupabaseClient) {
  if (!(await moduloLigado(db, "recebimentos"))) throw new CobrancaError("not_found", 404);
}
export async function lerLinha(
  db: SupabaseClient,
  orgId: string,
  id: string,
): Promise<LinhaCobranca> {
  const { data, error } = await db
    .from(TABELA)
    .select(INTERNAS)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  banco(error);
  if (!data) throw new CobrancaError("not_found", 404);
  return linhaSchema.parse(data);
}
export async function listarCobrancas(
  db: SupabaseClient,
  orgId: string,
  contactId?: string,
): Promise<CobrancaPublica[]> {
  let q = db.from(TABELA).select(COLUNAS_COBRANCA).eq("organization_id", orgId);
  if (contactId) q = q.eq("contact_id", contactId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
  banco(error);
  return z.array(cobrancaPublicaSchema).parse(data ?? []);
}
export async function provedorDaCobranca(
  db: SupabaseClient,
  orgId: string,
  row: LinhaCobranca,
  dep?: ProvedorSandbox,
) {
  const { data: contato, error: contatoError } = await db
    .from("contacts")
    .select("id,is_anonymized")
    .eq("organization_id", orgId)
    .eq("id", row.contact_id)
    .maybeSingle();
  banco(contatoError);
  if (!contato || contato.is_anonymized)
    throw new CobrancaError("recebimentos_invalid_source", 422);
  const c = await credencialValidadaSandbox(db, orgId);
  if (c.id !== row.connection_id || hash(c.chave) !== row.credential_fingerprint)
    throw new CobrancaError("recebimentos_connection_changed");
  return dep ?? provedorSandbox(c.chave);
}
export async function alterarCobranca(
  db: SupabaseClient,
  row: LinhaCobranca,
  valores: Record<string, unknown>,
): Promise<LinhaCobranca> {
  const { data, error } = await db
    .from(TABELA)
    .update({ ...valores, revision: row.revision + 1, updated_at: new Date().toISOString() })
    .eq("organization_id", row.organization_id)
    .eq("id", row.id)
    .eq("revision", row.revision)
    .select(INTERNAS)
    .maybeSingle();
  banco(error);
  if (!data) throw new CobrancaError("recebimentos_conflict");
  return linhaSchema.parse(data);
}
function camposDoPagamento(row: LinhaCobranca, p: PagamentoSandbox) {
  // Referência opaca não autoriza quitação: conta/cliente, valor e data também têm de conferir.
  const compativel =
    p.externalReference === referenciaDaCobranca(row.id) &&
    p.customer === row.provider_customer_id &&
    Math.round(p.value * 100) === row.amount_cents &&
    p.dueDate === row.due_date &&
    (!row.provider_payment_id || row.provider_payment_id === p.id);
  if (!compativel)
    return {
      status: "revisao_manual",
      diagnostic: "O pagamento consultado diverge da obrigação. Revise no Asaas.",
      invoice_url: null,
    };
  return {
    status: p.deleted ? "cancelada" : estadoDoPagamento(p.status),
    provider_payment_id: p.id,
    provider_status: p.status,
    invoice_url: linkSandboxSeguro(p.invoiceUrl),
    diagnostic: null,
  };
}
export async function criarCobranca(
  db: SupabaseClient,
  orgId: string,
  operationId: string,
  entrada: unknown,
  dep?: ProvedorSandbox,
): Promise<CobrancaPublica> {
  await exigirModulo(db);
  z.string().uuid().parse(operationId);
  const input = criarCobrancaSchema.parse(entrada);
  const requestHash = hash(
    JSON.stringify({
      contact_id: input.contact_id,
      appointment_id: input.appointment_id ?? null,
      amount_cents: input.amount_cents ?? null,
      due_date: input.due_date,
      billing_type: input.billing_type,
      reason: input.reason,
    }),
  );
  const { data: replay, error: replayError } = await db
    .from(TABELA)
    .select(INTERNAS)
    .eq("organization_id", orgId)
    .eq("operation_id", operationId)
    .maybeSingle();
  banco(replayError);
  if (replay) {
    const antiga = linhaSchema.parse(replay);
    if (antiga.request_hash !== requestHash) throw new CobrancaError("recebimentos_conflict");
    return cobrancaPublicaSchema.parse(antiga);
  }
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (input.due_date < hoje) throw new CobrancaError("recebimentos_invalid_source", 422);
  const { data: contato, error: contatoError } = await db
    .from("contacts")
    .select("id,name,display_name,is_anonymized,is_blocked,kind")
    .eq("organization_id", orgId)
    .eq("id", input.contact_id)
    .maybeSingle();
  banco(contatoError);
  if (!contato || contato.is_anonymized || contato.is_blocked || contato.kind === "whatsapp_group")
    throw new CobrancaError("recebimentos_invalid_source", 422);
  let valor = input.amount_cents;
  if (input.appointment_id) {
    const { data: compromisso, error } = await db
      .from("calendar_appointments")
      .select("id,contact_id,event_type_id,status")
      .eq("organization_id", orgId)
      .eq("id", input.appointment_id)
      .maybeSingle();
    banco(error);
    if (
      !compromisso ||
      compromisso.contact_id !== input.contact_id ||
      !["confirmed"].includes(compromisso.status)
    )
      throw new CobrancaError("recebimentos_invalid_source", 422);
    const { data: tipo, error: tipoError } = await db
      .from("calendar_event_types")
      .select("default_price_cents")
      .eq("organization_id", orgId)
      .eq("id", compromisso.event_type_id)
      .maybeSingle();
    banco(tipoError);
    valor = tipo?.default_price_cents;
    if (input.amount_cents !== undefined && input.amount_cents !== valor)
      throw new CobrancaError("recebimentos_invalid_source", 422);
  }
  if (!Number.isSafeInteger(valor) || !valor || valor < 1)
    throw new CobrancaError("recebimentos_invalid_source", 422);
  const c = await credencialValidadaSandbox(db, orgId);
  const { data, error } = await db
    .from(TABELA)
    .insert({
      organization_id: orgId,
      connection_id: c.id,
      credential_fingerprint: hash(c.chave),
      operation_id: operationId,
      request_hash: requestHash,
      contact_id: input.contact_id,
      appointment_id: input.appointment_id ?? null,
      amount_cents: valor,
      due_date: input.due_date,
      billing_type: input.billing_type,
      reason: input.reason,
    })
    .select(INTERNAS)
    .maybeSingle();
  if (error?.code === "23505") {
    // Corrida: nenhuma outra chamada pode fazer POST para uma intenção já reservada.
    const { data: existente, error: erroExistente } = await db
      .from(TABELA)
      .select(INTERNAS)
      .eq("organization_id", orgId)
      .eq(
        input.appointment_id ? "appointment_id" : "operation_id",
        input.appointment_id ?? operationId,
      )
      .maybeSingle();
    banco(erroExistente);
    if (!existente) throw new CobrancaError("recebimentos_conflict");
    const antigo = linhaSchema.parse(existente);
    if (antigo.request_hash !== requestHash) throw new CobrancaError("recebimentos_conflict");
    return cobrancaPublicaSchema.parse(antigo);
  }
  banco(error);
  let row = linhaSchema.parse(data);
  try {
    const provedor = await provedorDaCobranca(db, orgId, row, dep);
    const cliente = await provedor.cliente({
      referencia: `rcp_${c.id}_${input.contact_id}`,
      nome: contato.display_name || contato.name || "Cliente de teste",
      documento: documentoDoPagador(input.documento)!,
    });
    row = await alterarCobranca(db, row, { provider_customer_id: cliente });
    // Revalida a credencial antes da escrita externa; reexecução nunca retoma POST.
    await provedorDaCobranca(db, orgId, row, dep);
    const p = await provedor.criar({
      customer: cliente,
      amount_cents: valor,
      due_date: input.due_date,
      billing_type: input.billing_type,
      referencia: referenciaDaCobranca(row.id),
    });
    row = await alterarCobranca(db, row, camposDoPagamento(row, p));
  } catch {
    // Não há prova de que o POST não chegou. Preserva intenção, bloqueia repetição,
    // e só uma leitura canônica poderá recuperá-la. Nunca propaga corpo/CPF/chave.
    row = await alterarCobranca(db, row, {
      status: "criacao_indeterminada",
      diagnostic:
        "Não foi possível confirmar a emissão. Consulte a situação; não gere outra cobrança.",
    });
  }
  return cobrancaPublicaSchema.parse(row);
}
export async function sincronizarCobranca(
  db: SupabaseClient,
  orgId: string,
  id: string,
  dep?: ProvedorSandbox,
): Promise<CobrancaPublica> {
  await exigirModulo(db);
  let row = await lerLinha(db, orgId, id);
  // Evita disputar com a criação ainda em execução (máximo: 2 POST + 2 GET de 20s).
  if (
    ["criando", "cancelando"].includes(row.status) &&
    Date.now() - new Date(row.updated_at).getTime() < 120_000
  )
    throw new CobrancaError("recebimentos_conflict");
  const p = await provedorDaCobranca(db, orgId, row, dep);
  const achados = row.provider_payment_id
    ? [await p.consultar(row.provider_payment_id)]
    : await p.localizar(referenciaDaCobranca(row.id));
  if (achados.length !== 1) {
    row = await alterarCobranca(db, row, {
      status: achados.length > 1 ? "revisao_manual" : "criacao_indeterminada",
      invoice_url: null,
      diagnostic:
        achados.length > 1
          ? "Mais de um pagamento encontrado. Revise no Asaas."
          : "Nenhum pagamento confirmado na consulta. A emissão não será repetida automaticamente.",
    });
  } else row = await alterarCobranca(db, row, camposDoPagamento(row, achados[0]!));
  return cobrancaPublicaSchema.parse(row);
}
export async function cancelarCobranca(
  db: SupabaseClient,
  orgId: string,
  id: string,
  dep?: ProvedorSandbox,
) {
  await sincronizarCobranca(db, orgId, id, dep);
  let row = await lerLinha(db, orgId, id);
  if (row.status === "cancelada") return cobrancaPublicaSchema.parse(row);
  if (!["pendente", "vencida"].includes(row.status) || !row.provider_payment_id)
    throw new CobrancaError("recebimentos_conflict");
  // Se há um envio em curso, não cancelar o link por baixo dele.
  if (row.send_state === "enviando") throw new CobrancaError("recebimentos_conflict");
  const p = await provedorDaCobranca(db, orgId, row, dep);
  const paymentId = row.provider_payment_id;
  row = await alterarCobranca(db, row, { status: "cancelando", invoice_url: null });
  await p.cancelar(paymentId);
  row = await alterarCobranca(db, row, {
    status: "cancelada",
    provider_status: "DELETED",
    invoice_url: null,
  });
  return cobrancaPublicaSchema.parse(row);
}
export function novoIdDeMensagem() {
  return randomUUID();
}
