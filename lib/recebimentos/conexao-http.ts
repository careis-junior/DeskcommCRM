import { fail } from "@/lib/api/wrappers";
import { ConexaoRecebimentosError } from "./conexao-service";

/** Leitura limitada enquanto o stream chega, antes de fazer JSON.parse. */
export async function lerCorpoDaConexao(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const partes: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 6144) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      partes.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const corpo = new Uint8Array(bytes);
  let offset = 0;
  for (const p of partes) {
    corpo.set(p, offset);
    offset += p.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(corpo));
}

export function erroDaConexao(erro: unknown, requestId: string) {
  if (erro instanceof ConexaoRecebimentosError) {
    const mensagens = {
      recebimentos_revision_conflict: "A conexão mudou. Atualize a página antes de continuar.",
      recebimentos_crypto_unavailable:
        "A proteção da credencial está indisponível. Avise quem administra o servidor.",
      recebimentos_connection_missing: "Salve a chave do Sandbox antes de testar a conexão.",
      recebimentos_storage_unavailable:
        "Não foi possível acessar a conexão. Tente novamente mais tarde.",
    };
    return fail(erro.code, mensagens[erro.code], erro.status, { requestId });
  }
  return fail("internal_error", "Não foi possível concluir a operação da conexão.", 500, {
    requestId,
  });
}
