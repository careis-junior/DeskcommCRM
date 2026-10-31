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
