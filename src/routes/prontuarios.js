// src/routes/prontuarios.js
import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { calcularIWGDF, calcularProximaConsulta } from "../services/iwgdf.js";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// POST /prontuarios — salvar ou atualizar prontuário
router.post("/", async (req, res) => {
  const {
    paciente_id,
    operador_id,
    dados_pessoais_ext,
    historico_podologico,
    dados_sistemicos,
    dados_diabeticos,
    exame_fisico,
    dados_ungueal,
    dados_dermato,
    queixa_atual,
    escore_eva,
    diagnostico,
    conduta,
    proxima_consulta: proximaConsultaEscolhida,
  } = req.body;

  if (!paciente_id || !operador_id) {
    return res
      .status(400)
      .json({ error: "paciente_id e operador_id são obrigatórios" });
  }

  // Mesclar pulsos ausentes no dadosDiab para o motor IWGDF
  const dadosDiabComPulsos = {
    ...dados_diabeticos,
    _pulsos_ausentes: avaliarPulsosAusentes(exame_fisico),
  };

  // Calcular IWGDF
  const iwgdf = calcularIWGDF(dadosDiabComPulsos, dados_sistemicos);
  // A data escolhida pela profissional na conclusão prevalece sobre a sugestão
  const proxima_consulta =
    proximaConsultaEscolhida ?? calcularProximaConsulta(iwgdf.retornoDias);

  const payload = {
    paciente_id,
    operador_id,
    dados_pessoais_ext: dados_pessoais_ext ?? {},
    historico_podologico: historico_podologico ?? {},
    dados_sistemicos: dados_sistemicos ?? {},
    dados_diabeticos: dados_diabeticos ?? {},
    exame_fisico: exame_fisico ?? {},
    dados_ungueal: dados_ungueal ?? {},
    dados_dermato: dados_dermato ?? {},
    queixa_atual: queixa_atual ?? {},
    escore_eva: escore_eva ?? null,
    diagnostico: diagnostico ?? null,
    conduta: conduta ?? null,
    risco_iwgdf: iwgdf.risco,
    proxima_consulta,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("prontuarios")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("Erro ao salvar prontuário:", error);
    return res.status(500).json({ error: error.message });
  }

  // Agendar alerta de retorno IWGDF (D-7) — não bloqueia o salvamento se falhar
  if (proxima_consulta && iwgdf.risco !== null) {
    try {
      const dataAlerta = new Date(`${proxima_consulta}T12:00:00-04:00`);
      dataAlerta.setDate(dataAlerta.getDate() - 7);

      // Arquivar alertas pendentes anteriores do mesmo tipo para este paciente
      await supabase
        .from("alertas")
        .update({ status: "enviado" })
        .eq("paciente_id", paciente_id)
        .eq("tipo", "retorno_iwgdf")
        .eq("status", "pendente");

      await supabase.from("alertas").insert({
        paciente_id,
        tipo: "retorno_iwgdf",
        risco_iwgdf: iwgdf.risco,
        agendado_para: dataAlerta.toISOString(),
        status: "pendente",
      });
    } catch (errAlerta) {
      console.error(
        "[prontuarios] Erro ao agendar alerta de retorno:",
        errAlerta.message,
      );
    }
  }

  return res.status(201).json({
    prontuario: data,
    iwgdf: {
      risco: iwgdf.risco,
      proxima_consulta,
      justificativa: iwgdf.justificativa,
    },
  });
});

// POST /prontuarios/iwgdf-preview — calcula o risco sem salvar
// Usado na etapa de conclusão para pré-sugerir a data de retorno
// (path fixo antes da rota dinâmica /:paciente_id — lição 14)
router.post("/iwgdf-preview", (req, res) => {
  const { dados_diabeticos, dados_sistemicos, exame_fisico } = req.body;

  const dadosDiabComPulsos = {
    ...dados_diabeticos,
    _pulsos_ausentes: avaliarPulsosAusentes(exame_fisico),
  };

  const iwgdf = calcularIWGDF(dadosDiabComPulsos, dados_sistemicos);

  return res.json({
    risco: iwgdf.risco,
    retorno_dias: iwgdf.retornoDias,
    proxima_consulta_sugerida: calcularProximaConsulta(iwgdf.retornoDias),
    justificativa: iwgdf.justificativa,
  });
});

// GET /prontuarios/:paciente_id — histórico do paciente
router.get("/:paciente_id", async (req, res) => {
  const { paciente_id } = req.params;

  const { data, error } = await supabase
    .from("prontuarios")
    .select("*")
    .eq("paciente_id", paciente_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ prontuarios: data });
});

// ── Helper ───────────────────────────────────────────────────────────────────

function avaliarPulsosAusentes(exame_fisico) {
  if (!exame_fisico?.pulsos_distais) return false;
  const p = exame_fisico.pulsos_distais;
  return [
    p.pedioso_direito,
    p.pedioso_esquerdo,
    p.tibial_posterior_direito,
    p.tibial_posterior_esquerdo,
  ].some((v) => v === "ausente");
}

export default router;
