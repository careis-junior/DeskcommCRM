/** Código do servidor compartilhado com o worker Node; não importa APIs do Next. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptKey, byteaToBuffer } from "@/lib/crypto/aes_gcm";
import { COLUNAS_PUBLICAS_DA_CONEXAO, conexaoPublicaSchema, chaveSandboxSchema } from "./conexao";
import { ConexaoRecebimentosError } from "./conexao-erros";
const armazenadaSchema = conexaoPublicaSchema.extend({
  credential_ciphertext: z.unknown(),
  credential_iv: z.unknown(),
  credential_tag: z.unknown(),
});
/** Nunca retornar este objeto pela API ou ao agente: contém a chave em memória. */
export async function credencialValidadaSandbox(db: SupabaseClient, orgId: string) {
  const { data, error } = await db
    .from("recebimentos_conexoes")
    .select(`${COLUNAS_PUBLICAS_DA_CONEXAO},credential_ciphertext,credential_iv,credential_tag`)
    .eq("organization_id", orgId)
    .eq("provider", "asaas")
    .eq("ambiente", "sandbox")
    .maybeSingle();
  if (error) throw new ConexaoRecebimentosError("recebimentos_storage_unavailable", 503);
  if (!data) throw new ConexaoRecebimentosError("recebimentos_connection_missing", 404);
  const c = armazenadaSchema.parse(data);
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
