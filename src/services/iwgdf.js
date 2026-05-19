// src/services/iwgdf.js
// Motor IWGDF 2023 — Podols
// Entrada: dadosDiab (dados_diabeticos), dadosSist (dados_sistemicos)
// Saída:   { risco: 0|1|2|3, retornoDias: number, justificativa: string[] }

export function calcularIWGDF(dadosDiab, dadosSist) {
  const justificativa = [];

  // Paciente sem diabetes → sem risco IWGDF
  if (!dadosSist?.doencas_cronicas?.diabetes) {
    return {
      risco: null,
      retornoDias: null,
      justificativa: ["Paciente sem diabetes — IWGDF não aplicável"],
    };
  }

  // ── RISCO 3 (qualquer um dos critérios já eleva ao máximo) ──────────────
  if (dadosDiab?.historico_ulcera) {
    justificativa.push("Histórico de úlcera em pé diabético");
  }
  if (dadosDiab?.historico_amputacao) {
    justificativa.push("Histórico de amputação");
  }
  if (dadosSist?.doencas_cronicas?.doenca_renal) {
    justificativa.push("Doença renal crônica");
  }
  if (justificativa.length > 0) {
    return { risco: 3, retornoDias: 45, justificativa };
  }

  // ── Avaliar neuropatia (monofilamento) ──────────────────────────────────
  const mono = dadosDiab?.monofilamento_10g;
  const neuropatia = avaliarNeuropatia(mono);

  // ── RISCO 0 — Sem neuropatia ────────────────────────────────────────────
  if (!neuropatia) {
    return {
      risco: 0,
      retornoDias: 365,
      justificativa: ["Monofilamento normal em ambos os pés"],
    };
  }

  justificativa.push(
    "Neuropatia periférica detectada (monofilamento alterado ou ausente)",
  );

  // ── Avaliar fatores agravantes para Risco 2 ─────────────────────────────
  const temDeformidade =
    dadosDiab?.classificacao_wagner?.pe_direito > 0 ||
    dadosDiab?.classificacao_wagner?.pe_esquerdo > 0 ||
    dadosDiab?.avaliacao_neuropatica?.perda_equilibrio;

  const temDoencaVascular = avaliarDoencaVascular(dadosDiab);

  const temUlceraAtiva = dadosDiab?.ulcera_ativa;

  // ── RISCO 2 — Neuropatia + deformidade OU doença vascular ───────────────
  if (temDeformidade) {
    justificativa.push("Deformidade em pé diabético identificada");
  }
  if (temDoencaVascular) {
    justificativa.push(
      "Doença vascular periférica (pulso ausente ou ABI alterado)",
    );
  }
  if (temUlceraAtiva) {
    justificativa.push("Úlcera ativa presente");
  }

  if (temDeformidade || temDoencaVascular || temUlceraAtiva) {
    return { risco: 2, retornoDias: 90, justificativa };
  }

  // ── RISCO 1 — Neuropatia sem agravantes ─────────────────────────────────
  return {
    risco: 1,
    retornoDias: 180,
    justificativa,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avaliarNeuropatia(mono) {
  if (!mono) return false;

  const resultados = [mono.resultado_direito, mono.resultado_esquerdo];

  // Qualquer pé com resultado alterado ou ausente = neuropatia presente
  return resultados.some((r) => r === "alterado" || r === "ausente");
}

function avaliarDoencaVascular(dadosDiab) {
  // ABI alterado (valor < 0.9 ou > 1.3, ou interpretação explícita)
  const abi = dadosDiab?.abi;
  if (abi) {
    const interpretacoes = [
      abi.interpretacao_direito,
      abi.interpretacao_esquerdo,
    ];
    if (interpretacoes.some((i) => i && i !== "normal")) return true;

    const valorDir = parseFloat(abi.pe_direito);
    const valorEsq = parseFloat(abi.pe_esquerdo);
    if (
      (valorDir && (valorDir < 0.9 || valorDir > 1.3)) ||
      (valorEsq && (valorEsq < 0.9 || valorEsq > 1.3))
    )
      return true;
  }

  // Pulso ausente no exame físico — vem de exame_fisico, passado via dadosDiab
  // (a rota deve mesclar os dois antes de chamar calcularIWGDF)
  if (dadosDiab?._pulsos_ausentes) return true;

  return false;
}

// ── Calcular data de retorno ─────────────────────────────────────────────────

export function calcularProximaConsulta(retornoDias) {
  if (!retornoDias) return null;
  const data = new Date();
  data.setDate(data.getDate() + retornoDias);
  return data.toISOString().split("T")[0]; // formato YYYY-MM-DD
}
