// src/routes/webhook.js
// Webhook AsaaS — GET + POST no mesmo endpoint (lição 24)
// GET: validação ao cadastrar o webhook no painel AsaaS
// POST: processa eventos de pagamento

import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { enviarBoasVindasPrestador } from "../lib/mailer.js";

const router = Router();

// ─── GET /webhook/asaas ──────────────────────────────────────────────────────
// AsaaS faz GET ao cadastrar o webhook para validar o endpoint
router.get("/asaas", (req, res) => {
  res.status(200).json({ ok: true });
});

// ─── POST /webhook/asaas ─────────────────────────────────────────────────────
router.post("/asaas", async (req, res) => {
  // Responder 200 imediatamente para evitar timeout do AsaaS
  // (AsaaS pausa webhook após 15 falhas consecutivas — lição 25)
  res.status(200).json({ received: true });

  const { event, payment } = req.body;

  if (!payment?.customer) {
    console.warn("[webhook] Payload sem customer:", JSON.stringify(req.body));
    return;
  }

  const asaasCustomerId = payment.customer;

  try {
    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      // Ativar clínica por 30 dias
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { data: estabelecimento, error } = await supabase
        .from("estabelecimentos")
        .update({
          ativo: true,
          access_expires_at: expiresAt.toISOString(),
        })
        .eq("asaas_customer_id", asaasCustomerId)
        .select("id, nome")
        .single();

      if (error) {
        console.error("[webhook] Erro ao ativar clínica:", error.message);
        return;
      }

      console.log(`[webhook] Clínica ativada: ${estabelecimento?.nome}`);

      // Buscar e-mail do prestador para boas-vindas
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, nome, auth_users:id(email)")
          .eq("estabelecimento_id", estabelecimento.id)
          .eq("role", "prestador")
          .single();

        // Buscar e-mail via auth.users usando service role
        const { data: authUser } = await supabase.auth.admin.getUserById(
          profile?.id,
        );

        if (authUser?.user?.email) {
          await enviarBoasVindasPrestador(
            authUser.user.email,
            estabelecimento.nome,
          );
        }
      } catch (errEmail) {
        console.error(
          "[webhook] Erro ao enviar boas-vindas:",
          errEmail.message,
        );
      }
    }

    if (event === "PAYMENT_OVERDUE") {
      const { error } = await supabase
        .from("estabelecimentos")
        .update({ ativo: false })
        .eq("asaas_customer_id", asaasCustomerId);

      if (error) {
        console.error("[webhook] Erro ao desativar clínica:", error.message);
        return;
      }

      console.log(
        `[webhook] Clínica desativada por inadimplência: ${asaasCustomerId}`,
      );
    }
  } catch (err) {
    console.error("[webhook] Erro geral:", err.message);
  }
});

export default router;
