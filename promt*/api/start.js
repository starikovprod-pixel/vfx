import fs from "fs";
import formidable from "formidable";
import Replicate from "replicate";
import { pool } from "../lib/db.js";
import { PRESETS } from "../lib/presets.js";
import { chargeCreditsOrThrow } from "../lib/credits.js";

// ✅ Импорты прайсинга
import { 
  getNanoCost, 
  getKling26Cost, 
  getRunwayCostCredits, 
  getVeoCost 
} from "../lib/pricing.js";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY;

// Runway config
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET || "";
const RUNWAY_VERSION = "2024-11-06";
const RUNWAY_BASE = "https://api.dev.runwayml.com";

// ✅ Константа модели апскейла
const REPLICATE_UPSCALE_MODEL = "runwayml/upscale-v1";

// USD -> Credits conversion for per-second providers
const USD_PER_CREDIT = Number(process.env.USD_PER_CREDIT || "0.10");

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function getUserFromSupabase(accessToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase auth failed: ${r.status} ${txt}`);
  }
  return r.json();
}

function parseForm(req) {
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFileSize: 200 * 1024 * 1024,
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

function pickFields(fields, name) {
  const v = fields?.[name];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pickFiles(files, name) {
  const f = files?.[name];
  if (!f) return [];
  return Array.isArray(f) ? f : [f];
}

function fileToDataUri(file) {
  const filepath = file.filepath || file.path;
  const mime = file.mimetype || "application/octet-stream";
  const buf = fs.readFileSync(filepath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function fileToBase64(file) {
  const filepath = file.filepath || file.path;
  const buf = fs.readFileSync(filepath);
  return buf.toString("base64");
}

async function fetchUrlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Failed to fetch image_url: ${r.status} ${t}`);
  }
  const ab = await r.arrayBuffer();
  return Buffer.from(ab).toString("base64");
}

function normalizeBool(v) {
  return String(v ?? "false").toLowerCase() === "true";
}

