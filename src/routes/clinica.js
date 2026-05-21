// src/routes/clinica.js
// Cadastro self-service da clínica + integração AsaaS
// POST /clinica/gerar-link — cria customer + cobrança no AsaaS
import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

const ASAAS_BASE = "https://api.asaas.com/v3";
const ASAAS_HEADERS = {
  "Content-Type": "application/json",
  access_token: process.env.ASAAS_API_KEY,
};

const PLANOS = {
  basico: { nome: "Podols Básico", valor: 49.0 },
  basico_anual: { nome: "Podols Básico Anual", valor: 490.0 },
  rede: { nome: "Podols Rede", valor: 129.0 },
  bandeira: { nome: "Podols Bandeira", valor: 299.0 },
};

// ─── POST /clinica/gerar-link ─────────────────────────────────────────────────
// Recebe: { estabelecimento_id, email, nome, plano, cpfCnpj }
// cpfCnpj obrigatório — AsaaS exige para criar cobrança (lição 96)
router.post("/gerar-link", async (req, res) => {
  const {
    estabelecimento_id,
    email,
    nome,
    plano = "basico",
    cpfCnpj,
  } = req.body;

  if (!estabelecimento_id || !email || !nome) {
    return res.status(400).json({
      error: "Campos obrigatórios: estabelecimento_id, email, nome",
    });
  }

  const planoInfo = PLANOS[plano];
  if (!planoInfo) {
    return res.status(400).json({
      error: `Plano inválido. Use: ${Object.keys(PLANOS).join(", ")}`,
    });
  }

  try {
    // 1. Criar customer no AsaaS
    const customerBody = { name: nome, email };
    if (cpfCnpj) customerBody.cpfCnpj = cpfCnpj;

    const resCustomer = await fetch(`${ASAAS_BASE}/customers`, {
      method: "POST",
      headers: ASAAS_HEADERS,
      body: JSON.stringify(customerBody),
    });
    const customer = await resCustomer.json();

    if (!customer.id) {
      console.error("[clinica] Erro ao criar customer AsaaS:", customer);
      return res.status(502).json({
        error: "Erro ao criar cliente no sistema de pagamento",
      });
    }

    // 2. Criar cobrança PIX
    // PIX permite simulação no painel AsaaS e não exige dados bancários do cliente
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 15); // trial 14 dias + 1 dia margem (lição 98)

    const resCobranca = await fetch(`${ASAAS_BASE}/payments`, {
      method: "POST",
      headers: ASAAS_HEADERS,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "PIX",
        value: planoInfo.valor,
        dueDate: vencimento.toISOString().split("T")[0],
        description: `${planoInfo.nome} — Podols`,
        externalReference: estabelecimento_id,
      }),
    });
    const cobranca = await resCobranca.json();

    if (!cobranca.invoiceUrl) {
      console.error("[clinica] Erro ao criar cobrança AsaaS:", cobranca);
      return res.status(502).json({ error: "Erro ao gerar link de pagamento" });
    }

    // 3. Salvar customer_id e payment_url no estabelecimento
    const { error: errUpdate } = await supabase
      .from("estabelecimentos")
      .update({
        asaas_customer_id: customer.id,
        payment_url: cobranca.invoiceUrl,
        plano,
      })
      .eq("id", estabelecimento_id);

    if (errUpdate) {
      console.error("[clinica] Erro ao salvar no banco:", errUpdate.message);
    }

    console.log(
      `[clinica] Link PIX gerado para ${estabelecimento_id}: ${cobranca.invoiceUrl}`,
    );

    res.json({
      payment_url: cobranca.invoiceUrl,
      customer_id: customer.id,
    });
  } catch (err) {
    console.error("[clinica] Erro geral:", err.message);
    res.status(500).json({ error: "Erro interno ao processar cadastro" });
  }
});

export default router;
