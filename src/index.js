import "dotenv/config"; // APENAS aqui — nunca em supabase.js ou outros módulos
import express from "express";
import cors from "cors";
import { authenticateToken } from "./lib/auth.js";
import webhookRouter from "./routes/webhook.js";
import clinicaRouter from "./routes/clinica.js";
import magicLinkRouter from "./routes/magiclink.js";
import healthRouter from "./routes/health.js";
import prontuariosRouter from "./routes/prontuarios.js";
import imagensRoutes from "./routes/imagens.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(
  cors({
    origin: [
      "https://www.podols.com.br",
      "https://podols-frontend.vercel.app",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);

app.use(express.json());

// Rotas
app.use("/health", healthRouter);
app.use("/webhook", webhookRouter);
app.use("/clinica", clinicaRouter);
app.use("/magiclink", magicLinkRouter);
app.use("/prontuarios", authenticateToken, prontuariosRouter);
app.use("/imagens", imagensRoutes);

app.listen(PORT, () => {
  console.log(`Podols backend rodando na porta ${PORT}`);
});
