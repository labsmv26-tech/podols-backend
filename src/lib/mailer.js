// src/lib/mailer.js
// Configuração única de SMTP — reutilizada por todas as rotas
// NÃO importar dotenv/config aqui — apenas no index.js (lição 21)

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.SMTP_USER, // contato_adm@podols.com.br
    pass: process.env.SMTP_PASS,
  },
});

// Verificar conexão SMTP ao iniciar (log apenas — não bloqueia o servidor)
transporter
  .verify()
  .then(() => {
    console.log("[mailer] SMTP conectado:", process.env.SMTP_USER);
  })
  .catch((err) => {
    console.error("[mailer] Falha na conexão SMTP:", err.message);
  });

// ─── Templates ──────────────────────────────────────────────────────────────

function htmlBase(titulo, corpo) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#1D9E75;padding:24px 32px;">
              <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">Podols</span>
              <span style="color:#a7f3d0;font-size:13px;margin-left:8px;">Gestão Clínica</span>
            </td>
          </tr>
          <!-- Corpo -->
          <tr>
            <td style="padding:32px;">
              ${corpo}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Podols — podols.com.br<br/>
                VWDAP Soluções Digitais Ltda · CNPJ 48.535.885/0001-50<br/>
                Este e-mail foi enviado automaticamente. Não responda.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Funções de envio ────────────────────────────────────────────────────────

/**
 * Magic Link para o paciente
 * @param {string} email
 * @param {string} nomePaciente
 * @param {string} token  — token bruto (não o hash)
 */
export async function enviarMagicLink(email, nomePaciente, token) {
  const url = `${process.env.APP_URL}/p/${token}`;

  const corpo = `
    <h2 style="color:#111827;margin:0 0 8px;">Olá, ${nomePaciente}!</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">
      Sua podóloga compartilhou o resumo da sua sessão de hoje. Clique no botão
      abaixo para acessar seu prontuário. O link é válido por <strong>72 horas</strong>.
    </p>
    <a href="${url}"
      style="display:inline-block;background:#1D9E75;color:#ffffff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Ver meu prontuário
    </a>
    <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">
      Se o botão não funcionar, copie e cole este link no seu navegador:<br/>
      <a href="${url}" style="color:#1D9E75;">${url}</a>
    </p>
    <p style="color:#d1d5db;font-size:11px;margin:16px 0 0;">
      Por segurança, este link expira em 72h e é de uso pessoal. Não compartilhe.
    </p>`;

  await transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Seu prontuário está disponível — Podols",
    html: htmlBase("Seu prontuário — Podols", corpo),
  });
}

/**
 * Lembrete de consulta (D-1)
 * @param {string} email
 * @param {string} nomePaciente
 * @param {string} dataFormatada  — ex: "terça-feira, 20 de maio"
 * @param {string} nomeClinica
 */
export async function enviarLembreteConsulta(
  email,
  nomePaciente,
  dataFormatada,
  nomeClinica,
) {
  const corpo = `
    <h2 style="color:#111827;margin:0 0 8px;">Olá, ${nomePaciente}!</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">
      Lembrando que você tem uma consulta de podologia amanhã,
      <strong>${dataFormatada}</strong>, na <strong>${nomeClinica}</strong>.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #1D9E75;padding:16px;border-radius:4px;">
      <p style="margin:0;color:#166534;font-size:14px;">
        📅 <strong>Amanhã</strong> — ${dataFormatada}<br/>
        🏥 ${nomeClinica}
      </p>
    </div>
    <p style="color:#6b7280;font-size:14px;margin:24px 0 0;">
      Precisando remarcar ou cancelar, entre em contato diretamente com a clínica.
    </p>`;

  await transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Lembrete: consulta amanhã — ${nomeClinica}`,
    html: htmlBase("Lembrete de consulta — Podols", corpo),
  });
}

/**
 * Alerta de retorno IWGDF (D-7)
 * @param {string} email
 * @param {string} nomePaciente
 * @param {string} dataFormatada
 * @param {number} riscoIwgdf  — 0, 1, 2 ou 3
 * @param {string} nomeClinica
 */
export async function enviarAlertaRetornoIwgdf(
  email,
  nomePaciente,
  dataFormatada,
  riscoIwgdf,
  nomeClinica,
) {
  const descRisco =
    {
      0: "Sem risco detectado — manutenção preventiva",
      1: "Risco baixo — acompanhamento recomendado",
      2: "Risco moderado — retorno importante",
      3: "Risco alto — retorno prioritário",
    }[riscoIwgdf] ?? "Retorno recomendado";

  const corpo = `
    <h2 style="color:#111827;margin:0 0 8px;">Olá, ${nomePaciente}!</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">
      Sua podóloga recomenda que você agende seu próximo retorno até
      <strong>${dataFormatada}</strong>.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #1D9E75;padding:16px;border-radius:4px;">
      <p style="margin:0;color:#166534;font-size:14px;">
        📋 <strong>${descRisco}</strong><br/>
        🗓️ Retorno sugerido: ${dataFormatada}<br/>
        🏥 ${nomeClinica}
      </p>
    </div>
    <p style="color:#6b7280;font-size:14px;margin:24px 0 0;">
      Entre em contato com a clínica para agendar seu retorno.
    </p>`;

  await transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Hora do retorno — ${nomeClinica}`,
    html: htmlBase("Alerta de retorno — Podols", corpo),
  });
}

