// src/routes/agendamentos.js
// Rotas de agendamentos clínicos
// POST   /agendamentos          → criar (recepção)
// GET    /agendamentos          → listar por estabelecimento + data
// PATCH  /agendamentos/:id      → atualizar status ou observação

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { authenticateToken } from "../lib/auth.js";

const router = Router();

// ─── POST /agendamentos ──────────────────────────────────────────────────────
// Cria agendamento + dispara lembrete D-1 se paciente tem e-mail

router.post("/", authenticateToken, async (req, res) => {
  const {
    paciente_id, // nullable — paciente novo não tem id ainda
    nome_paciente,
    telefone_paciente,
    data_hora,
    observacao,
  } = req.body;

  if (!nome_paciente || !data_hora) {
    return res
      .status(400)
      .json({ error: "nome_paciente e data_hora são obrigatórios" });
  }

  const criado_por = req.user.id;
  const estabelecimento_id = req.user.estabelecimento_id;

  if (!estabelecimento_id) {
    return res
      .status(403)
      .json({ error: "Usuário sem estabelecimento vinculado" });
  }

  try {
    const { data: agendamento, error } = await supabase
      .from("agendamentos")
      .insert({
        estabelecimento_id,
        paciente_id: paciente_id ?? null,
        nome_paciente: nome_paciente.trim(),
        telefone_paciente: telefone_paciente?.trim() ?? null,
        data_hora,
        observacao: observacao?.trim() ?? null,
        status: "agendado",
        criado_por,
      })
      .select()
      .single();

    if (error) {
      console.error("[agendamentos] Erro ao criar:", error.message);
      return res.status(500).json({ error: "Erro ao criar agendamento" });
    }

    // Disparar lembrete D-1 se paciente cadastrado tem e-mail
    let lembreteAgendado = false;
    if (paciente_id) {
      try {
        const { data: paciente } = await supabase
          .from("pacientes")
          .select("email")
          .eq("id", paciente_id)
          .single();

        if (paciente?.email) {
          await supabase.from("alertas").insert({
            paciente_id,
            tipo: "lembrete_consulta",
            agendado_para: calcularD1(data_hora),
            status: "pendente",
          });
          lembreteAgendado = true;
        }
      } catch (errAlerta) {
        // Não bloquear criação do agendamento se alerta falhar
        console.error(
          "[agendamentos] Erro ao agendar lembrete:",
          errAlerta.message,
        );
      }
    }

    res.status(201).json({ agendamento, lembrete_agendado: lembreteAgendado });
  } catch (err) {
    console.error("[agendamentos] Erro:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── GET /agendamentos ───────────────────────────────────────────────────────
// Lista agendamentos do estabelecimento
// Query params:
//   data    → filtrar por dia específico (YYYY-MM-DD) — padrão: hoje
//   semana  → "true" para retornar 7 dias a partir de ?data

router.get("/", authenticateToken, async (req, res) => {
  const estabelecimento_id = req.user.estabelecimento_id;

  if (!estabelecimento_id) {
    return res
      .status(403)
      .json({ error: "Usuário sem estabelecimento vinculado" });
  }

  const { data: dataParam, semana } = req.query;

  // Calcular intervalo
  const dataBase = dataParam ? new Date(dataParam) : new Date();
  dataBase.setHours(0, 0, 0, 0);

  const dataFim = new Date(dataBase);
  if (semana === "true") {
    dataFim.setDate(dataFim.getDate() + 7);
  } else {
    dataFim.setHours(23, 59, 59, 999);
  }

  try {
    const { data: agendamentos, error } = await supabase
      .from("agendamentos")
      .select(
        `
        id,
        paciente_id,
        nome_paciente,
        telefone_paciente,
        data_hora,
        observacao,
        status,
        criado_por,
        created_at
      `,
      )
      .eq("estabelecimento_id", estabelecimento_id)
      .gte("data_hora", dataBase.toISOString())
      .lte("data_hora", dataFim.toISOString())
      .order("data_hora", { ascending: true });

    if (error) {
      console.error("[agendamentos] Erro ao listar:", error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ agendamentos: agendamentos ?? [] });
  } catch (err) {
    console.error("[agendamentos] Erro:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── PATCH /agendamentos/:id ─────────────────────────────────────────────────
// Atualiza status (cancelado | realizado) ou observação

router.patch("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status, observacao } = req.body;

  const statusPermitidos = ["agendado", "cancelado", "realizado"];
  if (status && !statusPermitidos.includes(status)) {
    return res
      .status(400)
      .json({
        error: `Status inválido. Permitidos: ${statusPermitidos.join(", ")}`,
      });
  }

  const estabelecimento_id = req.user.estabelecimento_id;

  try {
    // Garantir que o agendamento pertence ao estabelecimento do usuário
    const { data: existente } = await supabase
      .from("agendamentos")
      .select("id, estabelecimento_id, paciente_id, data_hora, status")
      .eq("id", id)
      .single();

    if (!existente) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (existente.estabelecimento_id !== estabelecimento_id) {
      return res.status(403).json({ error: "Sem permissão" });
    }

    const payload = {};
    if (status) payload.status = status;
    if (observacao !== undefined)
      payload.observacao = observacao?.trim() ?? null;

    const { data: atualizado, error } = await supabase
      .from("agendamentos")
      .update(payload)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Se cancelado: arquivar lembrete pendente
    if (status === "cancelado" && existente.paciente_id) {
      await supabase
        .from("alertas")
        .update({ status: "enviado" })
        .eq("paciente_id", existente.paciente_id)
        .eq("tipo", "lembrete_consulta")
        .eq("status", "pendente")
        .gte("agendado_para", new Date(existente.data_hora).toISOString());
    }

    res.json({ agendamento: atualizado });
  } catch (err) {
    console.error("[agendamentos] Erro ao atualizar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcularD1(dataHoraIso) {
  const d = new Date(dataHoraIso);
  d.setDate(d.getDate() - 1);
  return d.toISOString();
}

export default router;
