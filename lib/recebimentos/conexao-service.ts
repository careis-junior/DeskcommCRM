import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { encryptKey, decryptKey, bufToBytea, byteaToBuffer } from "@/lib/crypto/aes_gcm";
import { criarAdaptadorAsaas } from "@/lib/cobranca/provedores/asaas";
import {
  COLUNAS_PUBLICAS_DA_CONEXAO,
  conexaoPublicaSchema,
  chaveSandboxSchema,
  type ConexaoPublica,
  type EstadoDaConexao,
} from "./conexao";

const TABELA = "recebimentos_conexoes";
const PUBLICAS = COLUNAS_PUBLICAS_DA_CONEXAO;
const conexaoArmazenadaSchema = conexaoPublicaSchema.extend({
  credential_ciphertext: z.unknown(),
  credential_iv: z.unknown(),
  credential_tag: z.unknown(),
});

export class ConexaoRecebimentosError extends Error {
  constructor(
    readonly code:
      | "recebimentos_revision_conflict"
      | "recebimentos_crypto_unavailable"
      | "recebimentos_connection_missing"
      | "recebimentos_storage_unavailable",
    readonly status: number,
  ) {
    super(code);
  }
}

function falhaDoBanco(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new ConexaoRecebimentosError("recebimentos_revision_conflict", 409);
  // Não propagar message/details: drivers podem incluir o valor da coluna recusada.
  throw new ConexaoRecebimentosError("recebimentos_storage_unavailable", 503);
}

/** Service role é necessário para o segredo; TODA consulta fica presa à org autorizada. */
function daEmpresa(db: SupabaseClient, orgId: string, colunas: string) {
  return db
    .from(TABELA)
    .select(colunas)
    .eq("organization_id", orgId)
    .eq("provider", "asaas")
    .eq("ambiente", "sandbox");
}

export async function lerConexaoSandbox(
  db: SupabaseClient,
  orgId: string,
): Promise<ConexaoPublica | null> {
  const { data, error } = await daEmpresa(db, orgId, PUBLICAS).maybeSingle();
  falhaDoBanco(error);
  return data === null ? null : conexaoPublicaSchema.parse(data);
}

export async function salvarConexaoSandbox(
  db: SupabaseClient,
  orgId: string,
  chave: string,
  revision: number,
): Promise<ConexaoPublica> {
  const key = chaveSandboxSchema.parse(chave);
  let segredo;
  try {
    segredo = encryptKey(key);
  } catch {
    throw new ConexaoRecebimentosError("recebimentos_crypto_unavailable", 503);
  }
  const valores = {
    credential_ciphertext: bufToBytea(segredo.ciphertext),
    credential_iv: bufToBytea(segredo.iv),
    credential_tag: bufToBytea(segredo.tag),
    credential_last4: segredo.last4,
    status: "nao_testada",
    validated_at: null,
    tested_at: null,
    revision: revision + 1,
    updated_at: new Date().toISOString(),
  };
  // INSERT único para a criação; UPDATE compare-and-swap para troca de chave.
  // Uma aba antiga não sobrescreve a chave que outra pessoa acabou de salvar.
  const operacao =
    revision === 0
      ? db
          .from(TABELA)
          .insert({ ...valores, organization_id: orgId, provider: "asaas", ambiente: "sandbox" })
      : db
          .from(TABELA)
          .update(valores)
          .eq("organization_id", orgId)
          .eq("provider", "asaas")
          .eq("ambiente", "sandbox")
          .eq("revision", revision);
  const { data, error } = await operacao.select(PUBLICAS).maybeSingle();
  falhaDoBanco(error);
  if (!data) throw new ConexaoRecebimentosError("recebimentos_revision_conflict", 409);
  return conexaoPublicaSchema.parse(data);
}

