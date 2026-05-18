import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

// AsaaS envia GET ao cadastrar o webhook — responder 200
router.get("/asaas", (_req, res) => {
  res.sendStatus(200);
});

router.post("/asaas", async (req, res) => {
  const { event, payment } = req.body;

  try {
    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      // Localiza a clínica pelo customer_id do AsaaS
      const { data: clinica } = await supabase
        .from("estabelecimentos")
        .select("id, nome")
        .eq("asaas_customer_id", payment.customer)
        .single();

      if (!clinica) {
        console.warn("Webhook AsaaS: clínica não encontrada", payment.customer);
        return res.sendStatus(200); // sempre 200 para não pausar webhook
      }

      const expires = new Date();
      expires.setDate(expires.getDate() + 30);

      await supabase
        .from("estabelecimentos")
        .update({ ativo: true, access_expires_at: expires.toISOString() })
        .eq("id", clinica.id);

      // E-mail de boas-vindas
      await sendEmail({
        to: payment.billingEmail ?? "",
        subject: "Bem-vindo ao Podols!",
        html: `<p>Olá! Sua clínica <strong>${clinica.nome}</strong> foi ativada com sucesso.</p>
               <p>Acesse: <a href="https://www.podols.com.br/auth">www.podols.com.br/auth</a></p>`,
      });
    }

    if (event === "PAYMENT_OVERDUE") {
      await supabase
        .from("estabelecimentos")
        .update({ ativo: false })
        .eq("asaas_customer_id", payment.customer);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook AsaaS error:", err);
    res.sendStatus(200); // sempre 200 — evitar pausa do webhook após 15 falhas
  }
});

export default router;
