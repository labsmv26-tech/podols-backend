import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();
const ASAAS_URL = "https://api.asaas.com/v3";

router.post("/gerar-link", async (req, res) => {
  const { estabelecimento_id, nome, email, cpfCnpj, plano } = req.body;

  const VALORES = { basico: 49, rede: 129, bandeira: 299 };
  const valor = VALORES[plano] ?? 49;

  try {
    // 1. Cria customer no AsaaS
    const custResp = await fetch(`${ASAAS_URL}/customers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: process.env.ASAAS_API_KEY,
      },
      body: JSON.stringify({ name: nome, email, cpfCnpj }),
    });
    const customer = await custResp.json();

    // 2. Cria cobrança recorrente
    const chargeResp = await fetch(`${ASAAS_URL}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: process.env.ASAAS_API_KEY,
      },
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED", // Pix + Cartão
        value: valor,
        dueDate: new Date(Date.now() + 86400000 * 3)
          .toISOString()
          .split("T")[0],
        description: `Podols — Plano ${plano}`,
        cycle: "MONTHLY",
      }),
    });
    const charge = await chargeResp.json();

    // 3. Salva no Supabase
    await supabase
      .from("estabelecimentos")
      .update({
        asaas_customer_id: customer.id,
        payment_url: charge.invoiceUrl ?? charge.bankSlipUrl,
      })
      .eq("id", estabelecimento_id);

    res.json({ payment_url: charge.invoiceUrl ?? charge.bankSlipUrl });
  } catch (err) {
    console.error("Erro gerar-link:", err);
    res.status(500).json({ error: "Erro ao gerar link de pagamento" });
  }
});

export default router;