async function registrarEstado(
  db: SupabaseClient,
  orgId: string,
  revision: number,
  status: EstadoDaConexao,
): Promise<ConexaoPublica> {
  const agora = new Date().toISOString();
  const { data, error } = await db
    .from(TABELA)
    .update({
      status,
      revision: revision + 1,
      updated_at: agora,
      tested_at: status === "desativada" ? null : agora,
      validated_at: status === "validada" ? agora : null,
    })
    .eq("organization_id", orgId)
    .eq("provider", "asaas")
    .eq("ambiente", "sandbox")
    .eq("revision", revision)
    .select(PUBLICAS)
    .maybeSingle();
  falhaDoBanco(error);
  if (!data) throw new ConexaoRecebimentosError("recebimentos_revision_conflict", 409);
  return conexaoPublicaSchema.parse(data);
}

export async function desativarConexaoSandbox(db: SupabaseClient, orgId: string, revision: number) {
  // Preserva a credencial cifrada e o histórico; não apaga dados do provedor.
  return registrarEstado(db, orgId, revision, "desativada");
}

export async function testarConexaoSandbox(
  db: SupabaseClient,
  orgId: string,
  revision: number,
  testar?: (chave: string) => Promise<{ ok: boolean; motivo?: string }>,
): Promise<ConexaoPublica> {
  const { data, error } = await daEmpresa(
    db,
    orgId,
    `${PUBLICAS},credential_ciphertext,credential_iv,credential_tag`,
  ).maybeSingle();
  falhaDoBanco(error);
  if (!data) throw new ConexaoRecebimentosError("recebimentos_connection_missing", 404);
  const armazenada = conexaoArmazenadaSchema.parse(data);
  if (armazenada.revision !== revision || armazenada.status === "desativada") {
    throw new ConexaoRecebimentosError("recebimentos_revision_conflict", 409);
  }
  let chave: string;
  try {
    chave = chaveSandboxSchema.parse(
      decryptKey({
        ciphertext: byteaToBuffer(armazenada.credential_ciphertext),
        iv: byteaToBuffer(armazenada.credential_iv),
        tag: byteaToBuffer(armazenada.credential_tag),
      }),
    );
  } catch {
    throw new ConexaoRecebimentosError("recebimentos_crypto_unavailable", 503);
  }
  // Reusa SOMENTE o teste de leitura do adaptador. Nunca resolve cliente,
  // assinatura, webhook, pagamento ou credencial de cobrança do revendedor.
  const verificar =
    testar ??
    ((key: string) =>
      criarAdaptadorAsaas({
        lerChave: async () => key,
        marca: "Recebimentos Sandbox",
      }).testarChave({ modoExigido: "teste" }));
  let resultado: { ok: boolean; motivo?: string };
  try {
    resultado = await verificar(chave);
  } catch {
    resultado = { ok: false, motivo: "provedor_fora" };
  }
  const status: EstadoDaConexao = resultado.ok
    ? "validada"
    : resultado.motivo === "chave_invalida"
      ? "chave_invalida"
      : resultado.motivo === "sem_permissao"
        ? "sem_permissao"
        : "indisponivel";
  // O resultado de uma chave antiga nunca valida uma chave trocada/desativada
  // durante o HTTP: a revisão é conferida DE NOVO na escrita atômica.
  return registrarEstado(db, orgId, revision, status);
}

/** Exclusivo do servidor: nunca espalhar este resultado em uma resposta HTTP. */
export async function credencialValidadaSandbox(db: SupabaseClient, orgId: string) {
  const { data, error } = await daEmpresa(
    db,
    orgId,
    `${PUBLICAS},credential_ciphertext,credential_iv,credential_tag`,
  ).maybeSingle();
  falhaDoBanco(error);
  if (!data) throw new ConexaoRecebimentosError("recebimentos_connection_missing", 404);
  const c = conexaoArmazenadaSchema.parse(data);
  if (c.status !== "validada")
    throw new ConexaoRecebimentosError("recebimentos_revision_conflict", 409);
  try {
    const chave = chaveSandboxSchema.parse(
      decryptKey({
        ciphertext: byteaToBuffer(c.credential_ciphertext),
        iv: byteaToBuffer(c.credential_iv),
        tag: byteaToBuffer(c.credential_tag),
      }),
    );
    return { id: c.id, revision: c.revision, chave };
  } catch {
    throw new ConexaoRecebimentosError("recebimentos_crypto_unavailable", 503);
  }
}
