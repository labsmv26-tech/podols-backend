import "dotenv/config"; // APENAS aqui — nunca em supabase.js ou outros módulos
import express from "express";
import cors from "cors";

import webhookRouter from "./routes/webhook.js";
import clinicaRouter from "./routes/clinica.js";
import magicLinkRouter from "./routes/magiclink.js";
import healthRouter from "./routes/health.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(
  cors({
    origin: ["https://www.podols.com.br", "http://localhost:3000"],
    credentials: true,
  }),
);

app.use(express.json());

// Rotas
app.use("/health", healthRouter);
app.use("/webhook", webhookRouter);
app.use("/clinica", clinicaRouter);
app.use("/magiclink", magicLinkRouter);

app.listen(PORT, () => {
  console.log(`Podols backend rodando na porta ${PORT}`);
});
