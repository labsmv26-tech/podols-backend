// src/lib/whatsapp.js
// Adaptador único de envio de WhatsApp — Evolution API v2.x
// (VPS prontomarquei — evoapicloud/evolution-api:v2.3.7)
//
// Diferença de versão: a v1.x usava body { number, textMessage: { text } };
// na v2.x o texto vai direto em { number, text }.
// A instância vem de EVOLUTION_INSTANCE (padrão "podols") para permitir,
// no futuro, uma instância por clínica na mesma VPS.

export function normalizarNumero(telefone) {
  const limpo = String(telefone).replace(/\D/g, "");
  return limpo.startsWith("55") ? limpo : `55${limpo}`;
}

export async function enviarTexto(telefone, mensagem) {
  const instancia = process.env.EVOLUTION_INSTANCE || "podols";

  const res = await fetch(
    `${process.env.EVOLUTION_API_URL}/message/sendText/${instancia}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: normalizarNumero(telefone),
        text: mensagem,
      }),
    },
  );

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Evolution API ${res.status}: ${body}`);
  }
  return body;
}
