"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  chaveSandboxSchema,
  MENSAGEM_DO_ESTADO,
  type ConexaoPublica,
} from "@/lib/recebimentos/conexao";

type Resposta = { data: { conexao: ConexaoPublica | null } };
const ENDPOINT = "/api/v1/recebimentos/conexao";

export function ConexaoDeRecebimentos({
  orgId,
  podeEditar,
}: {
  orgId: string;
  podeEditar: boolean;
}) {
  const t = useT();
  const cache = useQueryClient();
  const queryKey = ["recebimentos", "conexao", orgId];
  const consulta = useQuery({
    queryKey,
    queryFn: () => apiClient.get<Resposta>(ENDPOINT),
    retry: false,
  });
  const conexao = consulta.data?.data.conexao ?? null;
  const [chave, setChave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const bloqueado = !podeEditar || ocupado || consulta.isPending || consulta.isError;

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    if (bloqueado || !chaveSandboxSchema.safeParse(chave).success) return;
    setOcupado(true);
    setAviso("");
    try {
      // Não usar useMutation para a chave: as variables da mutation ficariam
      // no cache. O cache de consulta recebe somente a lista pública da API.
      const resposta = await apiClient.put<Resposta>(ENDPOINT, {
        ambiente: "sandbox",
        api_key: chave.trim(),
        expected_revision: conexao?.revision ?? 0,
      });
      setChave("");
      cache.setQueryData(queryKey, resposta);
      setAviso(t("Chave salva com proteção. Agora teste a conexão."));
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  async function testarOuDesativar(acao: "testar" | "desativar") {
    if (bloqueado || !conexao) return;
    setOcupado(true);
    setAviso("");
    try {
      const corpo = { expected_revision: conexao.revision };
      const resposta =
        acao === "testar"
          ? await apiClient.post<Resposta>(`${ENDPOINT}/testar`, corpo, { timeoutMs: 90_000 })
          : await apiClient.patch<Resposta>(ENDPOINT, corpo);
      cache.setQueryData(queryKey, resposta);
      if (resposta.data.conexao) setAviso(t(MENSAGEM_DO_ESTADO[resposta.data.conexao.status]));
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("Asaas Sandbox")}</CardTitle>
          <CardDescription>
            {t(
              "Somente testes. Gerar cobranças e enviar links ainda não estão disponíveis nesta etapa.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {consulta.isPending && <p role="status">{t("Carregando conexão…")}</p>}
          {consulta.isError && (
            <div role="alert" className="space-y-2">
              <p>{t("Não foi possível carregar a conexão desta empresa.")}</p>
              <Button variant="outline" onClick={() => void consulta.refetch()}>
                {t("Tentar novamente")}
              </Button>
            </div>
          )}
          {!consulta.isPending && !consulta.isError && (
            <div className="space-y-1 rounded-md border p-3" role="status">
              <p className="text-sm">
                {conexao
                  ? t(MENSAGEM_DO_ESTADO[conexao.status])
                  : t("Nenhuma chave cadastrada nesta empresa.")}
              </p>
              {conexao && (
                <p className="text-xs text-text-muted">
                  {t("Final da chave:")} ••••{conexao.credential_last4}
                </p>
              )}
              {conexao?.tested_at && (
                <p className="text-xs text-text-muted">
                  {t("Último teste:")}{" "}
                  <time dateTime={conexao.tested_at}>
                    {new Date(conexao.tested_at).toLocaleString()}
                  </time>
                </p>
              )}
            </div>
          )}
          <form onSubmit={salvar} className="space-y-3">
            <Label htmlFor="asaas-sandbox-key">{t("Chave de API do Sandbox")}</Label>
            <Input
              id="asaas-sandbox-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              disabled={bloqueado}
              maxLength={4096}
              aria-describedby="asaas-key-help"
            />
            <p id="asaas-key-help" className="text-xs text-text-muted">
              {t(
                "A chave fica protegida no servidor e não é exibida novamente. Chaves de produção são recusadas.",
              )}
            </p>
            <Button
              type="submit"
              disabled={bloqueado || !chaveSandboxSchema.safeParse(chave).success}
            >
              {t("Salvar chave")}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={bloqueado || !conexao || conexao.status === "desativada"}
              onClick={() => void testarOuDesativar("testar")}
            >
              {t("Testar conexão")}
            </Button>
            <Button
              variant="outline"
              disabled={bloqueado || !conexao || conexao.status === "desativada"}
              onClick={() => void testarOuDesativar("desativar")}
            >
              {t("Desativar conexão")}
            </Button>
          </div>
          {ocupado && (
            <p role="status" className="text-sm">
              {t("Aguarde a conclusão da operação…")}
            </p>
          )}
          {aviso && (
            <p role="status" className="text-sm">
              {aviso}
            </p>
          )}
          {!podeEditar && (
            <p className="text-xs text-text-muted">
              {t("A sessão de suporte não pode alterar esta chave.")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
