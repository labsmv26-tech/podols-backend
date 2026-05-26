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
  const { sessao_id, paciente_id, telefone } = req.body;
  const operador_id = req.user.id;

  if (!paciente_id || !telefone) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  // 1. Buscar estabelecimento_id do operador
  const { data: profile, error: errProfile } = await supabase
    .from("profiles")
    .select("estabelecimento_id")
    .eq("id", operador_id)
    .single();

  if (errProfile || !profile?.estabelecimento_id) {
    return res
      .status(403)
      .json({ error: "Perfil do operador não encontrado." });
  }

  const estabelecimento_id = profile.estabelecimento_id;
  const telefoneLimpo = telefone.replace(/\D/g, "");
  const agora = new Date().toISOString();

  // 2. Criar registro na tabela consentimentos
  const { data: consentimento, error: insertError } = await supabase
    .from("consentimentos")
    .insert({
      sessao_id: sessao_id ?? null,
      paciente_id,
      estabelecimento_id,
      telefone: telefoneLimpo,
      tipo: "imagem",
      versao: TERMOS.imagem.versao,
      texto_termo: TERMOS.imagem.texto,
      hash_integridade: gerarHashIntegridade("imagem", agora),
      status: "pendente",
      expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single();

  if (insertError) {
    console.error("[consentimentos] Erro ao criar:", insertError.message);
    return res.status(500).json({ error: "Erro ao criar consentimento." });
  }

  // 3. Montar link e mensagem
  const link = `${process.env.APP_URL}/consentimento/${consentimento.token}`;
  const numero = telefoneLimpo.startsWith("55")
    ? telefoneLimpo
    : `55${telefoneLimpo}`;
  const mensagem =
    `Olá! Sua podóloga solicita sua autorização para registro fotográfico do atendimento de hoje.\n\n` +
    `Acesse o link, leia o termo e confirme:\n${link}\n\n` +
    `O link expira em 24 horas.`;

  // 4. Enviar via Evolution API
  try {
    const evolucaoRes = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendText/podols`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: numero,
          textMessage: { text: mensagem },
        }),
      },
    );

    const evolucaoBody = await evolucaoRes.text();
    console.log("[evolution] status:", evolucaoRes.status);
    console.log("[evolution] body:", evolucaoBody);

    if (!evolucaoRes.ok) {
      return res
        .status(502)
        .json({ error: "Erro ao enviar WhatsApp.", detalhe: evolucaoBody });
    }
  } catch (e) {
    console.error("[evolution] exception:", e.message);
    return res
      .status(502)
      .json({ error: "Erro ao conectar Evolution API.", detalhe: e.message });
  }

  return res.json({ ok: true, token: consentimento.token });
});

// ─── POST /consentimentos/tcle/enviar ────────────────────────────────────────
// Gera token único e envia link de TCLE via WhatsApp ao cadastrar paciente
// Body: { paciente_id, estabelecimento_id, telefone, nome_paciente }
// Autenticada — chamada pelo operador logado após cadastrar o paciente
//
// ADICIONAR em src/routes/consentimentos.js, antes do `export default router`
// Sugestão: inserir após a rota POST /consentimentos/whatsapp/enviar existente

router.post("/tcle/enviar", authenticateToken, async (req, res) => {
  const { paciente_id, telefone, nome_paciente } = req.body;
  const operador_id = req.user.id;

  if (!paciente_id || !telefone) {
    return res
      .status(400)
      .json({ error: "paciente_id e telefone são obrigatórios." });
  }

  // 1. Buscar estabelecimento_id do operador
  const { data: profile, error: errProfile } = await supabase
    .from("profiles")
    .select("estabelecimento_id")
    .eq("id", operador_id)
    .single();

  if (errProfile || !profile?.estabelecimento_id) {
    return res
      .status(403)
      .json({ error: "Perfil do operador não encontrado." });
  }

  const estabelecimento_id = profile.estabelecimento_id;
  const telefoneLimpo = telefone.replace(/\D/g, "");
  const agora = new Date().toISOString();

  // 2. Verificar se já existe TCLE pendente ou aceito para este paciente
  const { data: existente } = await supabase
    .from("consentimentos")
    .select("id, status")
    .eq("paciente_id", paciente_id)
    .eq("tipo", "tcle")
    .in("status", ["pendente", "aceito"])
    .maybeSingle();

  if (existente?.status === "aceito") {
    return res.status(409).json({
      error: "TCLE já aceito para este paciente.",
      status: "aceito",
    });
  }

  if (existente?.status === "pendente") {
    // Já enviado — apenas retorna sem duplicar
    return res.status(409).json({
      error: "TCLE já enviado e aguardando aceite.",
      status: "pendente",
    });
  }

  // 3. Criar registro na tabela consentimentos
  const { data: consentimento, error: insertError } = await supabase
    .from("consentimentos")
    .insert({
      paciente_id,
      estabelecimento_id,
      tipo: "tcle",
      versao: TERMOS.tcle.versao,
      texto_termo: TERMOS.tcle.texto,
      hash_integridade: gerarHashIntegridade("tcle", agora),
      status: "pendente",
      telefone: telefoneLimpo,
      operador_id,
      expira_em: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 dias
    })
    .select("token")
    .single();

  if (insertError) {
    console.error("[tcle] Erro ao criar consentimento:", insertError.message);
    return res.status(500).json({ error: "Erro ao criar TCLE." });
  }

  // 4. Montar link e mensagem
  const link = `${process.env.APP_URL}/consentimento/tcle/${consentimento.token}`;
  const numero = telefoneLimpo.startsWith("55")
    ? telefoneLimpo
    : `55${telefoneLimpo}`;

  const primeiroNome = (nome_paciente ?? "").split(" ")[0] || "você";
  const mensagem =
    `Olá, ${primeiroNome}! Bem-vindo(a) à nossa clínica. 🌿\n\n` +
    `Para iniciarmos seu atendimento, precisamos do seu consentimento sobre como seus dados de saúde serão tratados (LGPD).\n\n` +
    `Acesse o link abaixo, leia o termo e confirme:\n${link}\n\n` +
    `O link é válido por 30 dias. Qualquer dúvida, fale com nossa equipe.`;

  // 5. Enviar via Evolution API
  try {
    const evolucaoRes = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendText/podols`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: numero,
          textMessage: { text: mensagem },
        }),
      },
    );

    const evolucaoBody = await evolucaoRes.text();
    console.log("[tcle/evolution] status:", evolucaoRes.status);
    console.log("[tcle/evolution] body:", evolucaoBody);

    if (!evolucaoRes.ok) {
      // Não falha o cadastro — TCLE criado no banco, WhatsApp falhou
      console.warn("[tcle] WhatsApp falhou mas TCLE registrado no banco.");
      return res.status(207).json({
        ok: false,
        token: consentimento.token,
        aviso: "TCLE criado mas falha ao enviar WhatsApp.",
        detalhe: evolucaoBody,
      });
    }
  } catch (e) {
    console.error("[tcle/evolution] exception:", e.message);
    return res.status(207).json({
      ok: false,
      token: consentimento.token,
      aviso: "TCLE criado mas falha ao conectar Evolution API.",
      detalhe: e.message,
    });
  }

  console.log(
    `[tcle] Enviado — paciente ${paciente_id} — tel ${telefoneLimpo}`,
  );
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

// PATCH — src/routes/consentimentos.js
// Substituir a rota GET /consentimentos/:paciente_id existente por esta versão
// Mudanças:
//   1. Adicionar "status" ao select
//   2. Condição assinado: checar status === 'aceito' além de versão e revogado_em

router.get("/:paciente_id", authenticateToken, async (req, res) => {
  const { paciente_id } = req.params;

  try {
    const { data, error } = await supabase
      .from("consentimentos")
      .select("id, tipo, assinado_em, versao, revogado_em, status") // ← adicionado: status
      .eq("paciente_id", paciente_id)
      .order("assinado_em", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

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
        resumo[c.tipo].assinado =
          c.versao === TERMOS[c.tipo].versao && c.status === "aceito"; // ← corrigido
        resumo[c.tipo].assinado_em = c.assinado_em;
        resumo[c.tipo].versao_registrada = c.versao;
        resumo[c.tipo].status = c.status; // ← expõe status para o frontend
      }
    }

    res.json({ consentimentos: data ?? [], resumo });
  } catch (err) {
    console.error("[consentimentos] Erro ao buscar:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
