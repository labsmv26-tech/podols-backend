// src/jobs/lembrete-d1.js
// Cron job: dispara lembretes D-1 para pacientes com agendamento amanhã
// Rodar diariamente às 18h (horário de Porto Velho, GMT-4)
// Registrar no src/index.js: import './jobs/lembrete-d1.js'

import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { enviarLembreteConsulta } from "../lib/mailer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/**
 * Formata timestamptz para "terça-feira, 20 de maio às 14h00"
 */
function formatarData(dataHora) {
  const d = new Date(dataHora);
  const diaSemana = d.toLocaleDateString("pt-BR", {
    weekday: "long",
    timeZone: "America/Porto_Velho",
  });
  const diaNum = d.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Porto_Velho",
  });
  const hora = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Porto_Velho",
  });
  return `${diaSemana}, ${diaNum} às ${hora}`;
}

/**
 * Envia lembrete via WhatsApp usando Evolution API
 */
async function enviarLembreteWhatsApp(
  telefone,
  nomePaciente,
  dataFormatada,
  nomeClinica,
) {
  const telefoneLimpo = telefone.replace(/\D/g, "");
  const numero = telefoneLimpo.startsWith("55")
    ? telefoneLimpo
    : `55${telefoneLimpo}`;

  const primeiroNome = nomePaciente.split(" ")[0];
  const mensagem =
    `Olá, ${primeiroNome}! 👋\n\n` +
    `Lembramos que você tem uma consulta agendada para *amanhã*:\n\n` +
    `📅 *${dataFormatada}*\n` +
    `🏥 *${nomeClinica}*\n\n` +
    `Em caso de dúvidas ou necessidade de reagendamento, entre em contato com a clínica.\n\n` +
    `_Podols — Gestão Clínica para Podologia_`;

  const res = await fetch(
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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution API ${res.status}: ${body}`);
  }
}

export async function dispararLembretesD1() {
  console.log("[lembrete-d1] Iniciando verificação...");

  // Amanhã em GMT-4
  const agora = new Date();
  const offsetMs = 4 * 60 * 60 * 1000;
  const agoraGmt4 = new Date(agora.getTime() - offsetMs);
  const amanhaGmt4 = new Date(agoraGmt4);
  amanhaGmt4.setUTCDate(agoraGmt4.getUTCDate() + 1);

  const inicio = new Date(
    Date.UTC(
      amanhaGmt4.getUTCFullYear(),
      amanhaGmt4.getUTCMonth(),
      amanhaGmt4.getUTCDate(),
      4,
      0,
      0,
      0,
    ),
  );
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1000);

  // 1. Buscar agendamentos de amanhã
  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      "id, nome_paciente, data_hora, estabelecimento_id, paciente_id, status",
    )
    .in("status", ["agendado", "confirmado"])
    .gte("data_hora", inicio.toISOString())
    .lte("data_hora", fim.toISOString());

  if (error) {
    console.error("[lembrete-d1] Erro ao buscar agendamentos:", error.message);
    return;
  }

  if (!agendamentos || agendamentos.length === 0) {
    console.log("[lembrete-d1] Nenhum agendamento para amanhã.");
    return;
  }

  console.log(
    `[lembrete-d1] ${agendamentos.length} agendamento(s) encontrado(s).`,
  );

  const estabIds = [...new Set(agendamentos.map((a) => a.estabelecimento_id))];

  // 2. Buscar clínicas
  const { data: estabelecimentos } = await supabase
    .from("estabelecimentos")
    .select("id, nome")
    .in("id", estabIds);

  // 3. Buscar telefone do prestador
  const { data: prestadores } = await supabase
    .from("profiles")
    .select("estabelecimento_id, telefone")
    .eq("role", "prestador")
    .in("estabelecimento_id", estabIds);

  const mapaClinica = Object.fromEntries(
    (estabelecimentos || []).map((e) => [e.id, e.nome]),
  );
  const mapaTelefoneClinica = Object.fromEntries(
    (prestadores || []).map((p) => [p.estabelecimento_id, p.telefone]),
  );

  // 4. Buscar email E telefone dos pacientes ← adicionado: telefone
  const pacienteIds = agendamentos
    .filter((a) => a.paciente_id)
    .map((a) => a.paciente_id);

  const mapaEmail = {};
  const mapaWhatsApp = {}; // ← novo

  if (pacienteIds.length > 0) {
    const { data: pacientes } = await supabase
      .from("pacientes")
      .select("id, email, telefone") // ← adicionado: telefone
      .in("id", pacienteIds);

    (pacientes || []).forEach((p) => {
      mapaEmail[p.id] = p.email;
      mapaWhatsApp[p.id] = p.telefone; // ← novo
    });
  }

  // 5. Disparar lembretes
  let emailEnviados = 0;
  let wppEnviados = 0;
  let ignorados = 0;

  for (const ag of agendamentos) {
    const email = ag.paciente_id ? mapaEmail[ag.paciente_id] : null;
    const telefone = ag.paciente_id ? mapaWhatsApp[ag.paciente_id] : null;
    const nomeClinica = mapaClinica[ag.estabelecimento_id] ?? "sua clínica";
    const telefoneClinica = mapaTelefoneClinica[ag.estabelecimento_id] ?? null;
    const dataFormatada = formatarData(ag.data_hora);

    if (!email && !telefone) {
      console.log(
        `[lembrete-d1] Sem contato — ${ag.id} (${ag.nome_paciente}). Ignorado.`,
      );
      ignorados++;
      continue;
    }

    // ── E-mail ──────────────────────────────────────────────────────────────
    if (email) {
      try {
        await enviarLembreteConsulta(
          email,
          ag.nome_paciente,
          dataFormatada,
          nomeClinica,
          telefoneClinica,
        );
        emailEnviados++;
        console.log(`[lembrete-d1] ✓ Email → ${email} (${ag.nome_paciente})`);
      } catch (err) {
        console.error(`[lembrete-d1] ✗ Email falhou → ${email}:`, err.message);
      }
    }

    // ── WhatsApp ─────────────────────────────────────────────────────────────
    if (telefone) {
      try {
        await enviarLembreteWhatsApp(
          telefone,
          ag.nome_paciente,
          dataFormatada,
          nomeClinica,
        );
        wppEnviados++;
        console.log(
          `[lembrete-d1] ✓ WhatsApp → ${telefone} (${ag.nome_paciente})`,
        );
      } catch (err) {
        console.error(
          `[lembrete-d1] ✗ WhatsApp falhou → ${telefone}:`,
          err.message,
        );
      }
    }
  }

  console.log(
    `[lembrete-d1] Concluído — ` +
      `${emailEnviados} email(s), ${wppEnviados} WhatsApp(s), ${ignorados} ignorado(s).`,
  );
}

// ── Cron: todo dia às 18h00 GMT-4 (= 22h00 UTC) ──────────────────────────────
cron.schedule("0 0 22 * * *", () => {
  dispararLembretesD1().catch((err) =>
    console.error("[lembrete-d1] Erro inesperado:", err),
  );
});

console.log("[lembrete-d1] Cron registrado — disparo diário às 18h (GMT-4).");
