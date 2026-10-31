import { z } from "zod";
import { documentoDoPagador } from "@/lib/cobranca/documento";

export const dataCivilSchema = z.iso.date();
export const criarCobrancaSchema = z
  .strictObject({
    contact_id: z.string().uuid(),
    appointment_id: z.string().uuid().optional(),
    amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    due_date: dataCivilSchema,
    billing_type: z.enum(["UNDEFINED", "PIX", "BOLETO", "CREDIT_CARD"]),
    reason: z.string().trim().min(3).max(300),
    documento: z
      .string()
      .max(30)
      .refine((s) => documentoDoPagador(s) !== null),
  })
  .refine((v) => v.appointment_id !== undefined || v.amount_cents !== undefined);
export type CriarCobranca = z.infer<typeof criarCobrancaSchema>;
export const estadoCobrancaSchema = z.enum([
  "criando",
  "criacao_indeterminada",
  "pendente",
  "confirmada",
  "recebida",
  "vencida",
  "cancelada",
  "cancelando",
  "revertida",
  "revisao_manual",
]);
export const estadoEnvioSchema = z.enum([
  "nao_enviada",
  "enviando",
  "sent",
  "delivered",
  "read",
  "queued",
  "failed",
  "revisao_manual",
]);
export const MENSAGENS_ENVIO: Record<z.infer<typeof estadoEnvioSchema>, string> = {
  nao_enviada: "Link ainda não enviado",
  enviando: "Enviando link",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  queued: "Aguardando canal de envio. Confira na Inbox.",
  failed: "Envio não concluído",
  revisao_manual: "Confira o envio na Inbox antes de tentar novamente.",
};
export const cobrancaPublicaSchema = z
  .object({
    id: z.string().uuid(),
    contact_id: z.string().uuid(),
    appointment_id: z.string().uuid().nullable(),
    amount_cents: z.number().int().positive(),
    currency: z.literal("BRL"),
    due_date: dataCivilSchema,
    billing_type: z.string(),
    reason: z.string(),
    status: estadoCobrancaSchema,
    provider_status: z.string().nullable(),
    invoice_url: z.string().nullable(),
    diagnostic: z.string().nullable(),
    revision: z.number().int().positive(),
    send_state: estadoEnvioSchema,
    message_id: z.string().uuid().nullable(),
    conversation_id: z.string().uuid().nullable(),
    send_requested_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strip();
export type CobrancaPublica = z.infer<typeof cobrancaPublicaSchema>;
export const COLUNAS_COBRANCA =
  "id,contact_id,appointment_id,amount_cents,currency,due_date,billing_type,reason,status,provider_status,invoice_url,diagnostic,revision,send_state,message_id,conversation_id,send_requested_at,created_at,updated_at";
export const MENSAGENS_COBRANCA: Record<CobrancaPublica["status"], string> = {
  criando: "Emissão iniciada. Consulte a situação antes de tentar outra cobrança.",
  criacao_indeterminada:
    "A resposta não foi confirmada. Consulte o Asaas; não gere outra cobrança.",
  pendente: "Cobrança aguardando pagamento",
  confirmada: "Pagamento confirmado; ainda não liquidado",
  recebida: "Pagamento recebido",
  vencida: "Vencida",
  cancelada: "Cancelada",
  cancelando: "Cancelamento em andamento. Consulte a situação antes de repetir.",
  revertida: "Pagamento revertido ou contestado. Revise com a equipe.",
  revisao_manual: "Revisão necessária. Confira a situação no Asaas antes de prosseguir.",
};
export function estadoDoPagamento(status: string): CobrancaPublica["status"] {
  if (status === "PENDING" || status === "AWAITING_RISK_ANALYSIS") return "pendente";
  if (status === "CONFIRMED") return "confirmada";
  if (status === "RECEIVED" || status === "RECEIVED_IN_CASH") return "recebida";
  if (status === "OVERDUE") return "vencida";
  if (status === "DELETED") return "cancelada";
  if (
    status.startsWith("REFUND") ||
    status.includes("CHARGEBACK") ||
    status === "DUNNING_REQUESTED"
  )
    return "revertida";
  return "revisao_manual";
}
export function linkSandboxSeguro(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  try {
    const u = new URL(valor);
    return u.protocol === "https:" &&
      u.hostname === "sandbox.asaas.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith("/i/")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function cobrancaPodeSerEnviada(
  c: Pick<CobrancaPublica, "status" | "invoice_url">,
): boolean {
  return (
    (c.status === "pendente" || c.status === "vencida") && linkSandboxSeguro(c.invoice_url) !== null
  );
}
export function mensagemDaCobranca(c: CobrancaPublica): string {
  const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    c.amount_cents / 100,
  );
  const data = c.due_date.split("-").reverse().join("/");
  return `[TESTE — sem valor financeiro] Cobrança de ${valor}, vencimento em ${data}. Link de teste para pagamento: ${c.invoice_url}`;
}
