// src/routes/equipe.js
// Rota interna: envia e-mail de convite para membro da equipe
// Chamada pela rota Next.js /api/equipe/convidar (sem autenticação extra —
// a validação já foi feita no frontend; rota é interna/não exposta ao público)

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { enviarConviteEquipe } from "../lib/mailer.js";

const router = Router();

function adminSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

// POST /equipe/enviar-convite
router.post("/enviar-convite", async (req, res) => {
  const { email, nome, role, nomeClinica, nomeDono, userId } = req.body;

  if (!email || !nome || !role || !userId) {
    return res.status(400).json({ error: "Dados obrigatórios ausentes." });
  }

  try {
    const supabase = adminSupabase();

    // Gerar Magic Link de primeiro acesso via Supabase Auth
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: `${process.env.APP_URL}/auth/primeiro-acesso`,
        },
      });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[equipe] erro ao gerar Magic Link:", linkError);
      return res.status(500).json({ error: "Erro ao gerar link de acesso." });
    }

    const magicLink = linkData.properties.action_link;

    // Enviar e-mail de convite
    await enviarConviteEquipe({
      email,
      nome,
      role,
      nomeClinica,
      nomeDono,
      magicLink,
    });

    console.log(`[equipe] Convite enviado para ${email} (${role})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[equipe] erro inesperado:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