function normalizeInt(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStr(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function buildNanoImageInput(fields, max = 14) {
  const multi = pickFields(fields, "image_input_urls")
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const single = String(pickField(fields, "image_input_url") || "").trim();
  const merged = [...multi, ...(single ? [single] : [])];

  const seen = new Set();
  const urls = [];
  for (const u of merged) {
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
    if (urls.length >= max) break;
  }

  return urls.length ? urls : null;
}

function calcReplicateImageCost(preset, fields) {
  if (preset.model === "bytedance/seedream-4") {
    const size = String(pickField(fields, "size") || "2K").toUpperCase();
    const maxImagesRaw = normalizeInt(pickField(fields, "max_images"), 1);
    const maxImages = Number.isFinite(maxImagesRaw) ? Math.max(1, Math.floor(maxImagesRaw)) : 1;
    const base = size === "4K" ? 4 : size === "2K" ? 2 : 1;
    return Math.max(1, base * maxImages);
  }

  if (preset.model === "black-forest-labs/flux-2-max") {
    const res = String(pickField(fields, "resolution") || "1 MP").toUpperCase();
    const base = res.includes("4") ? 7 : res.includes("2") ? 4 : 2;
    return Math.max(1, base);
  }

  return 1;
}

function pickOptionalUrl(fields, name) {
  const v = String(pickField(fields, name) || "").trim();
  return v || null;
}

function buildReferenceImagesInput({ fields, files, max = 3 }) {
  const multiUrls = pickFields(fields, "reference_image_urls")
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const singleUrl = String(pickField(fields, "reference_image_url") || "").trim();
  const urls = [...multiUrls, ...(singleUrl ? [singleUrl] : [])];

  const refFiles = pickFiles(files, "reference_images");
  const out = [];
  const seen = new Set();

  for (const u of urls) {
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) return out;
  }
  for (const f of refFiles) {
    const data = fileToDataUri(f);
    if (!data) continue;
    if (seen.has(data)) continue;
    seen.add(data);
    out.push(data);
    if (out.length >= max) break;
  }
  return out.length ? out : null;
}

function getMotionControlCredits({ mode, durationSec }) {
  const rate = mode === "pro" ? 0.12 : 0.07;
  const usd = Math.max(0, durationSec) * rate;
  const per = Number.isFinite(USD_PER_CREDIT) && USD_PER_CREDIT > 0 ? USD_PER_CREDIT : 0.10;
  const credits = Math.max(1, Math.ceil(usd / per));
  return { usd, credits, rate, usd_per_credit: per };
}

function runwayHeaders() {
  return {
    Authorization: `Bearer ${RUNWAY_API_KEY}`,
    "X-Runway-Version": RUNWAY_VERSION,
    "Content-Type": "application/json",
  };
}

function normalizeRunwayRatio(raw) {
  const v = String(raw || "").trim();
  const map = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" };
  const normalized = map[v] || v;
  const ALLOWED = new Set(["1280:720", "720:1280", "1104:832", "960:960", "832:832", "1584:672", "848:480", "640:480"]);
  return ALLOWED.has(normalized) ? normalized : "1280:720";
}

function buildRunwayReferences({ fields, files, max = 1 }) {
  const multiUrls = pickFields(fields, "reference_image_urls")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const singleUrl = String(pickField(fields, "reference_image_url") || "").trim();
  const urls = [...multiUrls, ...(singleUrl ? [singleUrl] : [])];
  const refFiles = pickFiles(files, "reference_images");
  const out = [];
  const seen = new Set();
  for (const u of urls) {
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({ type: "image", uri: u });
    if (out.length >= max) return out;
  }
  for (const f of refFiles) {
    const data = fileToDataUri(f);
    if (!data) continue;
    if (seen.has(data)) continue;
    seen.add(data);
    out.push({ type: "image", uri: data });
    if (out.length >= max) break;
  }
  return out.length ? out : null;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const missing = [];
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length) return res.status(400).json({ ok: false, error: "Missing env vars", missing });

    const { fields, files } = await parseForm(req);

    const tokenFromHeader = getBearerToken(req);
    const tokenFromBody = String(pickField(fields, "access_token") || "").trim();
    const token = tokenFromHeader || tokenFromBody;

    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    const presetId = String(pickField(fields, "presetId") || "").trim();
    const scene = String(pickField(fields, "scene") || "").trim();

    const preset = PRESETS[presetId];
    if (!preset) return res.status(400).json({ ok: false, error: "Unknown preset", presetId });

    // ✅ Определение lab и kind
    const originRaw = String(pickField(fields, "origin_path") || "").trim();
    const origin = originRaw.split("?")[0].replace(/\/+$/, ""); 
    const lab =
      origin === "/cinema_shot" ||
      origin === "/cinema_character" ||
      origin === "/cinema_animation"
        ? "cinema"
        : null;
    const kind =
      origin === "/cinema_character" ? "character" :
      origin === "/cinema_shot" ? "shot" :
      origin === "/cinema_animation" ? "animation" :
      null;

    // ✅ Логика включения Upscale
    const enhanceRequested = normalizeBool(pickField(fields, "enhance") ?? false);
    const allowUpscaleHere = (origin === "/cinema_animation"); 
    const enhance = allowUpscaleHere && enhanceRequested;

    // -------------------------
    // ✅ RUNWAY
    // -------------------------
    if (preset.provider === "runway") {
      if (!RUNWAY_API_KEY) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["RUNWAY_API_KEY"] });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "cinematic realistic shot, film-like contrast")
        .trim();

      const video_duration_sec = normalizeNum(pickField(fields, "video_duration_sec"), null);
      if (!video_duration_sec || video_duration_sec <= 0) {
        return res.status(400).json({
          ok: false,
          error: "video_duration_sec required (seconds, from frontend)",
        });
      }

      if (preset.model === "act_two") {
        if (video_duration_sec < 3) {
          return res.status(400).json({ ok: false, error: "Reference video must be at least 3 seconds", duration: video_duration_sec });
        }
        if (video_duration_sec > 30) {
          return res.status(400).json({ ok: false, error: "Reference video must be <= 30 seconds", duration: video_duration_sec });
        }
      }

      const pricing = getRunwayCostCredits({ modelKey: preset.model, durationSec: video_duration_sec });
      const cost = pricing.credits;

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
            tool: "runway",
            model: preset.model,
            duration: video_duration_sec,
            pricing,
          });
        }
        throw e;
      }

      let endpoint = "";
      let payload = {};

      if (preset.model === "gen4_aleph") {
        endpoint = `${RUNWAY_BASE}/v1/video_to_video`;

        const videoUrl = pickOptionalUrl(fields, "video_url") || pickOptionalUrl(fields, "videoUri");
        const videoFile = pickFiles(files, "video")[0] || null;
        const videoUri = videoUrl || (videoFile ? fileToDataUri(videoFile) : null);
        if (!videoUri) {
          return res.status(400).json({ ok: false, error: "video_url required (or file field 'video')" });
        }

        const ratioRaw = String(pickField(fields, "ratio") || preset.ratio || "16:9");
        const ratio = normalizeRunwayRatio(ratioRaw);
        
        const seed = normalizeInt(pickField(fields, "seed"), null);
        const references = buildRunwayReferences({ fields, files, max: 1 });

        payload = {
          model: "gen4_aleph",
          videoUri,
          promptText: prompt,
          ratio,
          ...(seed !== null ? { seed } : {}),
          ...(references ? { references } : {}),
        };
      } else if (preset.model === "act_two") {
        endpoint = `${RUNWAY_BASE}/v1/character_performance`;

        const character_image_url =
          pickOptionalUrl(fields, "character_image_url") ||
          pickOptionalUrl(fields, "image_url") ||
          pickOptionalUrl(fields, "character_url");

        const imageFile = pickFiles(files, "image")[0] || null;
        const characterUri = character_image_url || (imageFile ? fileToDataUri(imageFile) : null);
        if (!characterUri) {
          return res.status(400).json({
            ok: false,
            error: "character_image_url required (or file field 'image')",
          });
        }

        const reference_video_url =
          pickOptionalUrl(fields, "reference_video_url") ||
          pickOptionalUrl(fields, "video_url") ||
          pickOptionalUrl(fields, "reference_url");

        const refVideoFile = pickFiles(files, "video")[0] || null;
        const referenceUri = reference_video_url || (refVideoFile ? fileToDataUri(refVideoFile) : null);
        if (!referenceUri) {
          return res.status(400).json({
            ok: false,
            error: "reference_video_url required (or file field 'video')",
          });
        }

        const preserve_identity = normalizeBool(pickField(fields, "preserve_identity") ?? preset.preserve_identity ?? true);

        payload = {
          model: "act_two",
          character: { type: "image", uri: characterUri },
          reference: { type: "video", uri: referenceUri },
          ...(prompt ? { promptText: prompt } : {}),
          ...(preserve_identity ? { preserveIdentity: true } : {}),
        };
      } else {
        return res.status(400).json({ ok: false, error: "Unsupported runway model", model: preset.model });
      }

      const rr = await fetch(endpoint, {
        method: "POST",
        headers: runwayHeaders(),
        body: JSON.stringify(payload),
      });

      const txt = await rr.text().catch(() => "");
      let data;
      try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

      if (!rr.ok) {
        return res.status(rr.status).json({
          ok: false,
          error: "Runway error",
          details: data,
        });
      }

      const taskId = data?.id;
      if (!taskId) {
        return res.status(500).json({ ok: false, error: "No task id from Runway", details: data });
      }

      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',$7,'aspect_ratio',$8,'generate_audio',$9,'presetId',$2),$6,$7,$8,$9,$10,null,null)
        `,
        [
          userId,
          presetId,
          taskId,
          `runway:${preset.model}`,
          prompt,
          "processing",
          Math.round(video_duration_sec),
          preset.model === "gen4_aleph" ? String(payload.ratio || "16:9") : null,
          false,
          cost,
        ]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: taskId,
        status: "processing",
        provider: "runway",
        presetId,
        cost,
        credits_left,
        pricing,
      });
    }

    // -------------------------
    // ✅ KLING 2.6 (Img2Vid)
    // -------------------------
    if (preset.provider === "kling" && preset.model === "kwaivgi/kling-v2.6") {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
      }

      const imageUrl = pickOptionalUrl(fields, "image_url");

// 🔥 ВАЖНО: в /api/start больше не принимаем файл для Kling,
// потому что Vercel режет body и всё ломается.
if (!imageUrl) {
  return res.status(400).json({
    ok: false,
    error: "image_url required for Kling 2.6. Upload the image to storage (Supabase/Bunny) first, then send image_url.",
  });
}

      const startImage = imageUrl; // ✅ Replicate принимает URL
      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "a cinematic realistic shot, film-like contrast")
        .trim();

      const duration = Number(pickField(fields, "duration") || preset.duration || 5);
      const aspectRatio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "16:9");
      const generateAudio = normalizeBool(pickField(fields, "generate_audio") ?? preset.generate_audio);

      const cost = getKling26Cost({ durationSec: duration, generateAudio });

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
            tool: "kling_26",
            duration,
            generate_audio: generateAudio,
          });
        }
        throw e;
      }

      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
      // ⚠️ Отправляем в Replicate "чистый" prompt
      const prediction = await replicate.predictions.create({
        model: preset.model,
        input: {
          prompt,
          start_image: startImage,
          duration,
          aspect_ratio: aspectRatio,
          generate_audio: generateAudio,
        },
      });

      // ✅ БЕЗОПАСНОЕ ХРАНЕНИЕ: Пишем тег в prompt
      const metaTag = enhance ? `\n\n[LF_META:UPSCALER=${REPLICATE_UPSCALE_MODEL}]` : "";
      const promptStored = prompt + metaTag;

      // 🔥 INSERT: сохраняем promptStored, model оставляем preset.model
      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',$7,'aspect_ratio',$8,'generate_audio',$9,'presetId',$2),$6,$7,$8,$9,$10,$11,$12)
        `,
        [userId, presetId, prediction.id, preset.model, promptStored, prediction.status, duration, aspectRatio, generateAudio, cost, lab, kind]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
        cost,
        credits_left,
        enhance, 
      });
    }

    // -------------------------
