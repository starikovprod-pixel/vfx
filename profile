<style>
  #lf-profile *{ box-sizing:border-box; }
  #lf-profile{
    background:var(--bg-body,#050505);
    color:#fff;
    font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    min-height: calc(100vh - 74px);
  }
  #lf-profile .wrap{ max-width: 980px; margin:0 auto; padding: 26px 18px 50px; }
  #lf-profile .top{
    display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;
    border-bottom:1px solid rgba(255,255,255,0.10); padding-bottom:18px; margin-bottom:18px;
  }
  #lf-profile h1{ margin:0; font-size:34px; font-weight:900; letter-spacing:-.6px; }
  #lf-profile .sub{ margin-top:6px; color:rgba(255,255,255,0.55); font-size:13px; }

  .card{
    background: rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.10);
    border-radius: 18px;
    padding: 18px;
  }

  .grid{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap:14px;
  }
  @media(max-width: 860px){ .grid{ grid-template-columns:1fr; } }

  .field{ display:flex; flex-direction:column; gap:8px; }
  .label{ font-size:12px; font-weight:900; color:rgba(255,255,255,0.70); letter-spacing:.2px; }

  .input, .textarea{
    width:100%;
    border-radius: 14px;
    padding: 12px 12px;
    background: rgba(255,255,255,0.05);
    border:1px solid rgba(255,255,255,0.12);
    color:#fff;
    font-size:14px;
  }
  .input:focus, .textarea:focus{ border-color: rgba(255,255,255,0.25); }
  .textarea{ min-height: 110px; resize: vertical; }

  .preview{ display:flex; gap:14px; align-items:center; margin-bottom:14px; }
  .avatar{
    width:56px; height:56px; border-radius:50%;
    background: rgba(255,255,255,0.08);
    border:1px solid rgba(255,255,255,0.12);
    overflow:hidden;
    flex:0 0 auto;
  }
  .avatar img{ width:100%; height:100%; object-fit:cover; display:block; }

  /* Emoji avatar */
  .avatar.emoji{
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:30px;
    line-height:1;
    user-select:none;
  }

  .pname{ font-weight:900; font-size:16px; }
  .puser{ color:rgba(255,255,255,0.55); font-size:13px; margin-top:2px; }

  .actions{ display:flex; gap:10px; align-items:center; }
  .statusTop{ min-width:70px; text-align:right; color: rgba(255,255,255,0.6); font-size:12px; font-weight:700; }
  .iconbtn{
    height:42px;
    padding: 0 14px;
    border-radius: 14px;
    border:1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color:#fff;
    cursor:pointer;
    display:flex;
    align-items:center;
    gap:10px;
    font-weight:900;
    transition:.15s;
  }
  .iconbtn:hover{ background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22); }
  .iconbtn.primary{ background:#fff; color:#000; border:none; }
  .iconbtn.primary:hover{ background:#ddd; }
  .iconbtn svg{ width:16px; height:16px; display:block; opacity:.95; }
  .iconbtn.onlyIcon{ width:42px; padding:0; justify-content:center; }

  .uploadRow{ display:flex; gap:10px; align-items:center; }
  .fileHidden{ display:none; }
  .uploadBtn{
    flex:0 0 auto;
    height:38px;
    padding: 0 12px;
    border-radius: 999px;
    border:1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color:#fff;
    cursor:pointer;
    display:flex;
    align-items:center;
    gap:8px;
    font-weight:900;
    transition:.15s;
  }
  .uploadBtn:hover{ background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22); }
  .uploadMeta{ color: rgba(255,255,255,0.55); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }

  .linksRow{ display:flex; gap:8px; flex-wrap:wrap; min-height:38px; align-items:center; }
  .chip{
    display:inline-flex;
    align-items:center;
    gap:8px;
    height:34px;
    border-radius:999px;
    border:1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.06);
    padding:0 10px;
    color:#fff;
    font-size:12px;
    font-weight:700;
  }
  .chip a{ color:#fff; text-decoration:none; opacity:.9; }
  .chip a:hover{ opacity:1; text-decoration:underline; }

  .icon-btn{
    width:32px;
    height:32px;
    border-radius:50%;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.12);
    cursor:pointer;
    transition:0.15s;
    color:#fff;
  }
  .icon-btn:hover{ background: rgba(255,255,255,0.12); }
  .icon-btn svg{ width:16px; height:16px; }
  .icon-btn.add-link{
    width:auto;
    border-radius:999px;
    padding:0 10px;
    gap:6px;
    font-weight:800;
  }

  .lf-pop{
    position:fixed;
    inset:0;
    display:none;
    align-items:center;
    justify-content:center;
    background:rgba(0,0,0,0.55);
    backdrop-filter:blur(8px);
    z-index:99;
    padding:16px;
  }
  .lf-pop.open{ display:flex; }
  .lf-pop-card{
    width:min(460px, 100%);
    border-radius:20px;
    border:1px solid rgba(255,255,255,0.12);
    background:#0d0d0f;
    box-shadow:0 20px 80px rgba(0,0,0,0.5);
    padding:18px;
  }
  .seg{ display:flex; gap:8px; margin-bottom:12px; }
  .segBtn{
    flex:1;
    height:36px;
    border-radius:12px;
    border:1px solid rgba(255,255,255,0.14);
    background:rgba(255,255,255,0.06);
    color:#fff;
    cursor:pointer;
    font-weight:800;
  }
  .segBtn.active{ background:#fff; color:#000; border-color:transparent; }
  .popActions{ margin-top:14px; display:flex; justify-content:flex-end; gap:8px; }

  .status{
    margin-top:12px;
    padding: 10px 12px;
    border-radius: 14px;
    border:1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.25);
    font-size:13px;
    color: rgba(255,255,255,0.78);
    display:none;
  }
  .status.err{ border-color: rgba(255,70,90,0.35); color:#ff98a2; background: rgba(255,70,90,0.08); }
  .status.ok{ border-color: rgba(57,255,20,0.25); color:#b7ffb0; background: rgba(57,255,20,0.08); }

  /* Emoji picker UI */
  .emojiTopRow{ display:flex; gap:10px; align-items:center; margin-top:6px; }
  .emojiSearch{ flex:1; }
  .emojiGrid{
    display:grid;
    grid-template-columns: repeat(8, 1fr);
    gap:8px;
    margin-top:10px;
    max-height: 280px;
    overflow:auto;
    padding-right:4px;
  }
  @media(max-width:420px){ .emojiGrid{ grid-template-columns: repeat(7, 1fr);} }
  .emojiBtn{
    width:44px; height:44px;
    border-radius:14px;
    border:1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color:#fff;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:22px;
    transition:.15s;
  }
  .emojiBtn:hover{ background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22); }
</style>

<div id="lf-profile">
  <div class="wrap">
    <div class="top">
      <div>
        <h1>Profile</h1>
        <div class="sub">Username, avatar, links.</div>
      </div>

      <div class="actions">
        <div class="statusTop" id="status-top"></div>
        <button class="iconbtn onlyIcon" id="btn-open-public" style="display:none;" title="Open public profile" aria-label="Open public profile">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M14 3h7v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M10 14L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M21 14v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <button class="iconbtn primary" id="btn-save" title="Save">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 21h14a2 2 0 0 0 2-2V8l-3-3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M7 21v-8h10v8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M7 5v4h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Save
        </button>
      </div>
    </div>

    <div class="card">
      <div class="preview">
        <div class="avatar" id="pv-avatar"></div>
        <div>
          <div class="pname" id="pv-name">—</div>
          <div class="puser" id="pv-user">@—</div>
        </div>
      </div>

      <div class="grid">
        <div class="field">
          <div class="label">Username</div>
          <input class="input" id="f-username" placeholder="starikov" autocomplete="off" />
        </div>

        <div class="field">
          <div class="label">Display name</div>
          <input class="input" id="f-display" placeholder="Alex Starikov" />
        </div>

        <div class="field">
          <div class="label">Avatar</div>
          <div class="uploadRow">
            <input class="fileHidden" type="file" id="f-avatar-file" accept="image/*" />
            <button class="uploadBtn" id="btn-pick-avatar" type="button">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 5v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M7 10l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              Upload
            </button>

            <button class="uploadBtn" id="btn-pick-emoji" type="button" title="Choose emoji avatar">
              Emoji
            </button>

            <div class="uploadMeta" id="avatar-meta">JPG/PNG/WebP • max 5MB</div>
          </div>
        </div>

        <div class="field">
          <div class="label">Links</div>
          <div class="linksRow" id="linksRow"></div>
        </div>
      </div>

      <div class="field" style="margin-top:14px;">
        <div class="label">Bio</div>
        <textarea class="textarea" id="f-bio" placeholder="VFX / 3D / Lightfull"></textarea>
      </div>

      <div class="status" id="status"></div>
    </div>
  </div>

  <div class="lf-pop" id="linkPop">
    <div class="lf-pop-card">
      <div class="label" style="margin-bottom:8px;">Link type</div>
      <div class="seg">
        <button class="segBtn" id="linkTypeYoutube" type="button">YouTube</button>
        <button class="segBtn" id="linkTypeSite" type="button">Website</button>
      </div>
      <div class="field">
        <div class="label">URL</div>
        <input class="input" id="linkUrlInput" placeholder="https://..." />
      </div>
      <div class="popActions">
        <button class="iconbtn" id="linkCancel" type="button">Cancel</button>
        <button class="iconbtn primary" id="linkSave" type="button">Save</button>
      </div>
    </div>
  </div>

  <!-- Avatar picker -->
  <div class="lf-pop" id="avatarPop">
    <div class="lf-pop-card">
      <div class="label" style="margin-bottom:8px;">Avatar</div>

      <div class="seg">
        <button class="segBtn" id="avTabImage" type="button">Image</button>
        <button class="segBtn" id="avTabEmoji" type="button">Emoji</button>
      </div>

      <div id="avPanelImage" style="display:none;">
        <div class="sub" style="margin:-4px 0 10px; opacity:.75;">
          Upload an image (JPG/PNG/WebP).
        </div>
        <button class="iconbtn" id="avUploadFromPop" type="button">Upload image</button>
      </div>

      <div id="avPanelEmoji" style="display:none;">
        <div class="emojiTopRow">
          <input class="input emojiSearch" id="emojiSearch" placeholder="Search (smile, fire, cat, cinema...)" />
          <button class="iconbtn onlyIcon" id="emojiClear" type="button" title="Clear" aria-label="Clear avatar">✕</button>
        </div>
        <div class="emojiGrid" id="emojiGrid"></div>
      </div>

      <div class="popActions">
        <button class="iconbtn" id="avCancel" type="button">Close</button>
      </div>
    </div>
  </div>
</div>

<script>
(() => {
  const BACKEND = "https://api.lightfull.ai";
  const ENDPOINT = "/api/profile_public";

  const $status = document.getElementById("status");
  const $statusTop = document.getElementById("status-top");
  const $btnSave = document.getElementById("btn-save");
  const $btnOpenPublic = document.getElementById("btn-open-public");

  const $u = document.getElementById("f-username");
  const $d = document.getElementById("f-display");
  const $b = document.getElementById("f-bio");
  const $linksRow = document.getElementById("linksRow");

  const $pvAvatar = document.getElementById("pv-avatar");
  const $pvName = document.getElementById("pv-name");
  const $pvUser = document.getElementById("pv-user");

  const $avatarFile = document.getElementById("f-avatar-file");
  const $btnPickAvatar = document.getElementById("btn-pick-avatar");
  const $btnPickEmoji = document.getElementById("btn-pick-emoji");
  const $emojiBtnIcon = document.getElementById("emojiBtnIcon");
if($emojiBtnIcon) $emojiBtnIcon.textContent = String.fromCodePoint(0x1F604); // ????
  const $avatarMeta = document.getElementById("avatar-meta");

  const $linkPop = document.getElementById("linkPop");
  const $linkUrlInput = document.getElementById("linkUrlInput");
  const $linkTypeYoutube = document.getElementById("linkTypeYoutube");
  const $linkTypeSite = document.getElementById("linkTypeSite");
  const $linkCancel = document.getElementById("linkCancel");
  const $linkSave = document.getElementById("linkSave");

  // avatar pop
  const $avatarPop = document.getElementById("avatarPop");
  const $avTabImage = document.getElementById("avTabImage");
  const $avTabEmoji = document.getElementById("avTabEmoji");
  const $avPanelImage = document.getElementById("avPanelImage");
  const $avPanelEmoji = document.getElementById("avPanelEmoji");
  const $avUploadFromPop = document.getElementById("avUploadFromPop");
  const $avCancel = document.getElementById("avCancel");
  const $emojiGrid = document.getElementById("emojiGrid");
  const $emojiSearch = document.getElementById("emojiSearch");
  const $emojiClear = document.getElementById("emojiClear");

  // State (NEW backend fields)
  let avatarType = "image";     // "image" | "emoji"
  let avatarUrl = "";          // image url
  let avatarEmoji = null;      // "????"
  let links = { youtube:"", site:"" };

  let autosaveTimer = null;
  let saveAbort = null;
  let saving = false;
  let dirty = false;
  let lastSavedHash = "";

  let linkPopType = "youtube";
  let avatarPopTab = "emoji";

  const ICONS = {
    edit: `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
    `,
    trash: `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14H6L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4h6v2"/>
      </svg>
    `,
    plus: `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    `,
    youtube: `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="#ff0000">
        <path d="M23.5 6.2s-.2-1.6-.9-2.3c-.8-.9-1.7-.9-2.1-1C17.4 2.6 12 2.6 12 2.6h0s-5.4 0-8.5.3c-.4 0-1.3 0-2.1 1C.7 4.6.5 6.2.5 6.2S.3 8 .3 9.8v1.6C.3 13.2.5 15 .5 15s.2 1.6.9 2.3c.8.9 1.9.9 2.4 1C5.7 18.6 12 18.6 12 18.6s5.4 0 8.5-.3c.4 0 1.3 0 2.1-1 .7-.7.9-2.3.9-2.3s.2-1.8.2-3.6V9.8c0-1.8-.2-3.6-.2-3.6zM9.8 14.7V7.9l6.2 3.4-6.2 3.4z"/>
      </svg>
    `
  };

  const EMOJI_CPS = [
  0x1F600,0x1F604,0x1F601,0x1F60E,0x1F913,0x1F978,0x1F607,0x1F642,0x1F609,0x1F60D,0x1F618,0x1F929,0x1F624,0x1F608,0x1F47B,0x1F916,
  0x1F525,0x26A1,0x1F48E,0x2728,0x1F319,0x2B50,0x2600,0x1F308,0x2601,0x2744,0x1F480,0x1F9E0,0x1F441,0x1F3AC,0x1F3A5,0x1F39E,
  0x1F3AE,0x1F579,0x1F3A8,0x1F58C,0x1F9E9,0x1F3A7,0x1F3B5,0x1F977,0x1F98A,0x1F431,0x1F436,0x1F43C,0x1F984,0x1F438,0x1F435,0x1F989,
  0x1F33F,0x2618,0x1F344,0x1F30A,0x1F3DD,0x1F3D4,0x1F3D9,0x1F680,0x1F6F8,0x1F6F0,0x1F9EA,0x2699,0x1F9F0,0x1F527,0x1F52E,0x1F4CC,
  0x2764,0x1F5A4,0x1F499,0x1F49C,0x1F90D,0x1F49B,0x1F49A,0x1F4A5,0x1F4AB,0x1FAE7,0x1F9FF,0x1F3C6,0x1F4BC,0x1F4F7,0x1F4A1,0x1F9CA
];

const EMOJIS = EMOJI_CPS.map(cp => String.fromCodePoint(cp));


  const EMOJI_KEYWORDS = {
    "????":"smile happy", "????":"smile happy", "????":"smile happy",
    "????":"cool", "????":"robot ai", "????":"fire hot", "⚡️":"lightning energy",
    "????":"cinema film", "????":"camera", "????️":"film", "????":"art", "????":"brain",
    "????":"diamond", "????":"moon night", "????":"cat", "????":"rocket", "????":"ufo", "????️":"beach"
  };

  function escapeHtml(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function showStatus(msg, type){
    $status.style.display = msg ? "block" : "none";
    $status.className = "status" + (type ? (" " + type) : "");
    $status.textContent = msg || "";
  }

  function showTopStatus(msg){
    $statusTop.textContent = msg || "";
  }

  function renderAvatar(el){
    el.classList.remove("emoji");
    el.innerHTML = "";

    if(avatarType === "emoji" && avatarEmoji){
      el.classList.add("emoji");
      el.innerHTML = `<span aria-label="avatar emoji">${escapeHtml(avatarEmoji)}</span>`;
      return;
    }

    const url = (avatarUrl || "").trim();
    if(url){
      el.innerHTML = `<img src="${url}" alt="avatar">`;
    }
  }

  function updatePreview(){
    const username = ($u.value || "").trim();
    const display = ($d.value || "").trim();

    $pvName.textContent = display || "—";
    $pvUser.textContent = username ? ("@" + username) : "@—";
    renderAvatar($pvAvatar);

    $btnOpenPublic.style.display = username ? "inline-flex" : "none";

    // meta hint
    if(avatarType === "emoji" && avatarEmoji){
      $avatarMeta.textContent = `Emoji avatar: ${avatarEmoji}`;
    } else if ((avatarUrl || "").trim()){
      $avatarMeta.textContent = "Image avatar set";
    } else {
      $avatarMeta.textContent = "JPG/PNG/WebP • max 5MB";
    }
  }

  function safeDomain(url){
    try{ return new URL(url).hostname.replace(/^www\./, ""); }
    catch(_){ return url; }
  }

  function renderLinkChip(type, url){
    const chip = document.createElement("div");
    chip.className = "chip";

    const iconWrap = document.createElement("span");
    if(type === "youtube") iconWrap.innerHTML = ICONS.youtube;
    else iconWrap.textContent = "????";

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${safeDomain(url)}`;

    const edit = document.createElement("button");
    edit.className = "icon-btn";
    edit.type = "button";
    edit.innerHTML = ICONS.edit;
    edit.title = "Edit";
    edit.onclick = () => openLinkPop(type, url);

    const remove = document.createElement("button");
    remove.className = "icon-btn danger";
    remove.type = "button";
    remove.innerHTML = ICONS.trash;
    remove.title = "Remove";
    remove.onclick = () => {
      links[type] = "";
      renderLinksRow();
      scheduleAutosave();
    };

    chip.append(iconWrap, link, edit, remove);
    return chip;
  }

  function renderLinksRow(){
    $linksRow.innerHTML = "";

    if(links.youtube) $linksRow.appendChild(renderLinkChip("youtube", links.youtube));
    if(links.site) $linksRow.appendChild(renderLinkChip("site", links.site));

    if(!links.youtube || !links.site){
      const addBtn = document.createElement("button");
      addBtn.className = "icon-btn add-link";
      addBtn.type = "button";
      addBtn.innerHTML = `${ICONS.plus}<span>Add</span>`;
      addBtn.onclick = () => openLinkPop(!links.youtube ? "youtube" : "site", "");
      $linksRow.appendChild(addBtn);
    }
  }

  function selectLinkType(type){
    linkPopType = type;
    $linkTypeYoutube.classList.toggle("active", type === "youtube");
    $linkTypeSite.classList.toggle("active", type === "site");
  }

  function openLinkPop(type, existingUrl){
    selectLinkType(type || "youtube");
    $linkUrlInput.value = existingUrl || links[linkPopType] || "";
    $linkPop.classList.add("open");
    setTimeout(() => $linkUrlInput.focus(), 0);
  }

  function closeLinkPop(){
    $linkPop.classList.remove("open");
  }

  function saveLinkPop(){
    const value = ($linkUrlInput.value || "").trim();
    if(!value){
      showStatus("URL is required", "err");
      return;
    }
    links[linkPopType] = value;
    renderLinksRow();
    closeLinkPop();
    scheduleAutosave();
  }

  function selectAvatarTab(tab){
    avatarPopTab = tab;
    const isEmoji = tab === "emoji";
    $avTabEmoji.classList.toggle("active", isEmoji);
    $avTabImage.classList.toggle("active", !isEmoji);
    $avPanelEmoji.style.display = isEmoji ? "block" : "none";
    $avPanelImage.style.display = !isEmoji ? "block" : "none";
    if(isEmoji){
      renderEmojiGrid(($emojiSearch.value || "").trim().toLowerCase());
    }
  }

  function openAvatarPop(tab){
    $avatarPop.classList.add("open");
    selectAvatarTab(tab || "emoji");
    setTimeout(() => {
      if(avatarPopTab === "emoji") $emojiSearch?.focus();
    }, 0);
  }

  function closeAvatarPop(){
    $avatarPop.classList.remove("open");
  }

  function renderEmojiGrid(q){
    $emojiGrid.innerHTML = "";
    const query = (q || "").trim();

    const list = EMOJIS.filter(em => {
      if(!query) return true;
      const kw = (EMOJI_KEYWORDS[em] || "");
      return kw.includes(query) || em.includes(query);
    });

    list.forEach(em => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emojiBtn";
      btn.textContent = em;
      btn.onclick = () => {
        avatarType = "emoji";
        avatarEmoji = em;
        updatePreview();
        scheduleAutosave();
        closeAvatarPop();
      };
      $emojiGrid.appendChild(btn);
    });

    if(!list.length){
      const empty = document.createElement("div");
      empty.className = "sub";
      empty.style.marginTop = "10px";
      empty.textContent = "No results. Try: smile, fire, cat, cinema...";
      $emojiGrid.appendChild(empty);
    }
  }

  async function getAccessToken(){
    if(!window.sb) return null;
    const { data } = await window.sb.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function api(method, body, signal){
    const token = await getAccessToken();
    if(!token) throw new Error("Login required");
    const res = await fetch(BACKEND + ENDPOINT, {
      method,
      headers: {
        "Content-Type":"application/json",
        "Authorization":"Bearer " + token
      },
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
    const j = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(j?.error || j?.details || ("HTTP " + res.status));
    return j;
  }

  function buildBody(){
    return {
      username: ($u.value || "").trim(),
      display_name: ($d.value || "").trim(),
      avatar_type: avatarType,
      avatar_url: avatarType === "image" ? (avatarUrl || "") : null,
      avatar_emoji: avatarType === "emoji" ? (avatarEmoji || null) : null,
      bio: ($b.value || "").trim(),
      links
    };
  }

  function payloadHash(obj){
    return JSON.stringify(obj);
  }

  function scheduleAutosave(){
    dirty = true;
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveProfile({ silent:true }), 900);
  }

  async function saveProfile({ silent=false } = {}){
    if(saving && silent) return;
    if(!dirty && silent) return;

    const body = buildBody();
    const h = payloadHash(body);
    if(silent && h === lastSavedHash){
      dirty = false;
      return;
    }

    if(saveAbort) saveAbort.abort();
    saveAbort = new AbortController();

    saving = true;
    $btnSave.disabled = true;
    if(!silent) showTopStatus("Saving…");
    if(!silent) showStatus("Saving...", "");

    try{
      const j = await api("POST", body, saveAbort.signal);
      const p = j?.profile;

      $u.value = p?.username ?? body.username;
      $d.value = p?.display_name ?? body.display_name;

      // NEW fields
      avatarType = p?.avatar_type || body.avatar_type || "image";
      avatarUrl = p?.avatar_url ?? (body.avatar_url || "");
      avatarEmoji = p?.avatar_emoji ?? (body.avatar_emoji || null);

      $b.value = p?.bio ?? body.bio;
      links = p?.links || body.links || { youtube:"", site:"" };

      lastSavedHash = h;
      dirty = false;
      updatePreview();
      renderLinksRow();
      showTopStatus("Saved");
      if(!silent){
        showStatus("Saved", "ok");
        setTimeout(()=> showStatus("", ""), 900);
      } else {
        setTimeout(()=> showTopStatus(""), 600);
      }

    }catch(e){
      const msg = String(e?.name || "") + " " + String(e?.message || "");
      if (e?.name === "AbortError" || msg.toLowerCase().includes("aborted")) {
        return;
      }
      showTopStatus("Save failed");
      showStatus(e.message, "err");
    }finally{
      saving = false;
      saveAbort = null;
      $btnSave.disabled = false;
    }
  }

  async function uploadAvatar(){
    if(!window.sb) throw new Error("Supabase not found");

    const { data } = await window.sb.auth.getSession();
    const userId = data?.session?.user?.id;
    if(!userId) throw new Error("Login required");

    const file = $avatarFile.files?.[0];
    if(!file) return;

    if(file.size > 5 * 1024 * 1024) throw new Error("Max 5MB");

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const safeExt = ["png","jpg","jpeg","webp"].includes(ext) ? ext : "png";
    const path = `${userId}/avatar.${safeExt}`;

    const up = await window.sb.storage
      .from("avatars")
      .upload(path, file, { upsert:true, contentType:file.type, cacheControl:"3600" });

    if(up.error) throw new Error(up.error.message);

    const { data: pub } = window.sb.storage.from("avatars").getPublicUrl(path);
    if(!pub?.publicUrl) throw new Error("No public URL");

    // switch to image mode
    avatarType = "image";
    avatarEmoji = null;
    avatarUrl = pub.publicUrl;

    updatePreview();
    scheduleAutosave();
  }

  async function load(){
    try{
      showStatus("Loading…", "");
      showTopStatus("");
      const j = await api("GET");
      const p = j?.profile || null;

      $u.value = p?.username || "";
      $d.value = p?.display_name || "";

      avatarType = p?.avatar_type || "image";
      avatarUrl = p?.avatar_url || "";
      avatarEmoji = p?.avatar_emoji || null;

      $b.value = p?.bio || "";
      links = p?.links || { youtube:"", site:"" };

      lastSavedHash = payloadHash(buildBody());
      dirty = false;
      updatePreview();
      renderLinksRow();
      showStatus("", "");
    }catch(e){
      showStatus(e.message, "err");
    }
  }

  // Save button
  $btnSave.onclick = () => saveProfile({ silent:false });

  // Inputs
  $u.addEventListener("input", updatePreview);
  $u.addEventListener("blur", scheduleAutosave);

  [$d,$b].forEach(el => {
    el.addEventListener("input", () => {
      updatePreview();
      scheduleAutosave();
    });
  });

  // Upload button
  $btnPickAvatar.onclick = () => $avatarFile.click();

  $avatarFile.addEventListener("change", async () => {
    const file = $avatarFile.files?.[0];
    $avatarMeta.textContent = file ? (file.name + " • Uploading…") : "JPG/PNG/WebP • max 5MB";
    try{
      await uploadAvatar();
      $avatarMeta.textContent = file ? `${file.name} • Uploaded` : "Uploaded";
    }catch(e){
      $avatarMeta.textContent = "Upload failed";
      showStatus(e.message, "err");
    }
  });

  // Emoji picker button
  $btnPickEmoji.onclick = () => openAvatarPop("emoji");

  // Avatar pop events
  $avTabImage.onclick = () => selectAvatarTab("image");
  $avTabEmoji.onclick = () => selectAvatarTab("emoji");
  $avUploadFromPop.onclick = () => { closeAvatarPop(); $avatarFile.click(); };
  $avCancel.onclick = closeAvatarPop;

  $avatarPop.addEventListener("click", (e) => {
    if(e.target === $avatarPop) closeAvatarPop();
  });

  $emojiSearch.addEventListener("input", () => {
    renderEmojiGrid(($emojiSearch.value || "").trim().toLowerCase());
  });

  $emojiClear.onclick = () => {
    avatarType = "image";
    avatarEmoji = null;
    avatarUrl = "";
    updatePreview();
    scheduleAutosave();
    closeAvatarPop();
  };

  // Open public
  $btnOpenPublic.onclick = () => {
    const username = ($u.value || "").trim();
    if(!username) return;
    window.open("/artist?username=" + encodeURIComponent(username), "_blank");
  };

  // Links pop
  $linkTypeYoutube.onclick = () => selectLinkType("youtube");
  $linkTypeSite.onclick = () => selectLinkType("site");
  $linkCancel.onclick = closeLinkPop;
  $linkSave.onclick = saveLinkPop;
  $linkPop.addEventListener("click", (e) => {
    if(e.target === $linkPop) closeLinkPop();
  });

  load();
})();
</script>
