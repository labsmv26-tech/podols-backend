import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { authenticateToken } from "../lib/auth.js";

const router = Router();

// POST /sessoes
// Cria uma nova sessão em andamento vinculada a um prontuário
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { paciente_id } = req.body;

    if (!paciente_id) {
      return res.status(400).json({ error: "paciente_id é obrigatório." });
    }

    // Verificar se já existe sessão em andamento para este paciente
    const { data: existente } = await supabase
      .from("sessoes")
      .select("id")
      .eq("paciente_id", paciente_id)
      .eq("status", "em_andamento")
      .maybeSingle();

    if (existente) {
      return res.status(200).json({ id: existente.id, resumida: true });
    }

    // Buscar prontuário mais recente do paciente
    const { data: prontuarios } = await supabase
      .from("prontuarios")
      .select("id")
      .eq("paciente_id", paciente_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const prontuario_id = prontuarios?.[0]?.id ?? null;

    const { data, error } = await supabase
      .from("sessoes")
      .insert({
        prontuario_id,
        paciente_id,
        operador_id: req.user.id,
        status: "em_andamento",
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    console.error("[POST /sessoes]", err);
    return res.status(500).json({ error: err.message || "Erro interno." });
  }
});

// GET /sessoes/prontuario/:prontuario_id
// Lista todas as sessões de um prontuário
router.get(
  "/prontuario/:prontuario_id",
  authenticateToken,
  async (req, res) => {
    try {
      const { prontuario_id } = req.params;

      const { data, error } = await supabase
        .from("sessoes")
        .select(
          `
        id, status, data_atendimento,
        procedimentos, observacoes, valor_cobrado,
        operador_id
      `,
        )
        .eq("prontuario_id", prontuario_id)
        .order("data_atendimento", { ascending: false });

      if (error) throw error;

      return res.json(data);
    } catch (err) {
      console.error("[GET /sessoes/prontuario]", err);
      return res.status(500).json({ error: err.message || "Erro interno." });
    }
  },
);

// PATCH /sessoes/:id
// Atualiza procedimentos, observações e valor da sessão em andamento
router.patch("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { procedimentos, observacoes, valor_cobrado } = req.body;

    const { data: sessao, error: findErr } = await supabase
      .from("sessoes")
      .select("id, status")
      .eq("id", id)
      .single();

    if (findErr || !sessao) {
      return res.status(404).json({ error: "Sessão não encontrada." });
    }

    if (sessao.status !== "em_andamento") {
      return res
        .status(400)
        .json({ error: "Apenas sessões em andamento podem ser editadas." });
    }

    const { data, error } = await supabase
      .from("sessoes")
      .update({ procedimentos, observacoes, valor_cobrado })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error("[PATCH /sessoes]", err);
    return res.status(500).json({ error: err.message || "Erro interno." });
  }
});

// PATCH /sessoes/:id/concluir
// Conclui a sessão — ponto de integração futura com Magic Link e alertas
router.patch("/:id/concluir", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: sessao, error: findErr } = await supabase
      .from("sessoes")
      .select("id, status, prontuario_id, paciente_id")
      .eq("id", id)
      .single();

    if (findErr || !sessao) {
      return res.status(404).json({ error: "Sessão não encontrada." });
    }

    if (sessao.status !== "em_andamento") {
      return res
        .status(400)
        .json({ error: "Sessão já foi concluída ou cancelada." });
    }

    // Buscar dados do prontuário para retornar risco IWGDF
    const { data: prontuario } = await supabase
      .from("prontuarios")
      .select("risco_iwgdf, proxima_consulta, diagnostico, conduta")
      .eq("id", sessao.prontuario_id)
      .single();

    const { data, error } = await supabase
      .from("sessoes")
      .update({ status: "concluida" })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // TODO Semana 5: gerar Magic Link + agendar alerta IWGDF

    return res.json({
      sessao: data,
      prontuario: {
        risco_iwgdf: prontuario?.risco_iwgdf ?? null,
        proxima_consulta: prontuario?.proxima_consulta ?? null,
        diagnostico: prontuario?.diagnostico ?? null,
        conduta: prontuario?.conduta ?? null,
      },
    });
  } catch (err) {
    console.error("[PATCH /sessoes/concluir]", err);
    return res.status(500).json({ error: err.message || "Erro interno." });
  }
});

export default router;
