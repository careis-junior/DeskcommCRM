import { declararTools } from "./tipos";
export const TOOLS_RECEBIMENTOS = declararTools([
  {
    name: "crm_consultar_recebimentos",
    category: "read",
    rotulo: "Consultar cobranças de teste do cliente",
    explicacao:
      "Consulta valor, vencimento e situação das cobranças de teste desta pessoa no Asaas. Quando ainda pode pagar, mostra o link de teste para o assistente responder na conversa.",
    oQueToca: "Cobranças de teste do cliente",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "recebimentos",
  },
]);