/**
 * Boas-vindas ao prestador após pagamento confirmado
 * @param {string} email
 * @param {string} nomeClinica
 */
export async function enviarBoasVindasPrestador(email, nomeClinica) {
  const corpo = `
    <h2 style="color:#111827;margin:0 0 8px;">Bem-vinda ao Podols, ${nomeClinica}!</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">
      Seu pagamento foi confirmado e sua clínica já está ativa no sistema.
      Agora você pode começar a cadastrar pacientes e registrar atendimentos.
    </p>
    <a href="${process.env.APP_URL}/atendimento"
      style="display:inline-block;background:#1D9E75;color:#ffffff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Acessar o sistema
    </a>
    <p style="color:#6b7280;font-size:14px;margin:24px 0 0;">
      Em caso de dúvidas, entre em contato: contato@vwdap.com.br
    </p>`;

  await transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Sua clínica está ativa — Podols",
    html: htmlBase("Bem-vinda ao Podols", corpo),
  });
}

// ─── ADICIONAR ao src/lib/mailer.js ─────────────────────────
// Colar antes do `export default transporter`

/**
 * Convite para membro da equipe (podóloga ou secretária)
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.nome
 * @param {string} params.role        — 'podologa' | 'recepcao'
 * @param {string} params.nomeClinica
 * @param {string} params.nomeDono
 * @param {string} params.magicLink   — link gerado pelo Supabase Auth admin
 */
export async function enviarConviteEquipe({
  email,
  nome,
  role,
  nomeClinica,
  nomeDono,
  magicLink,
}) {
  const labelRole = role === "podologa" ? "Podóloga" : "Recepcionista";

  const corpo = `
    <h2 style="color:#111827;margin:0 0 8px;">Olá, ${nome}!</h2>
    <p style="color:#6b7280;margin:0 0 8px;font-size:15px;line-height:1.6;">
      <strong>${nomeDono}</strong> convidou você para fazer parte da equipe da
      <strong>${nomeClinica}</strong> no Podols.
    </p>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">
      Sua função: <strong>${labelRole}</strong>
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #1D9E75;padding:16px;
                border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;color:#166534;font-size:14px;line-height:1.6;">
        Clique no botão abaixo para acessar o sistema pela primeira vez.<br/>
        <strong>O link é válido por 24 horas.</strong>
      </p>
    </div>
    <a href="${magicLink}"
      style="display:inline-block;background:#1D9E75;color:#ffffff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Acessar o Podols →
    </a>
    <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">
      Se o botão não funcionar, copie e cole este link no seu navegador:<br/>
      <a href="${magicLink}" style="color:#1D9E75;word-break:break-all;">${magicLink}</a>
    </p>
    <p style="color:#d1d5db;font-size:11px;margin:16px 0 0;">
      Este convite foi enviado para ${email}. Se você não esperava receber este
      e-mail, ignore-o com segurança.
    </p>`;

  await transporter.sendMail({
    from: `"Podols" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Você foi convidada para ${nomeClinica} — Podols`,
    html: htmlBase(`Convite — ${nomeClinica}`, corpo),
  });
}

export default transporter;
