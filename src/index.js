// src/index.js
// Ponto de entrada do backend — dotenv/config APENAS aqui (lição 21)
// ESM obrigatório — "type": "module" no package.json (lição 20)

import "dotenv/config";
import express from "express";
import cors from "cors";

import healthRouter from "./routes/health.js";
import webhookRouter from "./routes/webhook.js";
import clinicaRouter from "./routes/clinica.js";
import magicLinkRouter from "./routes/magiclink.js";
import prontuariosRouter from "./routes/prontuarios.js";
import sessoesRouter from "./routes/sessoes.js";
import imagensRouter from "./routes/imagens.js";
import alertasRouter from "./routes/alertas.js";
import consentimentosRouter from "./routes/consentimentos.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ────────────────────────────────────────────────────────────────────
// Lição 45: incluir URL do deploy da Vercel além do domínio definitivo
app.use(
  cors({
    origin: [
      "https://www.podols.com.br",
      "https://podols-frontend.vercel.app",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cron-secret"],
  }),
);

app.use(express.json());

// ─── ROTAS ───────────────────────────────────────────────────────────────────
// Sem autenticação
app.use("/health", healthRouter);
app.use("/webhook", webhookRouter); // AsaaS — GET + POST (lição 24)
app.use("/magiclink", magicLinkRouter); // /validar/:token é público; /gerar requer auth
app.use("/alertas", alertasRouter); // /processar requer CRON_SECRET

// Com autenticação (via middleware authenticateToken nas rotas internas)
app.use("/clinica", clinicaRouter);
app.use("/prontuarios", prontuariosRouter);
app.use("/sessoes", sessoesRouter);
app.use("/imagens", imagensRouter);
app.use("/consentimentos", consentimentosRouter);

// ─── INICIAR ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Podols backend rodando na porta ${PORT}`);
});
