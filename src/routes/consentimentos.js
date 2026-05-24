// src/routes/consentimentos.js
// TCLE digital — registro de consentimento com trilha de auditoria LGPD
// Tipos: 'tcle' (geral) e 'imagem' (autorização de fotos clínicas)

import { Router } from "express";
import { createHash } from "crypto";
import { supabase } from "../lib/supabase.js";
import { authenticateToken } from "../lib/auth.js";

const router = Router();

// Versões imutáveis dos termos — ao alterar o texto, incrementar a versão
// O hash garante que o conteúdo aceito está documentado
export const TERMOS = {
  tcle: {
    versao: "1.0",
    titulo: "Termo de Consentimento Livre e Esclarecido (TCLE)",
    texto: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO

Clínica / Estabelecimento: conforme cadastro no sistema Podols
Sistema: Podols — Gestão Clínica para Podologia
Operado por: VWDAP Soluções Digitais Ltda, CNPJ 48.535.885/0001-50

1. FINALIDADE DO TRATAMENTO DE DADOS
Seus dados pessoais e de saúde serão coletados e tratados exclusivamente para fins de prestação de serviços podológicos, incluindo: registro de anamnese, histórico clínico, avaliação de risco (protocolo IWGDF), controle de retornos e comunicação sobre seu atendimento.

2. DADOS COLETADOS
Nome completo, data de nascimento, CPF, telefone, e-mail, histórico de saúde, medicamentos em uso, alergias, dados de exame físico dos pés e imagens clínicas (mediante autorização específica).

3. BASE LEGAL
O tratamento é realizado com base no seu consentimento (Art. 7º, I, LGPD) e para a tutela da saúde (Art. 7º, VIII, LGPD), observando a Resolução CFM nº 1.821/2007 sobre prontuários.

4. RETENÇÃO DOS DADOS
Seus dados de saúde serão mantidos por no mínimo 20 anos após o último atendimento, conforme obrigação legal aplicável a prontuários médicos e de saúde no Brasil.

5. SEUS DIREITOS (LGPD, Art. 18)
Você tem direito a: confirmar a existência de tratamento, acessar seus dados, corrigir dados incompletos ou desatualizados, solicitar anonimização, bloqueio ou eliminação de dados desnecessários, revogar este consentimento a qualquer momento.

6. ACESSO AO PRONTUÁRIO
Você poderá acessar seu prontuário a qualquer momento mediante solicitação à clínica ou pelo link de acesso (Magic Link) enviado por e-mail após cada atendimento.

7. SEGURANÇA
Os dados são armazenados em servidores com criptografia em repouso e em trânsito (TLS 1.3), em infraestrutura localizada no Brasil.

8. CONTATO DO RESPONSÁVEL PELO TRATAMENTO
Para exercer seus direitos ou obter esclarecimentos: contato@vwdap.com.br

Ao aceitar este termo, você declara ter lido, compreendido e concordado com as condições acima, de forma livre e esclarecida.`,
  },

  imagem: {
    versao: "1.0",
    titulo: "Autorização de Captação e Uso de Imagens Clínicas",
    texto: `AUTORIZAÇÃO DE CAPTAÇÃO E USO DE IMAGENS CLÍNICAS

Clínica / Estabelecimento: conforme cadastro no sistema Podols
Sistema: Podols — Gestão Clínica para Podologia

1. FINALIDADE
As fotografias clínicas dos seus pés serão utilizadas exclusivamente para:
- Documentação do estado clínico em cada sessão
- Acompanhamento da evolução do tratamento
- Registro em prontuário para consultas futuras
- Comunicação clínica entre profissionais envolvidos no seu cuidado (quando necessário)

2. O QUE SERÁ FOTOGRAFADO
Somente as regiões dos pés diretamente relacionadas ao atendimento podológico (unhas, planta, dorso, dedos e calcanhares, conforme necessidade clínica).

3. ARMAZENAMENTO
As imagens serão armazenadas de forma segura, vinculadas ao seu prontuário, com identificação por código anônimo (sem CPF ou nome no arquivo). Acesso restrito à equipe clínica autorizada.

4. VEDAÇÕES EXPRESSAS
As imagens NÃO serão:
- Publicadas em redes sociais ou materiais de marketing sem nova autorização específica
- Compartilhadas com terceiros sem sua autorização, exceto para fins de encaminhamento clínico
- Utilizadas para fins de pesquisa sem novo termo específico

5. REVOGAÇÃO
Você pode revogar esta autorização a qualquer momento, solicitando à clínica a exclusão das imagens do sistema. A revogação não afeta os registros já realizados até a data do pedido.

6. RETENÇÃO
As imagens clínicas seguem o mesmo prazo de retenção do prontuário (mínimo 20 anos).

Ao aceitar este termo, você autoriza expressamente a captação e o uso das suas imagens clínicas nos termos descritos acima.`,
  },
};

// Gerar hash do conteúdo aceito (SHA-256 do texto + versão + timestamp)
function gerarHashIntegridade(tipo, timestamp) {
  const termo = TERMOS[tipo];
  const conteudo = `${termo.versao}|${tipo}|${timestamp}|${termo.texto}`;
  return createHash("sha256").update(conteudo).digest("hex");
}

// ─── POST /consentimentos ────────────────────────────────────────────────────
// Registra aceite do paciente
// Body: { paciente_id, tipo: 'tcle' | 'imagem' }

router.post("/", authenticateToken, async (req, res) => {
  const { paciente_id, tipo } = req.body;
  const ip = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress;
  const operador_id = req.user.id;

  if (!paciente_id || !tipo) {
    return res
      .status(400)
      .json({ error: "paciente_id e tipo são obrigatórios" });
  }

  if (!TERMOS[tipo]) {
    return res
      .status(400)
      .json({ error: "Tipo inválido. Use: tcle ou imagem" });
  }

  try {
    const agora = new Date().toISOString();
    const hashIntegridade = gerarHashIntegridade(tipo, agora);
    const versao = TERMOS[tipo].versao;

    // Verificar se já existe consentimento ativo do mesmo tipo
    const { data: existente } = await supabase
      .from("consentimentos")
      .select("id, assinado_em, versao")
      .eq("paciente_id", paciente_id)
      .eq("tipo", tipo)
      .is("revogado_em", null)
      .maybeSingle();

    if (existente) {
      // Se já existe e é a mesma versão, retornar sem duplicar
      if (existente.versao === versao) {
        return res.status(409).json({
          error: "Consentimento já registrado para este paciente",
          assinado_em: existente.assinado_em,
        });
      }
      // Se versão diferente, revogar o anterior e criar novo
      await supabase
        .from("consentimentos")
        .update({ revogado_em: agora })
        .eq("id", existente.id);
    }

    const { data, error } = await supabase
      .from("consentimentos")
      .insert({
        paciente_id,
        tipo,
        assinado_em: agora,
        ip,
        hash_integridade: hashIntegridade,
        versao, // campo a adicionar na tabela — ver migração abaixo
        operador_id, // quem registrou o aceite
      })
      .select()
      .single();

    if (error) {
      console.error("[consentimentos] Erro ao registrar:", error.message);
      return res.status(500).json({ error: error.message });
    }

    console.log(
      `[consentimentos] ${tipo} registrado — paciente ${paciente_id} — IP ${ip}`,
    );

    res.status(201).json({
      ok: true,
      id: data.id,
      tipo,
      versao,
      assinado_em: agora,
      hash_integridade: hashIntegridade,
    });
  } catch (err) {
    console.error("[consentimentos] Erro:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── GET /consentimentos/termos/:tipo ────────────────────────────────────────
// Retorna o texto do termo para exibição no modal (rota pública)

router.get("/termos/:tipo", (req, res) => {
  const { tipo } = req.params;

  if (!TERMOS[tipo]) {
    return res.status(404).json({ error: "Termo não encontrado" });
  }

  res.json(TERMOS[tipo]);
});

// ─── POST /consentimentos/whatsapp/enviar ────────────────────────────────────
// Gera token único e envia link de consentimento via WhatsApp
// Body: { sessao_id, paciente_id, estabelecimento_id, telefone }

router.post("/whatsapp/enviar", authenticateToken, async (req, res) => {
  const { sessao_id, paciente_id, estabelecimento_id, telefone } = req.body;

  if (!sessao_id || !paciente_id || !estabelecimento_id || !telefone) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  const telefoneLimpo = telefone.replace(/\D/g, "");

  const { data: consentimento, error: insertError } = await supabase
    .from("consentimentos")
    .insert({
      sessao_id,
      paciente_id,
      estabelecimento_id,
      telefone: telefoneLimpo,
      tipo: "imagem",
      versao: TERMOS.imagem.versao,
      texto_termo: TERMOS.imagem.texto,
      hash_integridade: gerarHashIntegridade(
        "imagem",
        new Date().toISOString(),
      ),
      status: "pendente",
      expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single();

  if (insertError) {
    console.error("[consentimentos] Erro ao criar:", insertError.message);
    return res.status(500).json({ error: "Erro ao criar consentimento." });
  }

  const link = `${process.env.APP_URL}/consentimento/${consentimento.token}`;
  const numero = telefoneLimpo.startsWith("55")
    ? telefoneLimpo
    : `55${telefoneLimpo}`;

  const mensagem =
    `Olá! Sua podóloga solicita sua autorização para registro fotográfico do atendimento de hoje.\n\n` +
    `Acesse o link, leia o termo e confirme:\n${link}\n\n` +
    `O link expira em 24 horas.`;

  try {
    const evolucaoRes = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendText/podols`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ number: numero, text: mensagem }),
      },
    );

    if (!evolucaoRes.ok) {
      const err = await evolucaoRes.text();
      console.error("[consentimentos] Evolution erro:", err);
      return res.status(502).json({ error: "Erro ao enviar WhatsApp." });
    }
  } catch (e) {
    console.error("[consentimentos] Evolution exception:", e.message);
    return res.status(502).json({ error: "Erro ao conectar Evolution API." });
  }

  return res.json({ ok: true, token: consentimento.token });
});

