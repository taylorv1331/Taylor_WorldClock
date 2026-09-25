const $ = (id) => document.getElementById(id);
const groupsEl = $("groups");
const searchInput = $("search");
const searchResults = $("search-results");

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let added = new Set(store.get("added", [])); // id của các thành phố người dùng đã bấm "Thêm"
let query = "";
let searchOpen = false;

const byId = new Map(CITIES.map((c) => [c.id, c]));
const TYPE_LABEL = { capital: "Thủ đô", financial: "Trung tâm tài chính" };

// ---------- Định dạng thời gian ----------
const fmtCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat("vi-VN", { timeZone: tz, ...opts }));
  return fmtCache.get(key);
}

function parts(tz, now) {
  const p = Object.fromEntries(fmt(tz, {
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { h: +p.hour, m: +p.minute, s: +p.second, y: +p.year, mo: +p.month, d: +p.day };
}

function offsetMinutes(tz, now) {
  const p = parts(tz, now);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m, p.s);
  return Math.round((asUtc - Math.floor(now / 1000) * 1000) / 60000);
}

function offsetLabel(min) {
  const sign = min >= 0 ? "+" : "-";
  const a = Math.abs(min);
  const h = Math.floor(a / 60), m = a % 60;
  return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

function diffLabel(diffMin) {
  if (diffMin === 0) return "Cùng giờ với bạn";
  const a = Math.abs(diffMin);
  const h = Math.floor(a / 60), m = a % 60;
  const txt = `${h ? h + " giờ" : ""}${h && m ? " " : ""}${m ? m + " phút" : ""}`;
  return `${txt} ${diffMin > 0 ? "nhanh hơn" : "chậm hơn"} bạn`;
}

// đêm: từ 18:00 đến trước 6:00 sáng hôm sau
function isNight(hour) { return hour >= 18 || hour < 6; }

function norm(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------- Mặt đồng hồ kim (SVG) ----------
const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
function clockSvg() {
  let ticks = "", nums = "";
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const a = (i * 6 * Math.PI) / 180;
    const r1 = major ? 80 : 86, r2 = 91;
    ticks += `<line class="${major ? "tick major" : "tick"}" x1="${(Math.sin(a) * r1).toFixed(2)}" y1="${(-Math.cos(a) * r1).toFixed(2)}" x2="${(Math.sin(a) * r2).toFixed(2)}" y2="${(-Math.cos(a) * r2).toFixed(2)}"/>`;
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    nums += `<text class="num" x="${(Math.sin(a) * 66).toFixed(2)}" y="${(-Math.cos(a) * 66).toFixed(2)}">${ROMAN[i]}</text>`;
  }
  return `
  <svg class="dial" viewBox="-100 -100 200 200" role="img">
    <circle class="bezel" r="98"/>
    <circle class="bezel-inner" r="94"/>
    <circle class="face" r="92"/>
    <circle class="ring" r="76"/>
    ${ticks}${nums}
    <g class="hand hour"><line x1="0" y1="8" x2="0" y2="-44"/></g>
    <g class="hand minute"><line x1="0" y1="12" x2="0" y2="-66"/></g>
    <g class="hand second"><line x1="0" y1="16" x2="0" y2="-74"/><circle cy="-58" r="3"/></g>
    <circle class="pivot" r="4.5"/>
    <circle class="pivot-dot" r="1.6"/>
  </svg>`;
}

// ---------- Xây khung nhóm theo châu lục ----------
const cardIndex = new Map(); // id -> { el, tz, hour, minute, second, svg }

function cityCardHtml(city, removable) {
  return `
    <article class="card" data-id="${city.id}">
      ${removable ? `<button class="remove" type="button" aria-label="Bỏ ${city.name}">×</button>` : ""}
      ${clockSvg()}
      <h3>${city.name}</h3>
      <p class="country">${city.country}</p>
      <p class="date"></p>
      <p class="meta"><span class="icon"></span><span class="off"></span></p>
    </article>`;
}

function buildGroups() {
  groupsEl.innerHTML = "";
  cardIndex.clear();

  for (const cont of CONTINENTS) {
    const cities = CITIES.filter((c) => c.continent === cont.key);
    const featured = cities.filter((c) => c.featured);
    const addedCities = cities.filter((c) => !c.featured && added.has(c.id));

    const section = document.createElement("section");
    section.className = "continent";
    section.dataset.key = cont.key;
    section.innerHTML = `
      <h2 class="continent-title"><span class="c-icon">${cont.icon}</span>${cont.label}</h2>
      <div class="grid">
        ${featured.map((c) => cityCardHtml(c, false)).join("")}
        ${addedCities.map((c) => cityCardHtml(c, true)).join("")}
      </div>`;
    groupsEl.appendChild(section);

    section.querySelectorAll(".card").forEach((el) => {
      const city = byId.get(el.dataset.id);
      cardIndex.set(city.id, {
        el, tz: city.tz,
        hour: el.querySelector(".hour"), minute: el.querySelector(".minute"), second: el.querySelector(".second"),
        svg: el.querySelector(".dial"),
      });
      const rm = el.querySelector(".remove");
      if (rm) rm.addEventListener("click", () => {
        added.delete(city.id);
        store.set("added", [...added]);
        buildGroups();
        renderCards();
        renderSearch();
      });
    });
  }
}

function renderCards() {
  const now = new Date();
  const myOffset = offsetMinutes(localTz, now);

  for (const [id, c] of cardIndex) {
    const city = byId.get(id);
    const p = parts(c.tz, now);
    const off = offsetMinutes(c.tz, now);
    c.hour.setAttribute("transform", `rotate(${((p.h % 12) + p.m / 60) * 30})`);
    c.minute.setAttribute("transform", `rotate(${(p.m + p.s / 60) * 6})`);
    c.second.setAttribute("transform", `rotate(${p.s * 6})`);
    c.svg.setAttribute("aria-label", `${city.name}: ${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}`);

    c.el.querySelector(".date").textContent = fmt(c.tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
    const night = isNight(p.h);
    c.el.classList.toggle("night", night);
    c.el.querySelector(".icon").textContent = night ? "🌙" : "🎃";
    c.el.querySelector(".off").textContent = `${offsetLabel(off)} · ${diffLabel(off - myOffset)}`;
  }

  $("local-info").textContent = `Múi giờ của bạn: ${localTz} (${offsetLabel(myOffset)}) — ${fmt(localTz, { timeStyle: "medium", hourCycle: "h23" }).format(now)}`;
}

// ---------- Tìm kiếm & thêm cố định ----------
function renderSearch() {
  const q = norm(query.trim());
  if (!searchOpen || !q) { searchResults.hidden = true; searchResults.innerHTML = ""; return; }

  const now = new Date();
  const matches = CITIES.filter((c) => norm(c.name).includes(q) || norm(c.country).includes(q)).slice(0, 30);

  if (!matches.length) {
    searchResults.hidden = false;
    searchResults.innerHTML = `<p class="no-match">Không tìm thấy thành phố nào.</p>`;
    return;
  }

  searchResults.hidden = false;
  searchResults.innerHTML = matches.map((c) => {
    const p = parts(c.tz, now);
    const timeText = `${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}`;
    const contLabel = CONTINENTS.find((k) => k.key === c.continent)?.label ?? "";
    const already = c.featured || added.has(c.id);
    return `
      <div class="result-row" data-id="${c.id}">
        <div class="r-info">
          <span class="r-name">${c.name}</span>
          <span class="r-meta">${c.country} · ${TYPE_LABEL[c.type]} · ${contLabel}</span>
        </div>
        <span class="r-time">${timeText}</span>
        ${already
          ? `<span class="r-added">✓ Đã hiển thị</span>`
          : `<button class="r-add" type="button" data-id="${c.id}">+ Thêm</button>`}
      </div>`;
  }).join("");

  searchResults.querySelectorAll(".r-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      added.add(btn.dataset.id);
      store.set("added", [...added]);
      buildGroups();
      renderCards();
      renderSearch();
    });
  });
}

searchInput.addEventListener("input", (e) => { query = e.target.value; searchOpen = true; renderSearch(); });
searchInput.addEventListener("focus", () => { if (query.trim()) { searchOpen = true; renderSearch(); } });
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { query = ""; searchInput.value = ""; searchOpen = false; renderSearch(); searchInput.blur(); }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) { searchOpen = false; renderSearch(); }
});

// ---------- Khởi động ----------
buildGroups();
renderCards();
// căn theo đầu giây để kim giây không bị lệch
setTimeout(function tick() {
  renderCards();
  if (searchOpen && query.trim()) renderSearch();
  setTimeout(tick, 1000 - (Date.now() % 1000));
}, 1000 - (Date.now() % 1000));
