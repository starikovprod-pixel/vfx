import { createClient } from "@supabase/supabase-js";
import { pool } from "../lib/db.js";
import { PRESETS } from "../lib/presets.js";
import { fal } from "@fal-ai/client";
import { chargeCreditsOrThrow } from "../lib/credits.js";
import { getKlingO1Cost } from "../lib/pricing.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allow =
    origin === "https://lightfull.ai" ||
    origin === "https://www.lightfull.ai" ||
    origin === "https://api.lightfull.ai"
      ? origin
      : "https://lightfull.ai";

  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

async function getUserFromSupabase(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
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

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseImageUrls(body) {
  let image_urls = [];
  if (Array.isArray(body.image_urls)) {
    image_urls = body.image_urls.map(String).map((s) => s.trim()).filter(Boolean);
  } else if (body.image_url) {
    const one = String(body.image_url).trim();
    if (one) image_urls = [one];
  }
  return image_urls;
}

async function safeJsonFetch(url, headers) {
  const r = await fetch(url, { method: "GET", headers });
  const txt = await r.text();
  let j = {};
  try {
    j = txt ? JSON.parse(txt) : {};
  } catch {
    j = { _raw: txt };
  }
  return { ok: r.ok, status: r.status, json: j };
}

// ✅ Helpers for Supabase Upload (used in GET section)
function guessContentType(url) {
  const u = String(url || "").toLowerCase();
  if (u.endsWith(".glb")) return "model/gltf-binary";
  if (u.endsWith(".gltf")) return "model/gltf+json";
  if (u.endsWith(".obj")) return "text/plain";
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".mp4")) return "video/mp4";
  if (u.endsWith(".mov")) return "video/quicktime";
  if (u.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

async function fetchAsBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed ${r.status} for ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function extFromUrl(url, fallback) {
  const m = String(url || "").match(/\.(glb|gltf|obj|png|jpg|jpeg|webp|mp4|mov|webm)(\?|$)/i);
  return m ? m[1].toLowerCase() : fallback;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!process.env.FAL_KEY) missing.push("FAL_KEY");
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (missing.length) {
      return res.status(400).json({ ok: false, error: "Missing env vars", missing });
    }

    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    // fal key
    fal.config({ credentials: process.env.FAL_KEY });

    // =========================================================
    // ✅ GET = STATUS/RESULT (в этом же файле)
    // =========================================================
    if (req.method === "GET") {
      const jobId = String(req.query.jobId || "").trim();
      if (!jobId) return res.status(400).json({ ok: false, error: "jobId required" });

      // ✅ 1. endpoint from query
      let model = String(req.query.endpoint || "").trim();

      // ✅ 2. fallback from DB
      if (!model) {
        const q = await pool.query(
          `select preset_id, model
           from public.generations
           where user_id = $1 and replicate_prediction_id = $2
           order by created_at desc
           limit 1`,
          [userId, jobId]
        );
        const row = q.rows?.[0];
        model = row?.model ? String(row.model) : "";
      }

      if (!model) {
        return res.status(404).json({
          ok: false,
          error: "Job not found (no model). Pass endpoint in query.",
          jobId,
        });
      }

      const headers = { Authorization: `Key ${process.env.FAL_KEY}` };

      // IMPORTANT: strip subpath for status/result
      const modelParts = String(model).split("/").filter(Boolean);
      const modelBase = modelParts.slice(0, 2).join("/");

      const stUrl = `https://queue.fal.run/${modelBase}/requests/${encodeURIComponent(jobId)}/status?logs=0`;
      const st = await safeJsonFetch(stUrl, headers);

      if (!st.ok) {
        if (st.status === 404 || st.status === 409 || st.status >= 500) {
          return res.status(200).json({ ok: true, status: "IN_PROGRESS" });
        }
        return res.status(500).json({
          ok: false,
          error: "fal status failed",
          status_code: st.status,
          model,
          modelBase,
          jobId,
          url: stUrl,
          details: st.json,
        });
      }

      if (st.json.status !== "COMPLETED") {
        return res.status(200).json({ ok: true, status: st.json.status });
      }

      // RESULT
      const outUrl = `https://queue.fal.run/${modelBase}/requests/${encodeURIComponent(jobId)}`;
      const out = await safeJsonFetch(outUrl, headers);

      if (!out.ok) {
        return res.status(500).json({ ok: false, error: "fal result failed", details: out.json });
      }

      // ---- unify outputs for library ----
      let output_url =
        out.json?.video?.url ||
        out.json?.video_url ||
        out.json?.url ||
        out.json?.output?.url ||
        out.json?.result?.url ||
        null;

      // For 3D outputs (your existing logic)
      let glb =
        out.json?.model_urls?.glb?.url ||
        out.json?.model_glb?.url ||
        out.json?.glb?.url ||
        null;

      let obj =
        out.json?.model_urls?.obj?.url ||
        out.json?.model_obj?.url ||
        out.json?.obj?.url ||
        null;

      let thumbnail =
        out.json?.thumbnail?.url ||
        out.json?.preview?.url ||
        null;

      output_url = output_url || glb || obj || thumbnail || null;

      // =========================================================
      // ✅ UPLOAD TO SUPABASE OUTPUTS (optional)
      // =========================================================
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (SUPABASE_SERVICE_ROLE_KEY) {
        const sbAdmin = createClient(process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const bucket = "outputs";
        const basePath = `${userId}/fal/${jobId}`;

        async function uploadUrlToOutputs(fileUrl, name) {
          if (!fileUrl) return null;
          const buf = await fetchAsBuffer(fileUrl);
          const ext = extFromUrl(fileUrl, "bin");
          const path = `${basePath}/${name}.${ext}`;

          const { error } = await sbAdmin.storage
            .from(bucket)
            .upload(path, buf, {
              upsert: true,
              contentType: guessContentType(fileUrl),
              cacheControl: "31536000",
            });

          if (error) throw new Error(`Supabase upload failed: ${error.message}`);

          const { data } = sbAdmin.storage.from(bucket).getPublicUrl(path);
          return data?.publicUrl || null;
        }

        const outVideo2 = await uploadUrlToOutputs(output_url, "output");
        const glb2 = await uploadUrlToOutputs(glb, "model");
        const obj2 = await uploadUrlToOutputs(obj, "model");
        const thumb2 = await uploadUrlToOutputs(thumbnail, "thumb");

        output_url = outVideo2 || output_url;
        glb = glb2 || glb;
        obj = obj2 || obj;
        thumbnail = thumb2 || thumbnail;
      }
      // =========================================================

      if (output_url) {
        await pool.query(
          `
          update public.generations
          set status = $1,
              output_url = $2
          where user_id = $3 and replicate_prediction_id = $4
          `,
          ["succeeded", output_url, userId, jobId]
        );
      } else {
        await pool.query(
          `
          update public.generations
          set status = $1
          where user_id = $2 and replicate_prediction_id = $3
          `,
          ["succeeded", userId, jobId]
        );
      }

      return res.status(200).json({
        ok: true,
        status: "succeeded",
        output_url,
        glb,
        obj,
        thumbnail,
        raw: out.json,
      });
    }

    // =========================================================
    // ✅ POST only below
    // =========================================================
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = await readJsonBody(req);
    const presetId = String(body.presetId || "").trim();
    if (!presetId) return res.status(400).json({ ok: false, error: "presetId required" });

    const scene = String(body.scene || "").trim();

    // =========================================================
    // ✅ HUNYUAN 3D v3 IMAGE->3D — HANDLE WITHOUT PRESETS
    // =========================================================
    if (presetId === "hunyuan3d_v3") {
      const HUNYUAN_MODEL = "fal-ai/hunyuan3d-v3/image-to-3d";

      const input_image_url = String(body.input_image_url || "").trim();
      if (!input_image_url) {
        return res.status(400).json({ ok: false, error: "input_image_url required" });
      }

      const back_image_url = String(body.back_image_url || "").trim();
      const left_image_url = String(body.left_image_url || "").trim();
      const right_image_url = String(body.right_image_url || "").trim();

      const enable_pbr = body.enable_pbr != null ? !!body.enable_pbr : true;
      const generate_type = String(body.generate_type || "Normal");
      const polygon_type = String(body.polygon_type || "triangle");
      const face_count = body.face_count != null ? Number(body.face_count) : 500000;

      // pricing
      let cost = 0;
      if (generate_type === "Geometry") cost = 3;
      else if (generate_type === "LowPoly") cost = 4;
      else cost = 4;

      if (face_count >= 400000) cost += 3;
      if (face_count >= 900000) cost += 2;
      if (face_count >= 1200000) cost += 1;

      if (enable_pbr && generate_type !== "Geometry") cost += 2;

      const hasMultiView = !!(back_image_url || left_image_url || right_image_url);
      if (hasMultiView) cost += 2;

      cost = Math.max(1, Math.min(25, cost));

      let credits_left = 0;
      try {
        if (cost > 0) credits_left = await chargeCreditsOrThrow(userId, cost);
      } catch (e) {
        if (e.code === "NOT_ENOUGH_CREDITS") {
          return res.status(402).json({ ok: false, error: "Not enough credits", credits: e.credits_left, required: cost });
        }
        throw e;
      }

      const falInput = {
        input_image_url,
        enable_pbr,
        generate_type,
        polygon_type,
        face_count,
        ...(back_image_url ? { back_image_url } : {}),
        ...(left_image_url ? { left_image_url } : {}),
        ...(right_image_url ? { right_image_url } : {}),
        ...(scene ? { prompt: scene } : {}),
      };

      const submit = await fal.queue.submit(HUNYUAN_MODEL, { input: falInput });
      const requestId = submit?.request_id;
      if (!requestId) {
        return res.status(400).json({ ok: false, error: "fal: missing request_id", details: submit });
      }

      await pool.query(
        `
        insert into public.generations
          (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration)
        values
          ($1, $2, $3, $4, $5, $6, $7)
        `,
        [userId, presetId, requestId, HUNYUAN_MODEL, scene || "", "starting", 0]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: requestId,
        status: "starting",
        provider: "fal",
        presetId,
        cost,
        credits_left,
      });
    }

    // =========================================================
    // ✅ QWEN MULTIANGLE — HANDLE WITHOUT PRESETS
    // =========================================================
    if (presetId === "qwen_multiangle") {
      const QWEN_MODEL = "fal-ai/qwen-image-edit-2511-multiple-angles";

      let image_urls = parseImageUrls(body);
      if (image_urls.length > 4) image_urls = image_urls.slice(0, 4);
      if (!image_urls.length) return res.status(400).json({ ok: false, error: "image_url required" });

      const horizontal_angle = Number(body.horizontal_angle ?? 305);
      const vertical_angle = Number(body.vertical_angle ?? 0);
      const zoom = Number(body.zoom ?? 5);

      const lora_scale = body.lora_scale != null ? Number(body.lora_scale) : 1.25;
      const use_wide_angle = body.use_wide_angle != null ? !!body.use_wide_angle : false;
      const num_inference_steps = body.num_inference_steps != null ? Number(body.num_inference_steps) : 20;

      const prompt = (scene || "").trim();

      const client = await pool.connect();
      let credits_left = null;
      let cost = 0;
      let run_index = 0;

      try {
        await client.query("BEGIN");

        await client.query(
          `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
          ["qwen_multiangle", String(userId)]
        );

        const c = await client.query(
          `select count(*)::int as cnt
           from public.generations
           where user_id = $1 and preset_id = $2`,
          [userId, presetId]
        );

        const prev = Number(c.rows?.[0]?.cnt || 0);
        run_index = prev + 1;

        cost = run_index % 4 === 0 ? 1 : 0;

        if (cost > 0) {
          const { rows } = await client.query(
            "select ok, credits_left from public.consume_credits($1::uuid, $2::int)",
            [userId, cost]
          );
          const row = rows?.[0] || { ok: false, credits_left: 0 };
          if (!row.ok) {
            await client.query("ROLLBACK");
            return res.status(402).json({ ok: false, error: "Not enough credits", credits: Number(row.credits_left || 0), required: cost });
          }
          credits_left = Number(row.credits_left || 0);
        }

        const falInput = {
          image_urls,
          horizontal_angle,
          vertical_angle,
          zoom,
          lora_scale,
          use_wide_angle,
          num_inference_steps,
          ...(prompt ? { prompt } : {}),
        };

        const submit = await fal.queue.submit(QWEN_MODEL, { input: falInput });
        const requestId = submit?.request_id;
        if (!requestId) {
          await client.query("ROLLBACK");
          return res.status(400).json({ ok: false, error: "fal: missing request_id", details: submit });
        }

        await client.query(
          `
          insert into public.generations
            (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration)
          values
            ($1, $2, $3, $4, $5, $6, $7)
          `,
          [userId, presetId, requestId, QWEN_MODEL, prompt || "", "starting", 0]
        );

        await client.query("COMMIT");

        return res.status(200).json({
          ok: true,
          user: { id: userId, email },
          jobId: requestId,
          status: "starting",
          provider: "fal",
          presetId,
          cost,
          credits_left,
        });
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    }

    // =========================================================
    // ✅ OTHER FAL PRESETS — uses PRESETS
    // =========================================================
    const preset = PRESETS[presetId];
    if (!preset) {
      return res.status(400).json({
        ok: false,
        error: "Unknown preset",
        presetId,
        known_presets: Object.keys(PRESETS),
      });
    }
    if (preset.provider !== "fal") {
      return res.status(400).json({ ok: false, error: "Preset is not fal", presetId });
    }

    // =========================================================
    // ✅ KLING O1 FLFV (FIRST → LAST) Image-to-Video
    // presetId: kling_o1_flfv_std / kling_o1_flfv_pro
    // schema: prompt, start_image_url, end_image_url, duration(3..10)
    // =========================================================
    if (presetId === "kling_o1_flfv_std" || presetId === "kling_o1_flfv_pro") {
      const start_image_url =
        String(body.start_image_url || "").trim() ||
        (Array.isArray(body.image_urls) ? String(body.image_urls[0] || "").trim() : "");

      const end_image_url =
        String(body.end_image_url || "").trim() ||
        (Array.isArray(body.image_urls) ? String(body.image_urls[1] || "").trim() : "");

      if (!start_image_url) return res.status(400).json({ ok: false, error: "start_image_url required" });
      if (!end_image_url) return res.status(400).json({ ok: false, error: "end_image_url required" });

      const dRaw = Number(body.duration ?? preset.duration ?? 5);
      const d = Math.max(3, Math.min(10, Math.round(dRaw || 5)));

      const prompt =
        ((preset.promptTemplate || "{scene}").replaceAll("{scene}", scene || "").trim()) ||
        "Use @Image1 as the start frame and @Image2 as the end frame. Create a cinematic transition.";

      // credits ladder by duration (tune later)
      let cost = d <= 4 ? 2 : d <= 6 ? 3 : d <= 8 ? 4 : 5;
      if (presetId === "kling_o1_flfv_pro") cost += 1;

      let credits_left = 0;
      try {
        credits_left = await chargeCreditsOrThrow(userId, cost);
      } catch (e) {
        if (e.code === "NOT_ENOUGH_CREDITS") {
          return res.status(402).json({ ok: false, error: "Not enough credits", credits: e.credits_left, required: cost });
        }
        throw e;
      }

      const falInput = {
        prompt,
        start_image_url,
        end_image_url,
        duration: String(d),
      };

      const submit = await fal.queue.submit(preset.model, { input: falInput });
      const requestId = submit?.request_id;
      if (!requestId) {
        return res.status(400).json({ ok: false, error: "fal: missing request_id", details: submit });
      }

      await pool.query(
        `
        insert into public.generations
          (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration)
        values
          ($1, $2, $3, $4, $5, $6, $7)
        `,
        [userId, presetId, requestId, preset.model, prompt, "starting", d]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        jobId: requestId,
        status: "starting",
        provider: "fal",
        presetId,
        cost,
        credits_left,
        params: { duration: d },
      });
    }

    // =========================================================
    // ✅ Default: Kling O1 Edit (video-to-video) style
    // =========================================================
    const video_url = String(body.video_url || "").trim();
    const keep_original_sound = !!body.keep_original_sound;

    let image_urls = parseImageUrls(body);
    if (image_urls.length > 4) image_urls = image_urls.slice(0, 4);

    const duration =
      Number(body.duration) ||
      Number(body.video_duration) ||
      Number(body.seconds) ||
      0;

    if (!video_url) return res.status(400).json({ ok: false, error: "video_url required" });

    const prompt = (preset.promptTemplate || "{scene}")
      .replaceAll("{scene}", scene || "edit the video")
      .trim();

    const d = duration || Number(preset.duration) || 6;

    let cost = 10;
    try {
      cost = getKlingO1Cost(d);
    } catch (e) {
      if (e.code === "O1_MAX_DURATION_EXCEEDED") {
        return res.status(400).json({ ok: false, error: "O1 supports up to 15 seconds", duration: e.duration });
      }
      throw e;
    }

    let credits_left = 0;
    try {
      credits_left = await chargeCreditsOrThrow(userId, cost);
    } catch (e) {
      if (e.code === "NOT_ENOUGH_CREDITS") {
        return res.status(402).json({ ok: false, error: "Not enough credits", credits: e.credits_left, required: cost });
      }
      throw e;
    }

    const falInput = {
      prompt,
      video_url,
      keep_audio: keep_original_sound,
      ...(image_urls.length ? { image_urls } : {}),
    };



    const submit = await fal.queue.submit(preset.model, { input: falInput });
    const requestId = submit?.request_id;
    if (!requestId) {
      return res.status(400).json({ ok: false, error: "fal: missing request_id", details: submit });
    }

    await pool.query(
      `
      insert into public.generations
        (user_id, preset_id, replicate_prediction_id, model, prompt, status, duration)
      values
        ($1, $2, $3, $4, $5, $6, $7)
      `,
      [userId, presetId, requestId, preset.model, prompt, "starting", Math.round(d)]
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
      has_image_ref: !!image_urls.length,
      image_urls: image_urls.length ? image_urls : undefined,
    });

  } catch (e) {
    console.error("start_fal_json error:", e);
    return res.status(500).json({ ok: false, error: "Internal error", details: String(e?.message || e) });
  }
}
