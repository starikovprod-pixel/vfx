import fs from "fs";
import formidable from "formidable";
import { pool } from "../lib/db.js";
import { PRESETS } from "../lib/presets.js";
import { chargeCreditsOrThrow } from "../lib/credits.js";
import { getKlingO1Cost } from "../lib/pricing.js";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow =
    origin === "https://lightfull.ai" || origin === "https://api.lightfull.ai"
      ? origin
      : "https://lightfull.ai";

  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function getUserFromSupabase(accessToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase auth failed: ${r.status} ${txt}`);
  }
  return r.json();
}

function parseForm(req) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 200 * 1024 * 1024, // 200MB
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function pickField(fields, name) {
  const v = fields?.[name];
  return Array.isArray(v) ? v[0] : v;
}

function pickFile(files, name) {
  const f = files?.[name];
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}

function normalizeBool(v) {
  return String(v ?? "false").toLowerCase() === "true";
}

function normalizeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function uploadVideoToSupabase({ userId, file }) {
  const buf = fs.readFileSync(file.filepath || file.path);

  const path = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.mp4`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/inputs_video/${encodeURIComponent(path)}`;

  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "video/mp4",
      "x-upsert": "false",
    },
    body: buf,
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase storage upload failed: ${r.status} ${text}`);

  return `${SUPABASE_URL}/storage/v1/object/public/inputs_video/${encodeURIComponent(path)}`;
}

async function falRequest(modelPath, payload) {
  const url = `https://fal.run/${modelPath}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) {}

  return { ok: r.ok, status: r.status, json, text };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!process.env.FAL_KEY) missing.push("FAL_KEY");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (missing.length) return res.status(400).json({ error: "Missing env vars", missing });

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    const { fields, files } = await parseForm(req);

    const presetId = String(pickField(fields, "presetId") || "").trim();
    const scene = String(pickField(fields, "scene") || "").trim();
    const keep_original_sound = normalizeBool(pickField(fields, "keep_original_sound") ?? true);

    if (!presetId) return res.status(400).json({ error: "presetId required" });

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ error: "Unknown preset", presetId });
    if (preset.provider !== "fal") return res.status(400).json({ error: "Preset is not fal", presetId });

    const videoFile = pickFile(files, "video");
    if (!videoFile) return res.status(400).json({ error: "MP4 required (field name: video)" });

    if (String(videoFile.mimetype || "") !== "video/mp4") {
      return res.status(400).json({ error: "Only MP4 supported", mimetype: videoFile.mimetype });
    }

    // ✅ duration (нужен для Kling O1 price ladder)
    const durationSec =
      normalizeNum(pickField(fields, "duration"), null) ??
      normalizeNum(pickField(fields, "video_duration_sec"), null) ??
      normalizeNum(preset.duration, null) ??
      6;

    // ✅ pricing + charge (safe)
    let cost = 1;
    try {
      // Для Kling O1 Edit (и в целом любых o1) — по твоей таблице
      if (
        presetId.startsWith("kling_o1_") ||
        String(preset.model || "").includes("/kling-video/o1/")
      ) {
        cost = getKlingO1Cost(durationSec);
      } else {
        // fallback для других fal-предустановок
        cost = 1;
      }
    } catch (e) {
      if (e.code === "O1_MAX_DURATION_EXCEEDED") {
        return res.status(400).json({ error: "O1 supports up to 15 seconds", duration: e.duration });
      }
      throw e;
    }

    let credits_left = 0;
    try {
      credits_left = await chargeCreditsOrThrow(userId, cost);
    } catch (e) {
      if (e.code === "NOT_ENOUGH_CREDITS") {
        return res.status(402).json({
          ok: false,
          error: "Not enough credits",
          credits: e.credits_left,
          required: cost,
          tool: "fal",
          presetId,
          duration: durationSec,
        });
      }
      throw e;
    }

    // ✅ upload after successful charge
    const video_url = await uploadVideoToSupabase({ userId, file: videoFile });

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene || "edit the video")
      .trim();

    const fal = await falRequest(preset.model, { prompt, video_url, keep_original_sound });

    if (!fal.ok) {
      return res.status(400).json({
        error: "fal request failed",
        status: fal.status,
        details: fal.json && Object.keys(fal.json).length ? fal.json : fal.text,
        video_url,
      });
    }

    const j = fal.json || {};
    const requestId = j.request_id || j.id || null;
    if (!requestId) return res.status(400).json({ error: "fal: missing request_id", details: j });

    await pool.query(
      `
      insert into public.generations
        (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration)
      values
        ($1, $2, $3, $4, $5, $6, $7)
      `,
      [userId, presetId, requestId, preset.model, prompt, "starting", Math.round(durationSec)]
    );

    return res.status(200).json({
      ok: true,
      user: { id: userId, email },
      jobId: requestId,
      status: "starting",
      provider: "fal",
      presetId,
      video_url,
      cost,
      credits_left,
      params: { duration: Math.round(durationSec) },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal error", details: String(e?.message || e) });
  }
}
