// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { AI_CRED_AES_KEY: Buffer.alloc(32, 7).toString("base64") } }));
import { encryptKey, bufToBytea, byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import { salvarConexaoSchema, conexaoPublicaSchema } from "./conexao";
import {
  lerConexaoSandbox,
  salvarConexaoSandbox,
  testarConexaoSandbox,
  desativarConexaoSandbox,
} from "./conexao-service";

const ORG_A = "a5550000-0000-4000-8000-000000000001";
const ORG_B = "b5550000-0000-4000-8000-000000000001";
const KEY = "$aact_hmlg_credencial_sintetica_sem_validade_1234";
const row = {
  id: "e5550000-0000-4000-8000-000000000001",
  provider: "asaas",
  ambiente: "sandbox",
  status: "nao_testada",
  credential_last4: "1234",
  revision: 1,
  validated_at: null,
  tested_at: null,
  updated_at: "2026-10-31T00:00:00Z",
};

type RespostaDb = { data: unknown; error: { code?: string; message?: string } | null };
function banco(respostas: RespostaDb[]) {
  const operacoes: Array<{
    filtros: Array<[string, unknown]>;
    valores?: Record<string, unknown>;
    colunas?: string;
  }> = [];
  const from = vi.fn(() => {
    const op: (typeof operacoes)[number] = { filtros: [] };
    operacoes.push(op);
    const builder = {
      select: vi.fn((colunas: string) => {
        op.colunas = colunas;
        return builder;
      }),
      eq: vi.fn((coluna: string, valor: unknown) => {
        op.filtros.push([coluna, valor]);
        return builder;
      }),
      insert: vi.fn((valores: Record<string, unknown>) => {
        op.valores = valores;
        return builder;
      }),
      update: vi.fn((valores: Record<string, unknown>) => {
        op.valores = valores;
        return builder;
      }),
      maybeSingle: vi.fn(async () => respostas.shift() ?? { data: null, error: null }),
    };
    return builder;
  });
  return { db: { from } as unknown as SupabaseClient, operacoes, from };
}
function cifrada() {
  const enc = encryptKey(KEY);
  return {
    ...row,
    credential_ciphertext: bufToBytea(enc.ciphertext),
    credential_iv: bufToBytea(enc.iv),
    credential_tag: bufToBytea(enc.tag),
  };
}

describe("conexão de recebimentos Sandbox", () => {
  it("recusa chave de produção, tenant no corpo e revisão inválida", () => {
    for (const input of [
      { ambiente: "sandbox", api_key: KEY.replace("hmlg", "prod"), expected_revision: 0 },
      { ambiente: "producao", api_key: KEY, expected_revision: 0 },
      { ambiente: "sandbox", api_key: KEY, expected_revision: -1 },
      { ambiente: "sandbox", api_key: KEY, expected_revision: 0, organization_id: ORG_B },
    ])
      expect(salvarConexaoSchema.safeParse(input).success).toBe(false);
  });
  it("cifra de verdade e devolve somente metadados permitidos", async () => {
    const b = banco([{ data: { ...cifrada(), organization_id: ORG_A }, error: null }]);
    const result = await salvarConexaoSandbox(b.db, ORG_A, KEY, 0);
    const saved = b.operacoes[0]!.valores!;
    expect(saved.organization_id).toBe(ORG_A);
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(
      decryptKey({
        ciphertext: byteaToBuffer(saved.credential_ciphertext),
        iv: byteaToBuffer(saved.credential_iv),
        tag: byteaToBuffer(saved.credential_tag),
      }),
    ).toBe(KEY);
    expect(Object.keys(result).sort()).toEqual(Object.keys(row).sort());
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });
  it("usa IV novo mesmo para salvar novamente a mesma chave", async () => {
    const b = banco([
      { data: row, error: null },
      { data: row, error: null },
    ]);
    await salvarConexaoSandbox(b.db, ORG_A, KEY, 0);
    await salvarConexaoSandbox(b.db, ORG_B, KEY, 0);
    expect(b.operacoes[0]!.valores!.credential_iv).not.toEqual(
      b.operacoes[1]!.valores!.credential_iv,
    );
    expect(b.operacoes[1]!.valores!.organization_id).toBe(ORG_B);
  });
  it("toda leitura e toda alteração exigem filtro da empresa autorizada", async () => {
    const b = banco([
      { data: row, error: null },
      { data: { ...row, revision: 2 }, error: null },
      { data: { ...row, status: "desativada", revision: 3 }, error: null },
    ]);
    await lerConexaoSandbox(b.db, ORG_B);
    await salvarConexaoSandbox(b.db, ORG_B, KEY, 1);
    await desativarConexaoSandbox(b.db, ORG_B, 2);
    for (const op of b.operacoes) expect(op.filtros).toContainEqual(["organization_id", ORG_B]);
    expect(b.operacoes[1]!.filtros).toContainEqual(["revision", 1]);
    expect(b.operacoes[2]!.filtros).toContainEqual(["revision", 2]);
    expect(b.operacoes[1]!.valores).toMatchObject({ status: "nao_testada", validated_at: null });
  });
  it("uma aba antiga não sobrescreve outra revisão", async () => {
    const b = banco([{ data: null, error: null }]);
    await expect(salvarConexaoSandbox(b.db, ORG_A, KEY, 1)).rejects.toMatchObject({
      code: "recebimentos_revision_conflict",
    });
  });
  it("duplicação na criação é conflito sem ecoar o erro do driver", async () => {
    const b = banco([{ data: null, error: { code: "23505", message: KEY } }]);
    await expect(salvarConexaoSandbox(b.db, ORG_A, KEY, 0)).rejects.toMatchObject({
      message: "recebimentos_revision_conflict",
    });
  });
  it("testa só a chave decifrada e grava o resultado na mesma revisão", async () => {
    const b = banco([
      { data: cifrada(), error: null },
      { data: { ...row, revision: 2, status: "validada", validated_at: "agora" }, error: null },
    ]);
    const testar = vi.fn(async () => ({ ok: true }));
    const result = await testarConexaoSandbox(b.db, ORG_A, 1, testar);
    expect(testar).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(result.status).toBe("validada");
    expect(b.operacoes[1]!.filtros).toContainEqual(["revision", 1]);
    expect(b.operacoes[1]!.valores).toMatchObject({ status: "validada", revision: 2 });
  });
  it("não valida chave substituída durante o HTTP", async () => {
    const b = banco([
      { data: cifrada(), error: null },
      { data: null, error: null },
    ]);
    await expect(
      testarConexaoSandbox(b.db, ORG_A, 1, async () => ({ ok: true })),
    ).rejects.toMatchObject({ code: "recebimentos_revision_conflict" });
  });
  it("conexão desativada ou revisão antiga não chama o Asaas", async () => {
    for (const data of [
      { ...cifrada(), status: "desativada" },
      { ...cifrada(), revision: 2 },
    ]) {
      const b = banco([{ data, error: null }]);
      const testar = vi.fn(async () => ({ ok: true }));
      await expect(testarConexaoSandbox(b.db, ORG_A, 1, testar)).rejects.toMatchObject({
        code: "recebimentos_revision_conflict",
      });
      expect(testar).not.toHaveBeenCalled();
    }
  });
  it("corrupção da cifra não envia nada ao provedor", async () => {
    const b = banco([
      { data: { ...cifrada(), credential_tag: "\\x" + "00".repeat(16) }, error: null },
    ]);
    const testar = vi.fn(async () => ({ ok: true }));
    await expect(testarConexaoSandbox(b.db, ORG_A, 1, testar)).rejects.toMatchObject({
      code: "recebimentos_crypto_unavailable",
    });
    expect(testar).not.toHaveBeenCalled();
  });
  it.each([
    ["chave_invalida", "chave_invalida"],
    ["sem_permissao", "sem_permissao"],
    ["provedor_fora", "indisponivel"],
  ])("registra %s sem mensagem bruta", async (motivo, status) => {
    const b = banco([
      { data: cifrada(), error: null },
      { data: { ...row, status, revision: 2 }, error: null },
    ]);
    await testarConexaoSandbox(b.db, ORG_A, 1, async () => ({ ok: false, motivo }));
    expect(b.operacoes[1]!.valores).toMatchObject({ status, validated_at: null });
  });
  it("a representação pública remove toda coluna não permitida", () => {
    expect(
      conexaoPublicaSchema.parse({
        ...row,
        api_key: KEY,
        credential_ciphertext: "segredo",
        organization_id: ORG_A,
      }),
    ).toEqual(row);
  });
});
