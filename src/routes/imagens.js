import { Router } from "express";
import multer from "multer";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import r2, { BUCKET } from "../lib/r2.js";
import { supabase } from "../lib/supabase.js";
import { authenticateToken } from "../lib/auth.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/webp", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato não permitido. Use WebP, JPEG ou PNG."));
    }
  },
});

// POST /imagens/upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("imagem"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhuma imagem enviada." });
      }

      const { sessao_id, finalidade = "documentacao" } = req.body;

      if (!sessao_id) {
        return res.status(400).json({ error: "sessao_id é obrigatório." });
      }

      const finalidadesValidas = ["documentacao", "evolucao", "encaminhamento"];
      if (!finalidadesValidas.includes(finalidade)) {
        return res.status(400).json({ error: "finalidade inválida." });
      }

      const { data: sessao, error: sessaoErr } = await supabase
        .from("sessoes")
        .select("id, prontuario_id, paciente_id")
        .eq("id", sessao_id)
        .single();

      if (sessaoErr || !sessao) {
        return res.status(404).json({ error: "Sessão não encontrada." });
      }

      const ext =
        req.file.mimetype === "image/webp"
          ? "webp"
          : req.file.mimetype === "image/jpeg"
            ? "jpg"
            : "png";
      const storageKey = `sessoes/${sessao_id}/${randomUUID()}.${ext}`;

      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: storageKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }),
      );

      const { data: imagem, error: imgErr } = await supabase
        .from("imagens")
        .insert({
          sessao_id,
          storage_key: storageKey,
          finalidade,
          operador_id: req.user.id,
        })
        .select()
        .single();

      if (imgErr) {
        await r2.send(
          new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }),
        );
        throw imgErr;
      }

      const publicUrl = `${process.env.R2_PUBLIC_URL}/${storageKey}`;

      return res.status(201).json({
        id: imagem.id,
        storage_key: storageKey,
        url: publicUrl,
        finalidade: imagem.finalidade,
        created_at: imagem.created_at,
      });
    } catch (err) {
      console.error("[POST /imagens/upload]", err);
      return res.status(500).json({ error: err.message || "Erro interno." });
    }
  },
);

// GET /imagens/sessao/:sessao_id
router.get("/sessao/:sessao_id", authenticateToken, async (req, res) => {
  try {
    const { sessao_id } = req.params;

    const { data, error } = await supabase
      .from("imagens")
      .select("id, storage_key, finalidade, created_at, operador_id")
      .eq("sessao_id", sessao_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const imagens = data.map((img) => ({
      ...img,
      url: `${process.env.R2_PUBLIC_URL}/${img.storage_key}`,
    }));

    return res.json(imagens);
  } catch (err) {
    console.error("[GET /imagens/sessao]", err);
    return res.status(500).json({ error: err.message || "Erro interno." });
  }
});

// DELETE /imagens/:id
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: imagem, error: findErr } = await supabase
      .from("imagens")
      .select("id, storage_key, operador_id")
      .eq("id", id)
      .single();

    if (findErr || !imagem) {
      return res.status(404).json({ error: "Imagem não encontrada." });
    }

    if (imagem.operador_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Sem permissão para deletar esta imagem." });
    }

    await r2.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: imagem.storage_key,
      }),
    );

    await supabase.from("imagens").delete().eq("id", id);

    return res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /imagens]", err);
    return res.status(500).json({ error: err.message || "Erro interno." });
  }
});

export default router;
