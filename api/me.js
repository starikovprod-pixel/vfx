import { pool } from "../lib/db.js";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

async function tableExists(tableName) {
  const { rows } = await pool.query(`select to_regclass($1) as t`, [tableName]);
  return !!rows?.[0]?.t;
}

function parsePagination(req) {
  const host = req.headers.host || "api.lightfull.ai";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const fullUrl = new URL(req.url, `${proto}://${host}`);

  const limitRaw = parseInt(fullUrl.searchParams.get("limit") || "24", 10);
  const offsetRaw = parseInt(fullUrl.searchParams.get("offset") || "0", 10);

  const limit = Math.min(Math.max(isNaN(limitRaw) ? 24 : limitRaw, 1), 100);
  const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  return { limit, offset, fullUrl };
}

function isUuid(v) {
  const s = String(v || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

function clampTitle(t, max = 120) {
  const s = String(t || "").trim();
  if (!s) return "";
  return s.slice(0, max);
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // env
    const missing = [];
    if (!process.env.POSTGRES_URL) missing.push("POSTGRES_URL");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (missing.length)
      return res
        .status(400)
        .json({ ok: false, error: "Missing env vars", missing });

    // auth
    const token = getBearerToken(req);
    if (!token)
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const user = await getUserFromSupabase(token);
    const userId = user.id;
    const email = user.email || null;

    // tables exist?
    const hasBalancesTable = await tableExists("public.user_balances");
    const hasProfilesTable = await tableExists("public.user_profiles");
    const hasPromoTable = await tableExists("public.promo_redemptions");
    const hasGenerationsTable = await tableExists("public.generations");
    const hasProjectsTable = await tableExists("public.cinema_projects");

    // --- NEW Library tables ---
    const hasLibraryProjectsTable = await tableExists("public.library_projects");
    const hasLibraryScenesTable = await tableExists("public.library_scenes");
    const hasLibrarySceneAssetsTable = await tableExists(
      "public.library_scene_assets"
    );

    // ensure balances row
    let credits = 0;
    if (hasBalancesTable) {
      await pool.query(
        `insert into public.user_balances (user_id, credits)
         values ($1::uuid, 0)
         on conflict (user_id) do nothing`,
        [userId]
      );

      const bal = await pool.query(
        `select credits from public.user_balances where user_id = $1::uuid limit 1`,
        [userId]
      );
      credits = Number(bal.rows?.[0]?.credits ?? 0);
    }

    // ===== POST actions (multi-action endpoint) =====
    if (req.method === "POST") {
      const body = await readJsonBody(req);

      // backward compatible: old clients send {action:"redeem_promo"}
      const action = String(body.action || body.op || "").trim();

      // ---- 1) redeem promo (existing behavior) ----
      if (action === "redeem_promo") {
        if (!hasPromoTable || !hasBalancesTable) {
          return res
            .status(500)
            .json({
              ok: false,
              error: "Promo is not configured (missing tables)",
            });
        }

        const code = String(body.code || "").trim();
        if (!code)
          return res.status(400).json({ ok: false, error: "code is required" });

        const SECRET = String(process.env.PROMO_SECRET_CODE || "").trim();
        const AMOUNT = Number(process.env.PROMO_CREDITS || "10");

        if (!SECRET)
          return res
            .status(500)
            .json({
              ok: false,
              error: "Server misconfigured (PROMO_SECRET_CODE)",
            });
        if (code !== SECRET)
          return res.status(400).json({ ok: false, error: "Invalid promo code" });

        const client = await pool.connect();
        try {
          await client.query("begin");

          await client.query(
            `insert into public.promo_redemptions(user_id, code, credits_added)
             values ($1::uuid, $2::text, $3::int)`,
            [userId, code, AMOUNT]
          );

          const { rows } = await client.query(
            `update public.user_balances
             set credits = credits + $2::int, updated_at = now()
             where user_id = $1::uuid
             returning credits`,
            [userId, AMOUNT]
          );

          await client.query("commit");

          return res.status(200).json({
            ok: true,
            user: { id: userId, email },
            added: AMOUNT,
            credits: Number(rows?.[0]?.credits ?? 0),
          });
        } catch (e) {
          await client.query("rollback");
          if (String(e.code) === "23505") {
            return res.status(409).json({ ok: false, error: "Promo already redeemed" });
          }
          return res.status(500).json({ ok: false, error: e?.message || "Server error" });
        } finally {
          client.release();
        }
      }

      // ---- 2) set generation title (characters/shots) ----
      if (action === "set_generation_title") {
        if (!hasGenerationsTable) {
          return res.status(500).json({ ok: false, error: "Generations table missing" });
        }

        const generation_id = body.generation_id ?? body.id ?? null;
        const title = clampTitle(body.title, 120);

        if (generation_id === null || generation_id === undefined) {
          return res.status(400).json({ ok: false, error: "generation_id is required" });
        }

        // allow id as number OR string numeric
        const genIdNum = Number(generation_id);
        if (!Number.isFinite(genIdNum)) {
          return res.status(400).json({ ok: false, error: "generation_id must be a number" });
        }

        // Update only own generation
        try {
          const r = await pool.query(
            `
            update public.generations
            set title = $3::text
            where user_id = $1::uuid and id = $2::bigint
            returning id, title
            `,
            [userId, genIdNum, title]
          );

          if (!r.rows?.length) {
            return res.status(404).json({ ok: false, error: "Generation not found" });
          }

          return res.status(200).json({ ok: true, generation: r.rows[0] });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e?.message || "Server error" });
        }
      }

      // ---- 2.x) delete generation (hard delete) ----
      // NOTE: This is safe because it deletes only by (user_id, id).
      // Optional cleanup removes any library_scene_assets referencing this generation_id.
      if (action === "delete_generation") {
        if (!hasGenerationsTable) {
          return res.status(500).json({ ok: false, error: "Generations table missing" });
        }

        const generation_id = body.generation_id ?? body.id ?? null;
        if (generation_id === null || generation_id === undefined) {
          return res.status(400).json({ ok: false, error: "generation_id is required" });
        }

        const genIdNum = Number(generation_id);
        if (!Number.isFinite(genIdNum)) {
          return res.status(400).json({ ok: false, error: "generation_id must be a number" });
        }

        const client = await pool.connect();
        try {
          await client.query("begin");

          // Cleanup: remove assets in cinema library that reference this generation
          if (hasLibrarySceneAssetsTable) {
            await client.query(
              `delete from public.library_scene_assets
               where user_id=$1::uuid and generation_id=$2::bigint`,
              [userId, genIdNum]
            );
          }

          const r = await client.query(
            `delete from public.generations
             where user_id=$1::uuid and id=$2::bigint
             returning id`,
            [userId, genIdNum]
          );

          if (!r.rows?.length) {
            await client.query("rollback");
            return res.status(404).json({ ok: false, error: "Generation not found" });
          }

          await client.query("commit");
          return res.status(200).json({ ok: true, deleted: true, id: r.rows[0].id });
        } catch (e) {
          try { await client.query("rollback"); } catch {}
          return res.status(500).json({ ok: false, error: e?.message || "Server error" });
        } finally {
          client.release();
        }
      }

      // ---- 3) upsert cinema project (save / rename) ----
      if (action === "upsert_project") {
        if (!hasProjectsTable) {
          return res
            .status(500)
            .json({ ok: false, error: "Projects table missing (public.cinema_projects)" });
        }

        const project_id_raw = body.project_id ?? body.id ?? null;
        const title = clampTitle(body.title, 120);
        const data = body.data && typeof body.data === "object" ? body.data : {};

        if (!title) return res.status(400).json({ ok: false, error: "title is required" });

        // If project_id provided -> update, else create
        const project_id = project_id_raw && isUuid(project_id_raw) ? String(project_id_raw) : null;

        const client = await pool.connect();
        try {
          await client.query("begin");

          if (!project_id) {
            const ins = await client.query(
              `
              insert into public.cinema_projects (user_id, title, data, created_at, updated_at)
              values ($1::uuid, $2::text, $3::jsonb, now(), now())
              returning id, title, updated_at
              `,
              [userId, title, JSON.stringify(data)]
            );
            await client.query("commit");
            return res.status(200).json({ ok: true, project: ins.rows[0], created: true });
          } else {
            const upd = await client.query(
              `
              update public.cinema_projects
              set title = $3::text,
                  data = $4::jsonb,
                  updated_at = now()
              where user_id = $1::uuid and id = $2::uuid
              returning id, title, updated_at
              `,
              [userId, project_id, title, JSON.stringify(data)]
            );

            if (!upd.rows?.length) {
              await client.query("rollback");
              return res.status(404).json({ ok: false, error: "Project not found" });
            }

            await client.query("commit");
            return res.status(200).json({ ok: true, project: upd.rows[0], created: false });
          }
        } catch (e) {
          try { await client.query("rollback"); } catch {}
          return res.status(500).json({ ok: false, error: e?.message || "Server error" });
        } finally {
          client.release();
        }
      }

      // ==========================================
      // NEW LIBRARY ACTIONS (2.1 - 2.10)
      // ==========================================

      // 2.1 list projects
      if (action === "library_list_projects") {
        if (!hasLibraryProjectsTable)
          return res.status(500).json({ ok: false, error: "library_projects missing" });

        const r = await pool.query(
          `select id, title, created_at, updated_at
           from public.library_projects
           where user_id = $1::uuid
           order by updated_at desc, created_at desc
           limit 500`,
          [userId]
        );

        return res.status(200).json({ ok: true, projects: r.rows || [] });
      }

      // 2.2 create project
      if (action === "library_create_project") {
        if (!hasLibraryProjectsTable)
          return res.status(500).json({ ok: false, error: "library_projects missing" });

        const title = String(body.title || "").trim().slice(0, 120);
        if (!title) return res.status(400).json({ ok: false, error: "title is required" });

        const r = await pool.query(
          `insert into public.library_projects (user_id, title, created_at, updated_at)
           values ($1::uuid, $2::text, now(), now())
           returning id, title, created_at, updated_at`,
          [userId, title]
        );

        return res.status(200).json({ ok: true, project: r.rows[0] });
      }

      // 2.3 rename project
      if (action === "library_rename_project") {
        if (!hasLibraryProjectsTable)
          return res.status(500).json({ ok: false, error: "library_projects missing" });

        const project_id = String(body.project_id || "").trim();
        const title = String(body.title || "").trim().slice(0, 120);
        if (!project_id) return res.status(400).json({ ok: false, error: "project_id required" });
        if (!title) return res.status(400).json({ ok: false, error: "title required" });

        const r = await pool.query(
          `update public.library_projects
           set title=$3::text, updated_at=now()
           where user_id=$1::uuid and id=$2::uuid
           returning id, title, updated_at`,
          [userId, project_id, title]
        );

        if (!r.rows?.length) return res.status(404).json({ ok: false, error: "Project not found" });
        return res.status(200).json({ ok: true, project: r.rows[0] });
      }

      // 2.4 list scenes (by project)
      if (action === "library_list_scenes") {
        if (!hasLibraryScenesTable)
          return res.status(500).json({ ok: false, error: "library_scenes missing" });

        const project_id = String(body.project_id || "").trim();
        if (!project_id) return res.status(400).json({ ok: false, error: "project_id required" });

        const r = await pool.query(
          `select id, project_id, title, created_at, updated_at
           from public.library_scenes
           where user_id=$1::uuid and project_id=$2::uuid
           order by updated_at desc, created_at desc
           limit 500`,
          [userId, project_id]
        );

        return res.status(200).json({ ok: true, scenes: r.rows || [] });
      }

      // 2.5 create scene
      if (action === "library_create_scene") {
        if (!hasLibraryScenesTable)
          return res.status(500).json({ ok: false, error: "library_scenes missing" });

        const project_id = String(body.project_id || "").trim();
        const title = String(body.title || "").trim().slice(0, 120);
        if (!project_id) return res.status(400).json({ ok: false, error: "project_id required" });
        if (!title) return res.status(400).json({ ok: false, error: "title required" });

        const r = await pool.query(
          `insert into public.library_scenes (user_id, project_id, title, created_at, updated_at)
           values ($1::uuid, $2::uuid, $3::text, now(), now())
           returning id, project_id, title, created_at, updated_at`,
          [userId, project_id, title]
        );

        // bump project updated_at
        await pool.query(
          `update public.library_projects set updated_at=now()
           where user_id=$1::uuid and id=$2::uuid`,
          [userId, project_id]
        );

        return res.status(200).json({ ok: true, scene: r.rows[0] });
      }

      // 2.6 rename scene
      if (action === "library_rename_scene") {
        if (!hasLibraryScenesTable)
          return res.status(500).json({ ok: false, error: "library_scenes missing" });

        const scene_id = String(body.scene_id || "").trim();
        const title = String(body.title || "").trim().slice(0, 120);
        if (!scene_id) return res.status(400).json({ ok: false, error: "scene_id required" });
        if (!title) return res.status(400).json({ ok: false, error: "title required" });

        const r = await pool.query(
          `update public.library_scenes
           set title=$3::text, updated_at=now()
           where user_id=$1::uuid and id=$2::uuid
           returning id, project_id, title, updated_at`,
          [userId, scene_id, title]
        );

        if (!r.rows?.length) return res.status(404).json({ ok: false, error: "Scene not found" });

        // bump project updated_at
        await pool.query(
          `update public.library_projects set updated_at=now()
           where user_id=$1::uuid and id=$2::uuid`,
          [userId, r.rows[0].project_id]
        );

        return res.status(200).json({ ok: true, scene: r.rows[0] });
      }

      // 2.7 list assets (by scene)
      if (action === "library_list_assets") {
        if (!hasLibrarySceneAssetsTable)
          return res.status(500).json({ ok: false, error: "library_scene_assets missing" });

        const scene_id = String(body.scene_id || "").trim();
        if (!scene_id) return res.status(400).json({ ok: false, error: "scene_id required" });

        const r = await pool.query(
          `select id, scene_id, generation_id, title, kind, url, thumb_url, created_at
           from public.library_scene_assets
           where user_id=$1::uuid and scene_id=$2::uuid
           order by created_at desc
           limit 1000`,
          [userId, scene_id]
        );

        return res.status(200).json({ ok: true, assets: r.rows || [] });
      }

      // 2.8 add asset to scene
      if (action === "library_add_asset") {
        if (!hasLibrarySceneAssetsTable)
          return res.status(500).json({ ok: false, error: "library_scene_assets missing" });

        const scene_id = String(body.scene_id || "").trim();
        const url = String(body.url || "").trim();
        const thumb_url = String(body.thumb_url || "").trim() || null;
        const title = String(body.title || "").trim().slice(0, 120) || null;
        const kind = String(body.kind || "").trim().slice(0, 32) || null;
        const generation_id_raw = body.generation_id ?? null;
        const generation_id =
          generation_id_raw === null || generation_id_raw === undefined
            ? null
            : Number(generation_id_raw);

        if (!scene_id) return res.status(400).json({ ok: false, error: "scene_id required" });
        if (!url) return res.status(400).json({ ok: false, error: "url required" });

        const r = await pool.query(
          `insert into public.library_scene_assets
            (user_id, scene_id, generation_id, title, kind, url, thumb_url, created_at)
           values
            ($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text, now())
           returning id, scene_id, generation_id, title, kind, url, thumb_url, created_at`,
          [
            userId,
            scene_id,
            Number.isFinite(generation_id) ? generation_id : null,
            title,
            kind,
            url,
            thumb_url,
          ]
        );

        // bump scene updated_at
        await pool.query(
          `update public.library_scenes set updated_at=now()
           where user_id=$1::uuid and id=$2::uuid`,
          [userId, scene_id]
        );

        return res.status(200).json({ ok: true, asset: r.rows[0] });
      }

      // 2.9 rename asset
      if (action === "library_rename_asset") {
        if (!hasLibrarySceneAssetsTable)
          return res.status(500).json({ ok: false, error: "library_scene_assets missing" });

        const asset_id = String(body.asset_id || "").trim();
        const title = String(body.title || "").trim().slice(0, 120);
        if (!asset_id) return res.status(400).json({ ok: false, error: "asset_id required" });
        if (!title) return res.status(400).json({ ok: false, error: "title required" });

        const r = await pool.query(
          `update public.library_scene_assets
           set title=$3::text
           where user_id=$1::uuid and id=$2::uuid
           returning id, scene_id, title`,
          [userId, asset_id, title]
        );

        if (!r.rows?.length) return res.status(404).json({ ok: false, error: "Asset not found" });
        return res.status(200).json({ ok: true, asset: r.rows[0] });
      }

      // 2.10 delete asset
      if (action === "library_delete_asset") {
        if (!hasLibrarySceneAssetsTable)
          return res.status(500).json({ ok: false, error: "library_scene_assets missing" });

        const asset_id = String(body.asset_id || "").trim();
        if (!asset_id) return res.status(400).json({ ok: false, error: "asset_id required" });

        const r = await pool.query(
          `delete from public.library_scene_assets
           where user_id=$1::uuid and id=$2::uuid
           returning id, scene_id`,
          [userId, asset_id]
        );

        if (!r.rows?.length) return res.status(404).json({ ok: false, error: "Asset not found" });

        // bump scene updated_at
        await pool.query(
          `update public.library_scenes set updated_at=now()
           where user_id=$1::uuid and id=$2::uuid`,
          [userId, r.rows[0].scene_id]
        );

        return res.status(200).json({ ok: true, deleted: true });
      }

      return res.status(400).json({ ok: false, error: "Unknown action" });
    }

    // ===== GET (existing + new query modes) =====
    // profiles flag
    let has_password = false;
    if (hasProfilesTable) {
      await pool.query(
        `insert into public.user_profiles (user_id)
         values ($1::uuid)
         on conflict (user_id) do nothing`,
        [userId]
      );
      const p = await pool.query(
        `select has_password from public.user_profiles where user_id = $1::uuid limit 1`,
        [userId]
      );
      has_password = !!p.rows?.[0]?.has_password;
    }

    const pg = parsePagination(req);
    const { limit, offset, fullUrl } = pg;

    // ---- NEW: projects list ----
    const wantsProjects = fullUrl.searchParams.get("projects") === "1";
    const projectIdParam = String(fullUrl.searchParams.get("project_id") || "").trim();

    if (wantsProjects) {
      if (!hasProjectsTable) {
        return res
          .status(500)
          .json({ ok: false, error: "Projects table missing (public.cinema_projects)" });
      }

      const r = await pool.query(
        `
        select id, title, updated_at, created_at
        from public.cinema_projects
        where user_id = $1::uuid
        order by updated_at desc, created_at desc
        limit 200
        `,
        [userId]
      );

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        credits,
        has_password,
        projects: r.rows || [],
      });
    }

    // ---- NEW: open project by id ----
    if (projectIdParam) {
      if (!hasProjectsTable) {
        return res
          .status(500)
          .json({ ok: false, error: "Projects table missing (public.cinema_projects)" });
      }
      if (!isUuid(projectIdParam)) {
        return res.status(400).json({ ok: false, error: "Bad project_id" });
      }

      const r = await pool.query(
        `
        select id, title, data, updated_at, created_at
        from public.cinema_projects
        where user_id = $1::uuid and id = $2::uuid
        limit 1
        `,
        [userId, projectIdParam]
      );

      if (!r.rows?.length) return res.status(404).json({ ok: false, error: "Project not found" });

      return res.status(200).json({
        ok: true,
        user: { id: userId, email },
        credits,
        has_password,
        project: r.rows[0],
      });
    }

    // ---- Existing: generations with pagination ----
    let generations = [];
    let total_generations = 0;

    if (hasGenerationsTable) {
      const countRes = await pool.query(
        `select count(*)::int as c
         from public.generations
         where user_id = $1::uuid`,
        [userId]
      );
      total_generations = Number(countRes.rows?.[0]?.c ?? 0);

      try {
        const gens = await pool.query(
          `
          select
            id,
            status,
            output_url,
            created_at,
            lab,
            kind,
            title
          from public.generations
          where user_id = $1::uuid
          order by created_at desc nulls last, id desc
          limit $2 offset $3
          `,
          [userId, limit, offset]
        );
        generations = gens.rows || [];
      } catch (e) {
        // fallback for older schemas
        const gens = await pool.query(
          `
          select
            id,
            status,
            output_url,
            created_at
          from public.generations
          where user_id = $1::uuid
          order by created_at desc nulls last, id desc
          limit $2 offset $3
          `,
          [userId, limit, offset]
        );
        generations = gens.rows || [];
      }
    }

    return res.status(200).json({
      ok: true,
      user: { id: userId, email },
      credits,
      has_password,
      generations,
      total_generations,
      limit,
      offset,
      debug: {
        hasBalancesTable,
        hasProfilesTable,
        hasPromoTable,
        hasGenerationsTable,
        hasProjectsTable,
        hasLibraryProjectsTable,
        hasLibraryScenesTable,
        hasLibrarySceneAssetsTable,
      },
    });
  } catch (e) {
    console.error("me.js error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "Internal error", details: String(e?.message || e) });
  }
}
