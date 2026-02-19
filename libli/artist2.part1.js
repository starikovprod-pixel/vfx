(() => {
  const root = window;
  const existing = root.__LF_ARTIST__ || {};
  if(existing.__booted) return;

  const S = root.__LF_ARTIST__ = existing;

  S.READ_BACKEND = "https://api.lightfull.ai";
  S.WRITE_BACKEND = "https://ai-vfx-backend.vercel.app";
  S.DEFAULT_PROFILE_COVER = "https://fs.getcourse.ru/fileservice/file/download/a/384380/sc/439/h/fdef161860d4b1a6fbfd9ce6813dcd8b.png";
  S.PAGE_SIZE = 24;
  S.VERIFIED_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 2.1 3.3-.2.8 3.2 2.7 1.9-1.3 3 1.3 3-2.7 1.9-.8 3.2-3.3-.2L12 22l-2.6-2.1-3.3.2-.8-3.2-2.7-1.9 1.3-3-1.3-3 2.7-1.9.8-3.2 3.3.2L12 2zm-1.1 13.4l6-6-1.4-1.4-4.6 4.6-2.4-2.4-1.4 1.4 3.8 3.8z"/></svg>';
  S.VFY_TOOLTIP = "Verified — awarded at 100 followers. Helps ranking in Feed.";
  S.LS_FOLLOW = "lf_follow_cache_v1";

  S.$ = (id) => document.getElementById(id);

  S.qs = function qs(name){ const u = new URL(location.href); return u.searchParams.get(name) || ""; };
  S.escapeHtml = function escapeHtml(s){
    return String(s||"")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  };
  S.fmtDate = function fmtDate(ts){ return String(ts||"").replace("T"," ").slice(0,16); };
  S.isVideoUrl = function isVideoUrl(url){
    const u = String(url||"").toLowerCase();
    return u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".mov") || u.includes("fal.media");
  };
  S.verifiedBadgeHTML = function verifiedBadgeHTML(v){ return v ? `<span class="vfy" data-tip="verified">${S.VERIFIED_SVG}</span>` : ""; };

  S.getSessionToken = async function getSessionToken(){
    try{ if(!window.sb) return null; const { data } = await window.sb.auth.getSession(); return data?.session?.access_token || null; }
    catch(e){ return null; }
  };
  S.getCurrentUserId = async function getCurrentUserId(){
    try{ if(!window.sb) return null; const { data } = await window.sb.auth.getUser(); return data?.user?.id || null; }
    catch(e){ return null; }
  };
  S.requireToken = async function requireToken(){ const t = await S.getSessionToken(); if(!t) throw new Error("Login required"); return t; };

  S.api = async function api(path, opts={}){
    const method = (opts.method || "GET").toUpperCase();
    const token = await S.getSessionToken();
    if(method === "GET"){
      const r = await fetch(S.READ_BACKEND + path, Object.assign({}, opts, { method:"GET", signal: opts.signal }));
      const j = await r.json().catch(()=> ({}));
      if(!r.ok) throw new Error(j?.error || j?.details || ("HTTP " + r.status));
      return j;
    }
    let bodyObj = {};
    if (opts.body) { try { bodyObj = JSON.parse(opts.body); } catch(e) { bodyObj = {}; } }
    const payload = { ...bodyObj, access_token: token };
    const r = await fetch(S.WRITE_BACKEND + path, {
      method,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: opts.signal
    });
    const j = await r.json().catch(()=> ({}));
    if(!r.ok) throw new Error(j?.error || j?.details || ("HTTP " + r.status));
    return j;
  };

  S.getFollowCache = function getFollowCache(){
    try { return JSON.parse(localStorage.getItem(S.LS_FOLLOW) || "{}"); } catch(e){ return {}; }
  };
  S.setFollowCache = function setFollowCache(m){ localStorage.setItem(S.LS_FOLLOW, JSON.stringify(m)); };
  S.cacheSet = function cacheSet(userId, val){ const m = S.getFollowCache(); m[String(userId)] = !!val; S.setFollowCache(m); };
  S.cacheGet = function cacheGet(userId){ const m = S.getFollowCache(); return m[String(userId)] === true; };
  S.cacheHas = function cacheHas(userId){ const m = S.getFollowCache(); return Object.prototype.hasOwnProperty.call(m, String(userId)); };

  S.state = {
    $grid: null,
    username: "",
    profile: null,
    myProfile: null,
    myUserId: null,
    isOwnProfile: false,
    followState: false,
    tab: "posts",
    sort: "new",
    range: "newest",
    tabState: {
      posts: { offset:0, loading:false, hasMore:true, loadedOnce:false },
      collections: { offset:0, loading:false, hasMore:true, loadedOnce:false },
      library: { offset:0, loading:false, hasMore:true, loadedOnce:false }
    },
    isSwitching: false,
    activeAbort: null,
    libraryItems: [],
    postItems: [],
    collectionItems: [],
    currentWork: null,
    liked: false,
    saved: false,
    currentCol: null,
    colReorderMode: false,
    sceneReorderMode: false,
    colOriginalOrderIds: [],
    sceneOriginalOrderIds: [],
    dragFromIndex: null,
    editingSceneId: null,
    fsCollectionId: null,
    editingPostId: null,
    postDraftMedia: [],
    editingColId: null,
    colDraftMedia: [],
    colDraftCover: null,
    mvItems: [],
    mvIndex: 0,
    mvOnChange: null,
    pickMode: null,
    pickSelectedId: null,
    pickSelectedSet: new Set(),
    pickResolve: null,
    postCommentsMode: new Map(),
    replyToByPost: new Map(),
    emoTargetInput: null
  };

  S.__booted = true;
})();
