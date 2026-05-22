// src/lib/auth.js
import { supabase } from "./supabase.js";

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não informado" });
  }

  const token = authHeader.split(" ")[1];

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }

  // Buscar role e estabelecimento_id do profile (lição 47)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, estabelecimento_id, nome")
    .eq("id", data.user.id)
    .single();

  req.user = {
    ...data.user,
    role: profile?.role ?? null,
    estabelecimento_id: profile?.estabelecimento_id ?? null,
    nome: profile?.nome ?? null,
  };

  next();
}
