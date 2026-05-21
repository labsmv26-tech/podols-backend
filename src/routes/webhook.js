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
      // getUserById exige UUID válido de auth.users — buscar profile.id separadamente
      try {
        const { data: profile, error: errProfile } = await supabase
          .from("profiles")
          .select("id, nome")
          .eq("estabelecimento_id", estabelecimento.id)
          .eq("role", "prestador")
          .single();

        if (errProfile || !profile?.id) {
          console.warn(
            "[webhook] Profile prestador não encontrado para:",
            estabelecimento.id,
          );
          return;
        }

        const { data: authData, error: errAuth } =
          await supabase.auth.admin.getUserById(profile.id);

        if (errAuth || !authData?.user?.email) {
          console.warn(
            "[webhook] E-mail não encontrado para profile:",
            profile.id,
          );
          return;
        }

        await enviarBoasVindasPrestador(
          authData.user.email,
          estabelecimento.nome,
        );

        console.log(
          `[webhook] Boas-vindas enviado para: ${authData.user.email}`,
        );
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
