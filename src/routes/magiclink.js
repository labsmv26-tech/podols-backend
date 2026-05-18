import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

// Middleware: verificar Bearer token do staff
function requireStaff(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.sendStatus(401);
  req.token = auth.replace("Bearer ", "");
  next();
}

router.post("/gerar", requireStaff, async (req, res) => {
  const { paciente_id } = req.body;

  // Busca dados do paciente
  const { data: paciente } = await supabase
    .from("pacientes")
    .select("id, nome, email")
    .eq("id", paciente_id)
    .single();

  if (!paciente)
    return res.status(404).json({ error: "Paciente não encontrado" });
  if (!paciente.email)
    return res.status(400).json({ error: "Paciente sem e-mail cadastrado" });

  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

  // Grava o hash (nunca o token bruto) — LGPD
  await supabase.from("magic_links").insert({
    paciente_id,
    token_hash: hash,
    expires_at: expires.toISOString(),
  });

  const url = `https://www.podols.com.br/p/${token}`;

  await sendEmail({
    to: paciente.email,
    subject: "Seu prontuário Podols",
    html: `<p>Olá ${paciente.nome},</p>
           <p>Acesse seu prontuário pelo link abaixo (válido por 72 horas):</p>
           <p><a href="${url}">${url}</a></p>
           <p>Este link é pessoal e intransferível.</p>`,
  });

  res.json({ ok: true, expires_at: expires.toISOString() });
});

router.get("/validar/:token", async (req, res) => {
  const { token } = req.params;
  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress;

  const hash = createHash("sha256").update(token).digest("hex");

  const { data: link } = await supabase
    .from("magic_links")
    .select("*")
    .eq("token_hash", hash)
    .is("used_at", null)
    .single();

  if (!link)
    return res.status(404).json({ error: "Link inválido ou expirado" });

  if (new Date(link.expires_at) < new Date()) {
    return res.status(410).json({ error: "Link expirado" });
  }

  // Marca como usado + registra IP (evidência LGPD)
  await supabase
    .from("magic_links")
    .update({ used_at: new Date().toISOString(), ip_acesso: ip })
    .eq("id", link.id);

  // Retorna prontuário somente leitura
  const { data: prontuario } = await supabase
    .from("prontuarios")
    .select("*, pacientes(nome, data_nascimento), sessoes(*)")
    .eq("paciente_id", link.paciente_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  res.json({ paciente_id: link.paciente_id, prontuario });
});

export default router;
