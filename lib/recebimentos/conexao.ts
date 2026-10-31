import { z } from "zod";

/** Esta entrega não aceita nem envia credenciais de produção. */
export const chaveSandboxSchema = z
  .string()
  .trim()
  .max(4096)
  .regex(/^\$aact_hmlg_\S{16,}$/);
export const salvarConexaoSchema = z.strictObject({
  ambiente: z.literal("sandbox"),
  api_key: chaveSandboxSchema,
  expected_revision: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
});
export const revisarConexaoSchema = z.strictObject({
  expected_revision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
});

export const estadoDaConexaoSchema = z.enum([
  "nao_testada",
  "validada",
  "chave_invalida",
  "sem_permissao",
  "indisponivel",
  "desativada",
]);
export type EstadoDaConexao = z.infer<typeof estadoDaConexaoSchema>;

/** Lista positiva: uma resposta nunca espalha a linha que contém o segredo. */
export const conexaoPublicaSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.literal("asaas"),
    ambiente: z.literal("sandbox"),
    status: estadoDaConexaoSchema,
    credential_last4: z.string().length(4),
    revision: z.number().int().positive(),
    validated_at: z.string().nullable(),
    tested_at: z.string().nullable(),
    updated_at: z.string(),
  })
  .strip();
export type ConexaoPublica = z.infer<typeof conexaoPublicaSchema>;

export const COLUNAS_PUBLICAS_DA_CONEXAO =
  "id,provider,ambiente,status,credential_last4,revision,validated_at,tested_at,updated_at";

export const MENSAGEM_DO_ESTADO: Record<EstadoDaConexao, string> = {
  nao_testada: "Chave salva. Teste a conexão para verificar o acesso ao Sandbox.",
  validada: "Acesso ao Sandbox verificado. Nenhuma cobrança foi criada.",
  chave_invalida: "O Asaas recusou a chave. Confira a chave do Sandbox e salve novamente.",
  sem_permissao:
    "A chave não tem permissão para consultar o Asaas. Revise as permissões no Sandbox.",
  indisponivel: "Não foi possível verificar o Asaas agora. Você pode testar novamente.",
  desativada: "Conexão desativada. Salve uma chave para reconectar.",
};
