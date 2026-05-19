// src/routes/magiclink.js
// Magic Link — acesso do paciente ao próprio prontuário (sem login)
// LGPD: token_hash gravado (nunca o token bruto), IP e timestamp a cada acesso

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

const TTL_SEGUNDOS = 72 * 60 * 60; // 72 horas

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

// ─── POST /magiclink/gerar ───────────────────────────────────────────────────
// Recebe: { paciente_id }
// Autenticado: podóloga ou admin
// Gera token, grava no Redis + banco, envia e-mail ao paciente

router.post("/gerar", authenticateToken, async (req, res) => {
  const { paciente_id } = req.body;

  if (!paciente_id) {
    return res.status(400).json({ error: "paciente_id obrigatório" });
  }

  try {
    // Buscar paciente
    const { data: paciente, error: errPac } = await supabase
      .from("pacientes")
      .select("id, nome, email, estabelecimento_id")
      .eq("id", paciente_id)
      .single();

    if (errPac || !paciente) {
      return res.status(404).json({ error: "Paciente não encontrado" });
    }

    if (!paciente.email) {
      return res.status(422).json({ error: "Paciente sem e-mail cadastrado" });
    }

    // Buscar nome da clínica para o e-mail
    const { data: clinica } = await supabase
      .from("estabelecimentos")
      .select("nome")
      .eq("id", paciente.estabelecimento_id)
      .single();

    // Gerar token bruto (UUID) — nunca salvar no banco, só o hash
    const token = randomUUID();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TTL_SEGUNDOS * 1000).toISOString();

    // Salvar hash no Redis com TTL
    await redis.set(`ml:${tokenHash}`, paciente_id, { ex: TTL_SEGUNDOS });

    // Salvar log no banco (LGPD)
    const { error: errDb } = await supabase.from("magic_links").insert({
      paciente_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    if (errDb) {
      console.error("[magiclink] Erro ao salvar no banco:", errDb.message);
      // Não bloquear — Redis já tem o token
    }

    // Enviar e-mail
    await enviarMagicLink(paciente.email, paciente.nome, token);

    console.log(`[magiclink] Gerado para paciente ${paciente_id}`);

    res.json({
      ok: true,
      email: paciente.email,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error("[magiclink] Erro ao gerar:", err.message);
    res.status(500).json({ error: "Erro interno ao gerar Magic Link" });
  }
});

// ─── GET /magiclink/validar/:token ──────────────────────────────────────────
// Rota pública — chamada pelo frontend ao carregar /p/[token]
// Retorna dados do paciente se o token for válido

router.get("/validar/:token", async (req, res) => {
  const { token } = req.params;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (!token) {
    return res.status(400).json({ error: "Token obrigatório" });
  }

  try {
    const tokenHash = hashToken(token);

    // Verificar no Redis
    const pacienteId = await redis.get(`ml:${tokenHash}`);

    if (!pacienteId) {
      return res.status(401).json({ error: "Link expirado ou inválido" });
    }

    // Registrar acesso (LGPD: IP + timestamp)
    await supabase
      .from("magic_links")
      .update({ used_at: new Date().toISOString(), ip_acesso: ip })
      .eq("token_hash", tokenHash)
      .is("used_at", null); // registrar só o primeiro acesso

    // Buscar dados do paciente
    const { data: paciente, error: errPac } = await supabase
      .from("pacientes")
      .select("id, nome, data_nascimento, telefone, estabelecimento_id")
      .eq("id", pacienteId)
      .single();

    if (errPac || !paciente) {
      return res.status(404).json({ error: "Paciente não encontrado" });
    }

    // Buscar nome da clínica
    const { data: clinica } = await supabase
      .from("estabelecimentos")
      .select("nome, cidade")
      .eq("id", paciente.estabelecimento_id)
      .single();

    // Buscar prontuário mais recente
    const { data: prontuario } = await supabase
      .from("prontuarios")
      .select(
        "id, risco_iwgdf, diagnostico, conduta, proxima_consulta, updated_at",
      )
      .eq("paciente_id", pacienteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Buscar sessões concluídas (últimas 5)
    const { data: sessoes } = await supabase
      .from("sessoes")
      .select(
        "id, data_atendimento, procedimentos, observacoes, valor_cobrado, status",
      )
      .eq("paciente_id", pacienteId)
      .eq("status", "concluida")
      .order("data_atendimento", { ascending: false })
      .limit(5);

    // Buscar imagens da sessão mais recente (se houver)
    let imagens = [];
    if (sessoes && sessoes.length > 0) {
      const { data: imgs } = await supabase
        .from("imagens")
        .select("id, storage_key, finalidade, created_at")
        .eq("sessao_id", sessoes[0].id);

      if (imgs) {
        // Montar URL pública (R2) — nunca expor storage_key bruto
        imagens = imgs.map((img) => ({
          id: img.id,
          url: `${process.env.R2_PUBLIC_URL}/${img.storage_key}`,
          finalidade: img.finalidade,
          created_at: img.created_at,
        }));
      }
    }

    res.json({
      paciente: {
        nome: paciente.nome,
        data_nascimento: paciente.data_nascimento,
      },
      clinica: clinica ?? null,
      prontuario: prontuario ?? null,
      sessoes: sessoes ?? [],
      imagens,
    });
  } catch (err) {
    console.error("[magiclink] Erro ao validar:", err.message);
    res.status(500).json({ error: "Erro interno ao validar token" });
  }
});

export default router;
