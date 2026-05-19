// src/routes/alertas.js
// Scheduler de alertas por e-mail
// GET /alertas/processar — chamado por cron externo (UptimeRobot ou Render Cron)
// Protegido por CRON_SECRET para evitar chamadas não autorizadas

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import {
  enviarLembreteConsulta,
  enviarAlertaRetornoIwgdf,
} from "../lib/mailer.js";

const router = Router();

// Middleware: verificar CRON_SECRET
function autorizarCron(req, res, next) {
  const secret = req.headers["x-cron-secret"];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

// Formatar data em português
function formatarData(dataIso) {
  return new Date(dataIso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
}

// ─── GET /alertas/processar ──────────────────────────────────────────────────
// Processa alertas pendentes: lembretes D-1 e retornos IWGDF D-7

router.get("/processar", autorizarCron, async (req, res) => {
  const agora = new Date();
  const resultados = { processados: 0, enviados: 0, falhas: 0 };

  try {
    // Buscar alertas pendentes cuja data chegou
    const { data: alertas, error } = await supabase
      .from("alertas")
      .select(
        `
        id,
        tipo,
        risco_iwgdf,
        agendado_para,
        paciente_id,
        pacientes (
          nome,
          email,
          estabelecimento_id,
          estabelecimentos (nome)
        )
      `,
      )
      .eq("status", "pendente")
      .lte("agendado_para", agora.toISOString())
      .limit(50); // processar em lotes para evitar timeout

    if (error) {
      console.error("[alertas] Erro ao buscar alertas:", error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!alertas || alertas.length === 0) {
      return res.json({ ...resultados, mensagem: "Nenhum alerta pendente" });
    }

    for (const alerta of alertas) {
      resultados.processados++;
      const paciente = alerta.pacientes;
      const nomeClinica = paciente?.estabelecimentos?.nome ?? "sua clínica";

      if (!paciente?.email) {
        // Marcar como enviado (sem e-mail cadastrado — não tentar novamente)
        await supabase
          .from("alertas")
          .update({ status: "enviado", enviado_em: agora.toISOString() })
          .eq("id", alerta.id);
        continue;
      }

      try {
        const dataFormatada = formatarData(alerta.agendado_para);

        if (alerta.tipo === "lembrete_consulta") {
          await enviarLembreteConsulta(
            paciente.email,
            paciente.nome,
            dataFormatada,
            nomeClinica,
          );
        } else if (alerta.tipo === "retorno_iwgdf") {
          await enviarAlertaRetornoIwgdf(
            paciente.email,
            paciente.nome,
            dataFormatada,
            alerta.risco_iwgdf,
            nomeClinica,
          );
        }

        await supabase
          .from("alertas")
          .update({ status: "enviado", enviado_em: agora.toISOString() })
          .eq("id", alerta.id);

        resultados.enviados++;
        console.log(`[alertas] ${alerta.tipo} enviado → ${paciente.email}`);
      } catch (errEnvio) {
        console.error(
          `[alertas] Falha ao enviar ${alerta.id}:`,
          errEnvio.message,
        );

        await supabase
          .from("alertas")
          .update({ status: "falhou" })
          .eq("id", alerta.id);

        resultados.falhas++;
      }
    }

    res.json(resultados);
  } catch (err) {
    console.error("[alertas] Erro geral:", err.message);
    res.status(500).json({ error: "Erro interno no processamento de alertas" });
  }
});

// ─── POST /alertas/agendar ───────────────────────────────────────────────────
// Interno: chamado após salvar prontuário para agendar alerta IWGDF
// Usado pelo frontend/backend ao salvar proxima_consulta no prontuário

router.post("/agendar", async (req, res) => {
  const { paciente_id, tipo, risco_iwgdf, agendado_para } = req.body;

  if (!paciente_id || !tipo || !agendado_para) {
    return res
      .status(400)
      .json({ error: "paciente_id, tipo e agendado_para são obrigatórios" });
  }

  try {
    // D-7 para retorno IWGDF: agendar 7 dias antes da data de retorno
    // D-1 para lembrete de consulta: agendar 1 dia antes
    const dataBase = new Date(agendado_para);
    const diasAntes = tipo === "retorno_iwgdf" ? 7 : 1;
    const dataAlerta = new Date(dataBase);
    dataAlerta.setDate(dataAlerta.getDate() - diasAntes);

    // Cancelar alertas anteriores do mesmo tipo para este paciente
    await supabase
      .from("alertas")
      .update({ status: "enviado" }) // "arquivar" silenciosamente
      .eq("paciente_id", paciente_id)
      .eq("tipo", tipo)
      .eq("status", "pendente");

    const { data, error } = await supabase
      .from("alertas")
      .insert({
        paciente_id,
        tipo,
        risco_iwgdf: risco_iwgdf ?? null,
        agendado_para: dataAlerta.toISOString(),
        status: "pendente",
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ alerta: data });
  } catch (err) {
    console.error("[alertas] Erro ao agendar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