// ─── POST /consentimentos/whatsapp/:token/aceitar ────────────────────────────
// Rota pública — paciente confirma aceite pelo link recebido no WhatsApp

router.post("/whatsapp/:token/aceitar", async (req, res) => {
  const { token } = req.params;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  const { data, error } = await supabase
    .from("consentimentos")
    .select("id, status, expira_em")
    .eq("token", token)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Termo não encontrado." });
  }

  if (data.status === "aceito") {
    return res.json({ ok: true, mensagem: "Termo já aceito anteriormente." });
  }

  if (new Date(data.expira_em) < new Date()) {
    return res.status(410).json({ error: "Este link expirou." });
  }

  const agora = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("consentimentos")
    .update({
      status: "aceito",
      assinado_em: agora,
      ip,
      aceito_user_agent: userAgent,
    })
    .eq("id", data.id);

  if (updateError) {
    console.error(
      "[consentimentos] Erro ao registrar aceite:",
      updateError.message,
    );
    return res.status(500).json({ error: "Erro ao registrar aceite." });
  }

  return res.json({
    ok: true,
    mensagem: "Consentimento registrado com sucesso.",
  });
});

// ─── GET /consentimentos/whatsapp/:token ─────────────────────────────────────
// Rota pública — retorna texto do termo para exibir na página de aceite

