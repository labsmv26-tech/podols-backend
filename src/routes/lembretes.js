// src/routes/lembretes.js
// Rota de disparo manual do lembrete D-1
// Protegida por CRON_SECRET — nunca expor publicamente

import { Router } from "express";
import { dispararLembretesD1 } from "../jobs/lembrete-d1.js";

const router = Router();

/**
 * GET /lembretes/disparar
 * Header obrigatório: Authorization: Bearer <CRON_SECRET>
 *
 * Uso:
 *   curl -H "Authorization: Bearer SEU_CRON_SECRET" \
 *        https://podols-backend.onrender.com/lembretes/disparar
 */
router.get("/disparar", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;

  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ erro: "Não autorizado." });
  }

  try {
    await dispararLembretesD1();
    return res.json({ ok: true, mensagem: "Job D-1 executado com sucesso." });
  } catch (err) {
    console.error("[lembretes/disparar] Erro:", err.message);
    return res.status(500).json({ erro: err.message });
  }
});

export default router;
