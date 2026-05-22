// src/routes/sessoes.js
// Rotas de sessões clínicas — atualizado Semana 5
// PATCH /sessoes/:id/concluir agora gera Magic Link automaticamente se paciente tem e-mail

import { Router } from "express";
import { createHash, randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import { supabase } from "../lib/supabase.js";
import { authenticateToken } from "../lib/auth.js";
import { enviarMagicLink } from "../lib/mailer.js";

const router = Router();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TTL_SEGUNDOS = 72 * 60 * 60;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// ─── POST /sessoes ───────────────────────────────────────────────────────────
// Cria ou retoma sessão em_andamento (idempotente)

router.post("/", authenticateToken, async (req, res) => {
  const { paciente_id } = req.body;
  const operador_id = req.user.id;

  if (!paciente_id) {
    return res.status(400).json({ error: "paciente_id obrigatório" });
  }

  try {
    // Verificar se já existe sessão em_andamento para este paciente
    const { data: existente } = await supabase
      .from("sessoes")
      .select("*")
      .eq("paciente_id", paciente_id)
      .eq("status", "em_andamento")
      .maybeSingle();

    if (existente) {
      return res.json({ sessao: existente, retomada: true });
    }

    // Buscar prontuário mais recente
    const { data: prontuario } = await supabase
      .from("prontuarios")
      .select("id")
      .eq("paciente_id", paciente_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: sessao, error } = await supabase
      .from("sessoes")
      .insert({
        paciente_id,
        prontuario_id: prontuario?.id ?? null,
        operador_id,
        status: "em_andamento",
      })
      .select()
      .single();

    if (error) {
      console.error("[sessoes] Erro ao criar:", error.message);
      return res.status(500).json({ error: "Erro ao criar sessão" });
    }

    res.status(201).json({ sessao, retomada: false });
  } catch (err) {
    console.error("[sessoes] Erro:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── GET /sessoes/prontuario/:id ─────────────────────────────────────────────

router.get("/prontuario/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: sessoes, error } = await supabase
      .from("sessoes")
      .select("*")
      .eq("prontuario_id", id)
      .order("data_atendimento", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json({ sessoes: sessoes ?? [] });
  } catch (err) {
    console.error("[sessoes] Erro ao buscar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── PATCH /sessoes/:id ──────────────────────────────────────────────────────
// Atualiza procedimentos e valor

// ─── Substituir apenas o handler PATCH /:id em src/routes/sessoes.js ─────────
// O restante do arquivo permanece idêntico

// ─── PATCH /sessoes/:id ──────────────────────────────────────────────────────
// Atualiza procedimentos, valor e forma de pagamento

router.patch("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { procedimentos, observacoes, valor_cobrado, forma_pagamento } =
    req.body;

  const formasPermitidas = ["dinheiro", "cartao", "pix"];
  if (forma_pagamento && !formasPermitidas.includes(forma_pagamento)) {
    return res.status(400).json({
      error: `forma_pagamento inválida. Permitidas: ${formasPermitidas.join(", ")}`,
    });
  }

  try {
    const payload = {};
    if (procedimentos !== undefined) payload.procedimentos = procedimentos;
    if (observacoes !== undefined) payload.observacoes = observacoes;
    if (valor_cobrado !== undefined) payload.valor_cobrado = valor_cobrado;
    if (forma_pagamento !== undefined)
      payload.forma_pagamento = forma_pagamento;

    const { data, error } = await supabase
      .from("sessoes")
      .update(payload)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ sessao: data });
  } catch (err) {
    console.error("[sessoes] Erro ao atualizar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── PATCH /sessoes/:id/concluir ─────────────────────────────────────────────
// Conclui sessão + gera Magic Link automaticamente se paciente tem e-mail

router.patch("/:id/concluir", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar sessão
    const { data: sessao, error: errSessao } = await supabase
      .from("sessoes")
      .select("id, paciente_id, status")
      .eq("id", id)
      .single();

    if (errSessao || !sessao) {
      return res.status(404).json({ error: "Sessão não encontrada" });
    }

    if (sessao.status === "concluida") {
      return res.status(409).json({ error: "Sessão já concluída" });
    }

    // Concluir sessão
    const { data: sessaoAtualizada, error: errUpdate } = await supabase
      .from("sessoes")
      .update({ status: "concluida" })
      .eq("id", id)
      .select()
      .single();

    if (errUpdate) {
      return res.status(500).json({ error: errUpdate.message });
    }

    // Gerar Magic Link se paciente tem e-mail
    let magicLinkEnviado = false;
    let emailDestinatario = null;

    try {
      const { data: paciente } = await supabase
        .from("pacientes")
        .select("nome, email, estabelecimento_id")
        .eq("id", sessao.paciente_id)
        .single();

      if (paciente?.email) {
        const token = randomUUID();
        const tokenHash = hashToken(token);
        const expiresAt = new Date(
          Date.now() + TTL_SEGUNDOS * 1000,
        ).toISOString();

        await redis.set(`ml:${tokenHash}`, sessao.paciente_id, {
          ex: TTL_SEGUNDOS,
        });

        await supabase.from("magic_links").insert({
          paciente_id: sessao.paciente_id,
          token_hash: tokenHash,
          expires_at: expiresAt,
        });

        await enviarMagicLink(paciente.email, paciente.nome, token);

        magicLinkEnviado = true;
        emailDestinatario = paciente.email;
        console.log(`[sessoes] Magic Link enviado para ${paciente.email}`);
      }
    } catch (errMl) {
      // Não bloquear a conclusão da sessão se o Magic Link falhar
      console.error("[sessoes] Erro ao gerar Magic Link:", errMl.message);
    }

    res.json({
      sessao: sessaoAtualizada,
      magic_link_enviado: magicLinkEnviado,
      email_destinatario: emailDestinatario,
    });
  } catch (err) {
    console.error("[sessoes] Erro ao concluir:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