router.get("/whatsapp/:token", async (req, res) => {
  const { token } = req.params;

  const { data, error } = await supabase
    .from("consentimentos")
    .select("texto_termo, status, expira_em, versao")
    .eq("token", token)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Termo não encontrado." });
  }

  return res.json(data);
});

// ─── GET /consentimentos/:paciente_id ────────────────────────────────────────
// Retorna status dos consentimentos do paciente (para exibir no prontuário)

router.get("/:paciente_id", authenticateToken, async (req, res) => {
  const { paciente_id } = req.params;

  try {
    const { data, error } = await supabase
      .from("consentimentos")
      .select("id, tipo, assinado_em, versao, revogado_em")
      .eq("paciente_id", paciente_id)
      .order("assinado_em", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Resumo: tcle e imagem estão assinados e na versão atual?
    const resumo = {
      tcle: {
        assinado: false,
        versao_atual: TERMOS.tcle.versao,
        assinado_em: null,
      },
      imagem: {
        assinado: false,
        versao_atual: TERMOS.imagem.versao,
        assinado_em: null,
      },
    };

    for (const c of data ?? []) {
      if (!c.revogado_em && resumo[c.tipo]) {
        resumo[c.tipo].assinado = c.versao === TERMOS[c.tipo].versao;
        resumo[c.tipo].assinado_em = c.assinado_em;
        resumo[c.tipo].versao_registrada = c.versao;
      }
    }

    res.json({ consentimentos: data ?? [], resumo });
  } catch (err) {
    console.error("[consentimentos] Erro ao buscar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
