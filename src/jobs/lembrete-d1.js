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

export async function dispararLembretesD1() {
  console.log("[lembrete-d1] Iniciando verificação...");

  // Amanhã em GMT-4: pegar UTC agora e subtrair 4h para saber que "dia" é em GMT-4
  const agora = new Date();

  // Offset GMT-4 em ms
  const offsetMs = 4 * 60 * 60 * 1000;

  // "Agora" em GMT-4
  const agoraGmt4 = new Date(agora.getTime() - offsetMs);

  // Amanhã em GMT-4 (só a data)
  const amanhaGmt4 = new Date(agoraGmt4);
  amanhaGmt4.setUTCDate(agoraGmt4.getUTCDate() + 1);

  // Início: 00:00 GMT-4 = 04:00 UTC do dia amanhã
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

  // Fim: 23:59:59 GMT-4 = 03:59:59 UTC do dia seguinte
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1000);

  // 1. Buscar agendamentos de amanhã com status confirmado ou agendado
  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      `
      id,
      nome_paciente,
      data_hora,
      estabelecimento_id,
      paciente_id,
      status
    `,
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

  // Coletar estabelecimento_ids únicos para buscar clínicas e prestadores
  const estabIds = [...new Set(agendamentos.map((a) => a.estabelecimento_id))];

  // 2. Buscar nomes das clínicas
  const { data: estabelecimentos } = await supabase
    .from("estabelecimentos")
    .select("id, nome")
    .in("id", estabIds);

  // 3. Buscar telefone do prestador de cada clínica
  const { data: prestadores } = await supabase
    .from("profiles")
    .select("estabelecimento_id, telefone")
    .eq("role", "prestador")
    .in("estabelecimento_id", estabIds);

  // Mapas para lookup rápido
  const mapaClinica = Object.fromEntries(
    (estabelecimentos || []).map((e) => [e.id, e.nome]),
  );
  const mapaTelefone = Object.fromEntries(
    (prestadores || []).map((p) => [p.estabelecimento_id, p.telefone]),
  );

  // 4. Coletar paciente_ids para buscar emails
  const pacienteIds = agendamentos
    .filter((a) => a.paciente_id)
    .map((a) => a.paciente_id);

  const mapaEmail = {};
  if (pacienteIds.length > 0) {
    const { data: pacientes } = await supabase
      .from("pacientes")
      .select("id, email")
      .in("id", pacienteIds);

    (pacientes || []).forEach((p) => {
      mapaEmail[p.id] = p.email;
    });
  }

  // 5. Disparar e-mails
  let enviados = 0;
  let ignorados = 0;

  for (const ag of agendamentos) {
    const email = ag.paciente_id ? mapaEmail[ag.paciente_id] : null;

    if (!email) {
      console.log(
        `[lembrete-d1] Sem email — agendamento ${ag.id} (${ag.nome_paciente}). Ignorado.`,
      );
      ignorados++;
      continue;
    }

    const nomeClinica = mapaClinica[ag.estabelecimento_id] ?? "sua clínica";
    const telefoneClinica = mapaTelefone[ag.estabelecimento_id] ?? null;
    const dataFormatada = formatarData(ag.data_hora);

    try {
      await enviarLembreteConsulta(
        email,
        ag.nome_paciente,
        dataFormatada,
        nomeClinica,
        telefoneClinica,
      );
      enviados++;
      console.log(
        `[lembrete-d1] ✓ Enviado para ${email} (${ag.nome_paciente})`,
      );
    } catch (err) {
      console.error(
        `[lembrete-d1] ✗ Falha ao enviar para ${email}:`,
        err.message,
      );
    }
  }

  console.log(
    `[lembrete-d1] Concluído — ${enviados} enviado(s), ${ignorados} ignorado(s) (sem email).`,
  );
}

// ── Cron: todo dia às 18h00 GMT-4 (= 22h00 UTC) ──────────────────────────────
// Formato: segundo minuto hora dia mês diaSemana
cron.schedule("0 0 22 * * *", () => {
  dispararLembretesD1().catch((err) =>
    console.error("[lembrete-d1] Erro inesperado:", err),
  );
});

console.log("[lembrete-d1] Cron registrado — disparo diário às 18h (GMT-4).");