// ✅ KLING v2.5 Turbo Pro (Start + End)
// -------------------------
if (preset.provider === "kling" && preset.model === "kwaivgi/kling-v2.5-turbo-pro") {
  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
  }

  const imageUrl = pickOptionalUrl(fields, "image_url");
  if (!imageUrl) {
    return res.status(400).json({ ok: false, error: "image_url required" });
  }

  const endUrl = pickOptionalUrl(fields, "end_image_url");
  if (!endUrl) {
    return res.status(400).json({ ok: false, error: "end_image_url required for 2-frame mode" });
  }

  const startImage = imageUrl;
  const endImage = endUrl;

  const prompt = (preset.promptTemplate || "{scene}")
    .replaceAll("{scene}", scene || "a cinematic realistic shot, film-like contrast")
    .trim();

  const duration = Number(pickField(fields, "duration") || preset.duration || 5);

  // ✅ не отправляем 21:9 как параметр (иначе 422), держим whitelist
  const rawAspect = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "16:9").trim();
  const ALLOWED_ASPECT = new Set(["16:9", "9:16", "1:1"]);
  const aspectRatio = ALLOWED_ASPECT.has(rawAspect) ? rawAspect : "16:9";

  // credits: временно как у 2.6 без аудио
  const cost = getKling26Cost({ durationSec: duration, generateAudio: false });

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
        tool: "kling_25_turbo_pro",
        duration,
      });
    }
    throw e;
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const prediction = await replicate.predictions.create({
    model: preset.model,
    input: {
      prompt,
      start_image: startImage,
      end_image: endImage,
      duration,
      aspect_ratio: aspectRatio,
    },
  });

  const metaTag = enhance ? `\n\n[LF_META:UPSCALER=${REPLICATE_UPSCALE_MODEL}]` : "";
  const promptStored = prompt + metaTag;

  await pool.query(
    `
    insert into public.generations
      (user_id,
       preset_id,
       replicate_prediction_id,
       model,
       model_key,
       model_display,
       prompt,
       prompt_text,
       params,
       status,
       duration,
       aspect_ratio,
       generate_audio,
       cost,
       lab,
       kind)
    values
      ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',$7,'aspect_ratio',$8,'generate_audio',$9,'presetId',$2),$6,$7,$8,$9,$10,$11,$12)
    `,
    [userId, presetId, prediction.id, preset.model, promptStored, prediction.status, duration, aspectRatio, null, cost, lab, kind]
  );

  return res.status(200).json({
    ok: true,
    user: { id: userId, email },
    jobId: prediction.id,
    status: prediction.status,
    provider: preset.provider,
    presetId,
    cost,
    credits_left,
    enhance,
  });
}


    // -------------------------
    // ✅ KLING 2.6 MOTION CONTROL
    // -------------------------
    if (preset.provider === "kling_mc") {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "cinematic realistic motion, stable framing")
        .trim();

      const mode = String(pickField(fields, "mode") || preset.mode || "std").trim();
      const keep_original_sound = normalizeBool(
        pickField(fields, "keep_original_sound") ?? preset.keep_original_sound ?? true
      );
      const character_orientation = String(
        pickField(fields, "character_orientation") || preset.character_orientation || "image"
      ).trim();

      const video_duration_sec = normalizeNum(pickField(fields, "video_duration_sec"), null);
      if (!video_duration_sec || video_duration_sec <= 0) {
        return res.status(400).json({
          ok: false,
          error: "video_duration_sec required (seconds, from reference video duration)",
        });
      }

      const maxSec = character_orientation === "video" ? 30 : 10;
      if (video_duration_sec < 3) {
        return res.status(400).json({ ok: false, error: "Reference video must be at least 3 seconds", duration: video_duration_sec });
      }
      if (video_duration_sec > maxSec) {
        return res.status(400).json({
          ok: false,
          error: `Reference video too long for character_orientation='${character_orientation}' (max ${maxSec}s)`,
          duration: video_duration_sec,
          max: maxSec,
        });
      }

      const imageUrl = pickOptionalUrl(fields, "image_url");
      const videoUrl = pickOptionalUrl(fields, "video_url");
      const imageFile = pickFiles(files, "image")[0] || null;
      const videoFile = pickFiles(files, "video")[0] || null;
      const image = imageUrl || (imageFile ? fileToDataUri(imageFile) : null);
      const video = videoUrl || (videoFile ? fileToDataUri(videoFile) : null);

      if (!image) return res.status(400).json({ ok: false, error: "image_url required (or file field 'image')" });
      if (!video) return res.status(400).json({ ok: false, error: "video_url required (or file field 'video')" });

      const pricing = getMotionControlCredits({ mode, durationSec: video_duration_sec });
      const cost = pricing.credits;

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
            tool: "kling_motion_control",
            mode,
            duration: video_duration_sec,
          });
        }
        throw e;
      }

      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

      const prediction = await replicate.predictions.create({
        model: preset.model,
        input: {
          mode,
          image,
          video,
          prompt,
          keep_original_sound,
          character_orientation,
        },
      });

      // ✅ ДОБАВЛЕНО ДЛЯ MOTION CONTROL: Формируем metaTag и promptStored
      const metaTag = enhance ? `\n\n[LF_META:UPSCALER=${REPLICATE_UPSCALE_MODEL}]` : "";
      const promptStored = prompt + metaTag;

      // 🔥 INSERT: строго по порядку $1..$12, generate_audio=null
      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',$7,'aspect_ratio',$8,'generate_audio',$9,'presetId',$2),$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          userId,                         // $1
          presetId,                       // $2
          prediction.id,                  // $3
          preset.model,                   // $4
          promptStored,                   // $5
          prediction.status,              // $6
          Math.round(video_duration_sec), // $7
          null,                           // $8 (aspect_ratio)
          null,                           // $9 (generate_audio - чистый NULL)
          cost,                           // $10
          lab,                            // $11
          kind                            // $12
        ]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
        cost,
        credits_left,
        pricing,
        enhance, // Возвращаем флаг, чтобы UI знал
      });
    }

    // -------------------------
    // ✅ VEO 3.1
    // -------------------------
    if (preset.provider === "veo") {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "a cinematic realistic shot, film-like contrast")
        .trim();

      const duration = Number(pickField(fields, "duration") || preset.duration || 8);
      const aspect_ratio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "16:9");
      const resolution = String(pickField(fields, "resolution") || preset.resolution || "1080p");
      const generate_audio = normalizeBool(pickField(fields, "generate_audio") ?? preset.generate_audio ?? true);
      const negative_prompt = normalizeStr(pickField(fields, "negative_prompt") ?? preset.negative_prompt ?? "", "");
      const seed = normalizeInt(pickField(fields, "seed"), null);

      const imageFile = pickFiles(files, "image")[0] || null;
      const imageUrl = pickOptionalUrl(fields, "image_url");

      const lastFrameFile = pickFiles(files, "last_frame")[0] || null;
      const lastFrameUrl = pickOptionalUrl(fields, "last_frame_url");

      const image = imageFile ? fileToDataUri(imageFile) : imageUrl || undefined;
      const last_frame = lastFrameFile ? fileToDataUri(lastFrameFile) : lastFrameUrl || undefined;

      const reference_images = buildReferenceImagesInput({ fields, files, max: 3 }) || undefined;

      const cost = getVeoCost({ model: preset.model, durationSec: duration });

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
            tool: "veo_3_1",
            duration,
            aspect_ratio,
            resolution,
            generate_audio,
          });
        }
        throw e;
      }

      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

      const input = {
        prompt,
        aspect_ratio,
        duration,
        resolution,
        generate_audio,
        ...(negative_prompt ? { negative_prompt } : {}),
        ...(seed !== null ? { seed } : {}),
        ...(image ? { image } : {}),
        ...(last_frame ? { last_frame } : {}),
        ...(reference_images ? { reference_images } : {}),
      };

      const prediction = await replicate.predictions.create({
        model: preset.model,
        input,
      });

      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',$7,'aspect_ratio',$8,'generate_audio',$9,'presetId',$2),$6,$7,$8,$9,$10,$11,$12)
        `,
        [userId, presetId, prediction.id, preset.model, prompt, prediction.status, duration, aspect_ratio, generate_audio, cost, lab, kind]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
        cost,
        credits_left,
      });
    }

    // -------------------------
    // ⚡ Z-IMAGE-TURBO
    // -------------------------
    if (
      preset.provider === "replicate_image" &&
      preset.model === "prunaai/z-image-turbo"
    ) {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({
          ok: false,
          error: "Missing env vars",
          missing: ["REPLICATE_API_TOKEN"],
        });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "high quality")
        .trim();

      const client = await pool.connect();
      let credits_left = null;
      let cost = 0;
      let run_index = 0;

      try {
        await client.query("BEGIN");

        // 🔒 защита от гонок
        await client.query(
          `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          ["z_image_turbo", String(userId)]
        );

        const c = await client.query(
          `select count(*)::int as cnt
           from public.generations
           where user_id = $1 and preset_id = $2`,
          [userId, presetId]
        );

        run_index = Number(c.rows?.[0]?.cnt || 0) + 1;
        cost = run_index % 4 === 0 ? 1 : 0;

        if (cost > 0) {
          const { rows } = await client.query(
            "select ok, credits_left from public.consume_credits($1::uuid, $2::int)",
            [userId, cost]
          );

          const row = rows?.[0] || { ok: false, credits_left: 0 };
          if (!row.ok) {
            await client.query("ROLLBACK");
            return res.status(402).json({
              ok: false,
              error: "Not enough credits",
              credits: Number(row.credits_left || 0),
              required: cost,
            });
          }
          credits_left = Number(row.credits_left || 0);
        }

        const replicate = new Replicate({
          auth: process.env.REPLICATE_API_TOKEN,
        });

        const d = preset.defaults || {};

        const prediction = await replicate.predictions.create({
          model: preset.model,
          input: {
            prompt,
            width: d.width ?? 1024,
            height: d.height ?? 768,
            num_inference_steps: d.num_inference_steps ?? 8,
            guidance_scale: d.guidance_scale ?? 0,
            output_format: d.output_format ?? "jpg",
            output_quality: d.output_quality ?? 80,
            go_fast: true,
          },
        });

        await client.query(
          `
          insert into public.generations
            (user_id,
             preset_id,
             replicate_prediction_id,
             model,
             model_key,
             model_display,
             prompt,
             prompt_text,
             params,
             status,
             duration,
             aspect_ratio,
             generate_audio,
             cost,
             lab,
             kind)
          values
            ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',null,'aspect_ratio',null,'generate_audio',null,'presetId',$2),$6,null,null,null,$7,null,null)
          `,
          [
            userId,
            presetId,
            prediction.id,
            preset.model,
            prompt,
            prediction.status,
            cost,
          ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
          ok: true,
          user: { id: userId, email },
          jobId: prediction.id,
          status: prediction.status,
          provider: "replicate_image",
          presetId,
          cost,
          credits_left,
          turbo_run: run_index,
          note: run_index % 4 === 0 ? "paid_run" : "free_run",
        });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    }

    // -------------------------
    // ✅ REPLICATE IMAGE MODELS
    // -------------------------
    if (preset.provider === "replicate_image") {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "high quality, detailed")
        .trim();

      const cost = calcReplicateImageCost(preset, fields);

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
            tool: "replicate_image",
            model: preset.model,
          });
        }
        throw e;
      }

      // Collect inputs
      const image_input_urls = pickFields(fields, "image_input_urls")
        .map((x) => String(x || "").trim())
        .filter(Boolean);

      const input_images = pickFields(fields, "input_images")
        .map((x) => String(x || "").trim())
        .filter(Boolean);

      const reference_images = pickFields(fields, "reference_image_urls")
        .map((x) => String(x || "").trim())
        .filter(Boolean);

      // File handling
      const fileImgs = pickFiles(files, "images");
      const fileImgs2 = pickFiles(files, "image_input");
      const fileImgs3 = pickFiles(files, "input_images");

      const fileDataUris = []
        .concat(fileImgs, fileImgs2, fileImgs3)
        .map((f) => fileToDataUri(f))
        .filter(Boolean);

      // General scalar helper
      const allowScalar = (name) => {
        const v = pickField(fields, name);
        if (v === undefined || v === null) return undefined;
        const s = String(v).trim();
        if (s === "") return undefined;
        return s;
      };

      // Common knobs
      const size = allowScalar("size");
      const aspect_ratio = allowScalar("aspect_ratio");
      const width = normalizeInt(allowScalar("width"), null);
      const height = normalizeInt(allowScalar("height"), null);
      const seed = normalizeInt(allowScalar("seed"), null);
      const resolution = allowScalar("resolution");
      const safety_tolerance = normalizeInt(allowScalar("safety_tolerance"), null);
      const output_format = allowScalar("output_format");
      const output_quality = normalizeInt(allowScalar("output_quality"), null);

      let input = { prompt };

      if (preset.model === "bytedance/seedream-4") {
        const imgSingle = String(pickField(fields, "image_input_url") || "").trim();
        const imgMulti = pickFields(fields, "image_input_urls")
          .map((x) => String(x || "").trim())
          .filter(Boolean);
        
        const allUrls = [...imgMulti, ...(imgSingle ? [imgSingle] : [])];
        const imgs = [...allUrls, ...fileDataUris].filter(Boolean);
        
        const capped = imgs.slice(0, 10);
        if (capped.length) input.image_input = capped;
        
        const size = String(pickField(fields, "size") || "2K").trim();
        const aspect_ratio = String(pickField(fields, "aspect_ratio") || "match_input_image").trim();
        const max_images = normalizeInt(pickField(fields, "max_images"), 1);
        const enhance_prompt = normalizeBool(pickField(fields, "enhance_prompt") ?? true);
        
        input.size = size;
        input.aspect_ratio = aspect_ratio;
        input.max_images = max_images;
        input.enhance_prompt = enhance_prompt;
        
        const width = normalizeInt(pickField(fields, "width"), null);
        const height = normalizeInt(pickField(fields, "height"), null);
        if (size === "custom") {
          if (width) input.width = width;
          if (height) input.height = height;
        }

      } else if (preset.model === "black-forest-labs/flux-2-max") {
        const imgs = input_images.length ? input_images : (reference_images.length ? reference_images : (fileDataUris.length ? fileDataUris : []));
        
        const capped = imgs.slice(0, 8);
        if (capped.length) input.input_images = capped;

        if (aspect_ratio) input.aspect_ratio = aspect_ratio;
        if (resolution) input.resolution = resolution;
        if (width !== null) input.width = width;
        if (height !== null) input.height = height;
        if (safety_tolerance !== null) input.safety_tolerance = safety_tolerance;
        if (seed !== null) input.seed = seed;
        if (output_format) input.output_format = output_format;
        if (output_quality !== null) input.output_quality = output_quality;
      } else {
        if (aspect_ratio) input.aspect_ratio = aspect_ratio;
        if (seed !== null) input.seed = seed;
      }

      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
      const prediction = await replicate.predictions.create({
        model: preset.model,
        input,
      });

      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',null,'aspect_ratio',$7,'generate_audio',null,'presetId',$2),$6,null,$7,null,$8,null,null)
        `,
        [userId, presetId, prediction.id, preset.model, prompt, prediction.status, aspect_ratio || null, cost]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: "replicate_image",
        presetId,
        cost,
        credits_left,
      });
    }

    // -------------------------
    // ✅ NANO
    // -------------------------
    if (preset.provider === "nano") {
      if (!process.env.REPLICATE_API_TOKEN) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["REPLICATE_API_TOKEN"] });
      }

      const prompt = (preset.promptTemplate || "{scene}")
        .replaceAll("{scene}", scene || "high quality, detailed")
        .trim();

      const urls = buildNanoImageInput(fields, 14);
      const image_input = urls ? urls : undefined;

      const aspect_ratio = String(pickField(fields, "aspect_ratio") || preset.aspect_ratio || "match_input_image");
      const resolution = String(pickField(fields, "resolution") || preset.resolution || "2K");
      const output_format = String(pickField(fields, "output_format") || preset.output_format || "png");
      const safety_filter_level = String(pickField(fields, "safety_filter_level") || preset.safety_filter_level || "block_only_high");

      const cost = getNanoCost({ resolution, included: false });

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
            tool: "nano",
            resolution,
          });
        }
        throw e;
      }

      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
      const prediction = await replicate.predictions.create({
        model: preset.model,
        input: {
          prompt,
          ...(image_input ? { image_input } : {}),
          aspect_ratio,
          resolution,
          output_format,
          safety_filter_level,
        },
      });

      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',null,'aspect_ratio',$7,'generate_audio',null,'presetId',$2),$6,null,$7,null,$8,$9,$10)
        `,
        [userId, presetId, prediction.id, preset.model, prompt, prediction.status, aspect_ratio, cost, lab, kind]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: prediction.id,
        status: prediction.status,
        provider: preset.provider,
        presetId,
        cost,
        credits_left,
      });
    }

    // -------------------------
    // ✅ FREEPIK (Detail Boost)
    // -------------------------
    if (preset.provider === "freepik") {
      if (!FREEPIK_API_KEY) {
        return res.status(400).json({ ok: false, error: "Missing env vars", missing: ["FREEPIK_API_KEY"] });
      }

      const mode = String(pickField(fields, "mode") || preset.mode || "creative");
      const scale = Number(pickField(fields, "scale") || preset.scale || 2);
      const strength = Number(pickField(fields, "strength") || preset.strength || 0.6);
      const prompt = String(pickField(fields, "prompt") || "").trim();

      const OPT = new Set([
        "standard",
        "soft_portraits",
        "hard_portraits",
        "art_n_illustration",
        "videogame_assets",
        "nature_n_landscapes",
        "films_n_photography",
        "3d_renders",
        "science_fiction_n_horror",
      ]);

      const MAP = {
        standard: "standard",
        portraits_soft: "soft_portraits",
        portraits_hard: "hard_portraits",
        art_illustrations: "art_n_illustration",
        videogame_assets: "videogame_assets",
        nature_landscapes: "nature_n_landscapes",
        films_photography: "films_n_photography",
        "3d_renders": "3d_renders",
        science_fiction_horror: "science_fiction_n_horror",
        soft_portraits: "soft_portraits",
        hard_portraits: "hard_portraits",
        art_n_illustration: "art_n_illustration",
        nature_n_landscapes: "nature_n_landscapes",
        films_n_photography: "films_n_photography",
        science_fiction_n_horror: "science_fiction_n_horror",
      };

      const optimized_for_raw = String(pickField(fields, "optimized_for") || "standard").trim();
      const normalized = MAP[optimized_for_raw] || "standard";
      const optimized_for = OPT.has(normalized) ? normalized : "standard";

      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

      const creativity_in = Number(pickField(fields, "creativity") ?? NaN);
      const hdr_in = Number(pickField(fields, "hdr") ?? NaN);
      const resemblance_in = Number(pickField(fields, "resemblance") ?? NaN);
      const fractality_in = Number(pickField(fields, "fractality") ?? NaN);

      const creativity = Number.isFinite(creativity_in) ? clamp(creativity_in, -10, 10) : null;
      const hdr = Number.isFinite(hdr_in) ? clamp(hdr_in, -10, 10) : null;
      const resemblance = Number.isFinite(resemblance_in) ? clamp(resemblance_in, -10, 10) : null;
      const fractality = Number.isFinite(fractality_in) ? clamp(fractality_in, -10, 10) : null;

      const imageFile = pickFiles(files, "image")[0];
      const imageUrl = String(pickField(fields, "image_url") || "").trim();

      if (!imageFile && !imageUrl) {
        return res.status(400).json({ ok: false, error: "Image required: send file 'image' or field 'image_url'" });
      }

      const cost = mode === "precision_v2" ? (scale >= 4 ? 2 : 1) : 1;

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
            tool: "detail_boost",
            mode,
            scale,
          });
        }
        throw e;
      }

      const image_base64 = imageFile ? fileToBase64(imageFile) : await fetchUrlToBase64(imageUrl);

      let endpoint = "";
      let payload = {};

      if (mode === "creative") {
        endpoint = "https://api.freepik.com/v1/ai/image-upscaler";
        payload = {
          image: image_base64,
          scale_factor: scale >= 4 ? "4x" : "2x",
          optimized_for,
          prompt,
          creativity: creativity ?? Math.round((strength - 0.5) * 10),
          hdr: hdr ?? 0,
          resemblance: resemblance ?? 0,
          fractality: fractality ?? 0,
          engine: "magnific_sparkle",
        };
      } else if (mode === "precision_v2") {
        endpoint = "https://api.freepik.com/v1/ai/image-upscaler-precision-v2";
        payload = {
          image: image_base64,
          scale_factor: scale >= 4 ? 4 : 2,
          sharpen: 7,
          smart_grain: 7,
          ultra_detail: 30,
          flavor: "sublime",
        };
      } else {
        return res.status(400).json({ ok: false, error: "Bad mode", mode });
      }

      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-freepik-api-key": FREEPIK_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      const txt = await r.text();
      let data;
      try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

      if (!r.ok) {
        return res.status(r.status).json({
          ok: false,
          error: data?.error || data?.message || "Freepik error",
          details: data,
        });
      }

      const taskId = data?.data?.task_id;
      const status = data?.data?.status || "queued";
      if (!taskId) {
        return res.status(500).json({ ok: false, error: "No task_id from Freepik", details: data });
      }

      await pool.query(
        `
        insert into public.generations
          (user_id,
           preset_id,
           replicate_prediction_id,
           model,
           model_key,
           model_display,
           prompt,
           prompt_text,
           params,
           status,
           duration,
           aspect_ratio,
           generate_audio,
           cost,
           lab,
           kind)
        values
          ($1,$2,$3,$4,$4,$4,$5,$5,jsonb_build_object('duration',null,'aspect_ratio',$7,'generate_audio',null,'presetId',$2),$6,null,$7,null,$8,null,null)
        `,
        [userId, presetId, taskId, `freepik:${mode}`, prompt, status, null, cost]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: taskId,
        status,
        provider: "freepik",
        presetId,
        mode,
        scale,
        cost,
        credits_left,
      });
    }

    if (preset.provider === "fal") {
      return res.status(400).json({
        ok: false,
        error: "Use /api/start_fal_json for Kling O1 (fal queue)",
        provider: "fal",
      });
    }

    return res.status(400).json({ ok: false, error: "Unsupported provider", provider: preset.provider });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Internal error", details: String(e?.message || e) });
  }
}
