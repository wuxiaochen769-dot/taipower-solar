/* 台電太陽能即時發電｜GitHub Pages 前端
 * 即時資料：config.js 的 LIVE_URL（Google Apps Script ?view=live）；未設定時使用 data/sample-live.json
 */
(function () {
  "use strict";
  const CFG = window.SOLAR_CONFIG || {};
  // 開發者檢視：網址加 ?dev=1 才顯示「資料一致性」等檢核內容（一般民眾看不到；不是密碼保護）
  // 開過一次 ?dev=1 後，這台電腦的這個瀏覽器會記住（之後用一般網址也是開發者檢視）；?dev=0 取消
  const DEV = (() => {
    const q = new URLSearchParams(location.search).get("dev");
    try {
      if (q === "1") localStorage.setItem("solarDev", "1");
      if (q === "0") localStorage.removeItem("solarDev");
      return q === "1" || (q !== "0" && localStorage.getItem("solarDev") === "1");
    } catch (e) { return q === "1"; }
  })();
  document.documentElement.classList.toggle("dev", DEV);
  const LIVE_UNITS = ["彰濱光", "南鹽光"]; // 可一對一對應到發電站的機組
  const GROUPS = [
    { key: "purEst", name: "小型案場（其它購電太陽能，估算）", color: "var(--s-est)" },
    { key: "purSite", name: "大型案場（購電個別機組）", color: "var(--s-site)" },
    { key: "own", name: "台電自有", color: "var(--s-own)" },
  ];
  const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const $ = (id) => document.getElementById(id);
  const tip = $("tip");

  function showTip(evt, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8)); y = Math.max(8, y); // 不超出畫面（手機）
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const shortStatus = (s) => (s ? s.replace("新增設備測試運轉", "測試運轉") : "");
  const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;

  let sites = null, topo = null;

  async function loadLive() {
    const url = CFG.LIVE_URL ? CFG.LIVE_URL + (CFG.LIVE_URL.includes("?") ? "&" : "?") + "view=live&_=" + Date.now() : "sample-live.json";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    if (!CFG.LIVE_URL) j.sample = true;
    return j;
  }

  async function init() {
    [sites, topo] = await Promise.all([
      fetch("sites.json").then((r) => r.json()),
      fetch("taiwan-counties.json").then((r) => r.json()),
    ]);
    await refresh();
    setInterval(refresh, (CFG.REFRESH_MINUTES || 5) * 60000);
    refreshStats();
    setInterval(refreshStats, 30 * 60000);
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (last) renderAll(last); if (stats) renderStats(stats); }, 200); });
  }

  let last = null;
  async function refresh() {
    try { last = await loadLive(); renderAll(last); }
    catch (e) {
      $("banner").hidden = false;
      $("banner").textContent = "即時資料讀取失敗（" + e.message + "），稍後會自動重試。";
      if (last) renderAll(last);
    }
  }

  function renderAll(d) {
    const own = d.units.filter((u) => u.category === "台電自有");
    const pur = d.units.filter((u) => u.category === "購電");
    const big = pur.filter((u) => u.name !== "其它購電太陽能"), small = pur.filter((u) => u.name === "其它購電太陽能");
    const sum = (a) => a.reduce((s, u) => s + (u.net || 0), 0);
    renderHeader(d);
    renderKpis(d, sum(own), sum(big), sum(small));
    renderShare(d, sum(own), sum(big), sum(small));
    renderMap(d);
    renderPurchased(pur);
    renderArea(d.series);
    renderConsistency(d);
    renderTable("ownTable", own, false);
    renderTable("purTable", big, true);
    renderTable("smallTable", small, true);
  }

  function renderHeader(d) {
    $("dataTime").textContent = `資料時間 ${d.date} ${d.time || "–"}（台電）・本頁更新於 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    const msgs = [];
    if (d.sample) msgs.push("目前顯示的是示範資料（2026-10-14）。部署 Apps Script 後，在 config.js 填入 LIVE_URL 即可改為即時資料。");
    else if (d.time) {
      const t = new Date(`${d.date}T${d.time}:00+08:00`), lag = (Date.now() - t) / 60000;
      const hm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
      if (lag > (CFG.STALE_MINUTES || 40) && hm >= "06:40" && hm <= "18:30") msgs.push(`台電資料已 ${Math.round(lag)} 分鐘未更新，可能是台電端延遲。`);
      if (hm < "06:00" || hm > "18:30") msgs.push("目前為觀測時段外（06:00–18:00），顯示最近一個時段的資料。");
    }
    $("banner").hidden = !msgs.length;
    $("banner").textContent = msgs.join(" ");
  }

  function renderKpis(d, ownMW, bigMW, smallMW) {
    const c = d.consistency || {};
    const pct = c.n ? (c.match / c.n) * 100 : null;
    const k = (lbl, val, unit, sw) => `<div class="kpi"><div class="lbl">${sw ? `<span class="sw" style="background:${sw}"></span>` : ""}${lbl}</div><div class="val">${val}<small>${unit}</small></div></div>`;
    const ser = d.series || [];
    const peak = ser.reduce((m, s) => (s.sub > (m ? m.sub : -1) ? s : m), null);
    $("kpis").innerHTML =
      k("全台即時發電功率", fmt(d.subtotal), "MW").replace('class="kpi"', 'class="kpi wide"') +
      (DEV ? k("資料一致性（今日，開發者檢視）", pct == null ? "–" : fmt(pct, pct === 100 ? 0 : 1), "%") : "") +
      k(`今日尖峰發電功率${peak ? "（" + peak.t + "）" : ""}`, peak ? fmt(peak.sub) : "–", "MW").replace('class="kpi"', DEV ? 'class="kpi"' : 'class="kpi wide"') +
      [k("台電自有", fmt(ownMW), "MW", "var(--s-own)"), k("大型案場", fmt(bigMW), "MW", "var(--s-site)"),
        k('小型案場<span class="lbl-note">估算</span>', fmt(smallMW), "MW", "var(--s-est)")].map((s) => s.replace('class="kpi"', 'class="kpi third"')).join("");
  }

  // ───── 三類案場合計與占比 ─────
  function renderShare(d, ownMW, bigMW, smallMW) {
    const total = ownMW + bigMW + smallMW;
    const parts = [
      { name: "台電自有", v: ownMW, c: "var(--s-own)" },
      { name: "大型案場（購電個別機組）", v: bigMW, c: "var(--s-site)" },
      { name: "小型案場（其它購電太陽能，估算）", v: smallMW, c: "var(--s-est)" },
    ];
    const pct = (v) => (total > 0 ? (v / total) * 100 : null);
    $("shareTime").textContent = d.time ? `（${d.date} ${d.time}）` : "";
    const rowsHtml = parts.map((p) => `<tr><td><i class="sw" style="background:${p.c}"></i>${p.name}</td><td class="n">${fmt(p.v)}</td><td class="n">${pct(p.v) == null ? "–" : fmt(pct(p.v)) + "%"}</td></tr>`).join("");
    $("shareTable").innerHTML = `<thead><tr><th>類別</th><th class="n">發電功率 (MW)</th><th class="n">占比</th></tr></thead><tbody>${rowsHtml}</tbody>` +
      `<tfoot><tr><td><b>合計</b></td><td class="n"><b>${fmt(total)}</b></td><td class="n"><b>100%</b></td></tr></tfoot>`;
  }

  // ───── 地圖 ─────
  // ───── 大型案場位置（2026-11-10 示意）：只列公開資料可核對者；地圖以「縣市」統整 ─────
  // 值＝[縣市, 鄉鎮]；經緯度為鄉鎮公所附近（概略），縣市標記放在該縣市案場的平均位置
  const PUR_SITE = {
    志光光: ["臺南市", "七股區", 120.1374, 23.1407], 天衝光: ["臺南市", "七股區", 120.1374, 23.1407], 天篷光: ["臺南市", "七股區", 120.1374, 23.1407],
    星崴光: ["臺南市", "七股區", 120.1374, 23.1407], 新和光: ["臺南市", "將軍區", 120.1569, 23.1993],
    崙尾光: ["彰化縣", "鹿港鎮", 120.4353, 24.0566], 星崙光: ["彰化縣", "鹿港鎮", 120.4353, 24.0566], 永堯光: ["彰化縣", "大城鄉", 120.3207, 23.8527],
    生利光: ["屏東縣", "枋寮鄉", 120.5934, 22.3668], 寶興光: ["屏東縣", "枋寮鄉", 120.5934, 22.3668],
    碩力光: ["雲林縣", "臺西鄉", 120.1960, 23.7020], 向陽光: ["嘉義縣", "義竹鄉", 120.2428, 23.3362],
  };
  const LAYERS = [["own", "台電自有"], ["pur", "大型案場"], ["all", "全部"]];
  let mapLayer = "own";
  try { mapLayer = localStorage.getItem("mapLayer") || "own"; } catch (e) {}
  let lastMapData = null;

  function renderMap(d) {
    lastMapData = d;
    const svg = d3.select("#map");
    const W = svg.node().clientWidth || 600, H = Math.round(W * 1.18);
    svg.attr("viewBox", `0 0 ${W} ${H}`).selectAll("*").remove();
    const counties = topojson.feature(topo, topo.objects.counties).features;
    const isOuter = (f) => /金門|連江/.test(f.properties.COUNTYNAME);
    const main = counties.filter((f) => !isOuter(f));
    const proj = d3.geoMercator().fitExtent([[W * 0.22, 10], [W - 10, H - 10]], { type: "FeatureCollection", features: main });
    const path = d3.geoPath(proj);
    svg.append("g").selectAll("path").data(main).join("path").attr("class", "land").attr("d", path);

    // 金門、馬祖小圖
    const insets = [
      { name: "連江縣（馬祖）", test: /連江/, box: [8, 10, W * 0.18, H * 0.16] },
      { name: "金門縣", test: /金門/, box: [8, H * 0.16 + 22, W * 0.18, H * 0.14] },
    ];
    const projs = [{ proj, test: null }];
    insets.forEach((ins) => {
      const feats = counties.filter((f) => ins.test.test(f.properties.COUNTYNAME));
      const [x, y, w, h] = ins.box;
      const p = d3.geoMercator().fitExtent([[x + 6, y + 18], [x + w - 6, y + h - 6]], { type: "FeatureCollection", features: feats });
      const g = svg.append("g");
      g.append("rect").attr("class", "inset-box").attr("x", x).attr("y", y).attr("width", w).attr("height", h).attr("rx", 6);
      g.append("text").attr("class", "inset-lbl").attr("x", x + 6).attr("y", y + 13).text(ins.name);
      g.selectAll("path").data(feats).join("path").attr("class", "land").attr("d", d3.geoPath(p));
      projs.push({ proj: p, test: ins.test });
    });

    const unitNet = Object.fromEntries(d.units.map((u) => [u.name, u.net]));
    const otherOwn = unitNet["其它台電自有"];
    const pos = (county, lon, lat) => {
      const pj = projs.find((p) => p.test && p.test.test(county)) || projs[0];
      return pj.proj([lon, lat]);
    };
    const showOwn = mapLayer !== "pur", showPur = mapLayer !== "own";

    // 台電自有與大型案場統一格式（2026-11-10）：每個縣市一個圓，數字＝站／場數，大小只在小範圍內變化
    // 台電自有：大小依 2024 場址資料裝置容量；大型案場：大小依即時發電功率
    const ownC = d3.groups(sites.stations, (s) => s.county).map(([c, ss]) => ({
      kind: "own", c, items: ss.slice().sort((a, b) => b.capacityKW - a.capacityKW), size: d3.sum(ss, (s) => s.capacityKW) / 1000,
      live: ss.filter((s) => LIVE_UNITS.includes(s.unit)),
      at: pos(c, d3.mean(ss, (s) => s.lon), d3.mean(ss, (s) => s.lat)),
    }));
    const purC = d3.groups(d.units.filter((u) => PUR_SITE[u.name]), (u) => PUR_SITE[u.name][0]).map(([c, us]) => ({
      kind: "pur", c, items: us.slice().sort((a, b) => (b.net || 0) - (a.net || 0)), size: d3.sum(us, (u) => u.net || 0),
      at: pos(c, d3.mean(us, (u) => PUR_SITE[u.name][2]), d3.mean(us, (u) => PUR_SITE[u.name][3])),
    }));
    const rOwn = d3.scaleSqrt().domain([0, d3.max(ownC, (t) => t.size) || 1]).range([9, 13]);
    const rPur = d3.scaleSqrt().domain([0, d3.max(purC, (t) => t.size) || 1]).range([9, 13]);
    const nodes = [].concat(showOwn ? ownC : [], showPur ? purC : []);
    nodes.forEach((t) => { t.r = t.kind === "own" ? rOwn(t.size) : rPur(t.size); t.x = t.at[0]; t.y = t.at[1]; });
    // 標記互相重疊時自動推開（固定次數計算，結果每次相同），偏移較大者以細線指回原位置
    const sim = d3.forceSimulation(nodes).force("x", d3.forceX((t) => t.at[0]).strength(0.4)).force("y", d3.forceY((t) => t.at[1]).strength(0.4))
      .force("collide", d3.forceCollide((t) => t.r + 2).iterations(3)).stop();
    for (let i = 0; i < 160; i++) sim.tick();

    const mg = svg.append("g");
    mg.selectAll("line").data(nodes.filter((t) => Math.hypot(t.x - t.at[0], t.y - t.at[1]) > t.r * 0.6)).join("line").attr("class", (t) => "lead " + t.kind)
      .attr("x1", (t) => t.at[0]).attr("y1", (t) => t.at[1]).attr("x2", (t) => t.x).attr("y2", (t) => t.y);
    // 發電站名稱：地點名稱與「太陽光電發電站」中間分隔，地點名稱加粗、後綴淡色
    // 三欄：地點名稱｜太陽光電發電站（鄉鎮）｜數值；中間欄獨立一欄、上下對齊
    const stnCells = (s) => { const m = s.name.match(/^(.*?)(太陽光電發電站)$/);
      return m ? `<span class="stn">${m[1]}</span><span class="stn-sfx">${m[2]}（${s.town}）</span>` : `<span class="stn">${s.name}</span><span class="stn-sfx">（${s.town}）</span>`; };
    const stnName = (s) => { const m = s.name.match(/^(.*?)(太陽光電發電站)$/);
      return m ? `<span class="stn">${m[1]}</span><span class="stn-sfx">${m[2]}</span>（${s.town}）` : `${s.name}（${s.town}）`; };
    const tipHtml = (t) => {
      if (t.kind === "pur") return `<b>大型案場｜${t.c}（${t.items.length} 場）</b>` +
        t.items.map((u) => row(`${u.name}（${PUR_SITE[u.name][1]}）`, fmt(u.net) + " MW")).join("") +
        row("合計", fmt(t.size) + " MW") + `<div class="tip-foot">數值為即時發電功率；位置以縣市統整（概略）</div>`;
      const live = t.live.map((s) => row(`${s.unit} 即時發電功率`, fmt(unitNet[s.unit]) + " MW")).join("");
      const hasOther = t.items.some((s) => !LIVE_UNITS.includes(s.unit));
      const abbr = [/E\/S/.test(t.items.map((s) => s.name).join()) ? "E/S＝超高壓變電所" : "", /D\/S/.test(t.items.map((s) => s.name).join()) ? "D/S＝配電變電所" : ""].filter(Boolean).join("、");
      return `<b>台電自有｜${t.c}（${t.items.length} 站）</b>` +
        `<div class="stn-grid">` + t.items.map((s) => stnCells(s) + `<span class="v">${fmt(s.capacityKW / 1000, 2)} MW</span>`).join("") + `</div>` +
        row("合計", fmt(t.size, 2) + " MW") + (live ? `<div class="tip-sep"></div>${live}` : "") +
        `<div class="tip-foot">數值為 2024 場址資料裝置容量；位置以縣市統整（概略）` +
        (hasOther ? `<br>其餘發電站的發電功率含在「其它台電自有」<span style="white-space:nowrap">（全台合計 ${fmt(otherOwn)} MW）</span>` : "") +
        (abbr ? `<br>${abbr}` : "") + `</div>`;
    };
    const mk = mg.selectAll("g.mk").data(nodes).join("g").attr("class", (t) => "mk " + t.kind).attr("transform", (t) => `translate(${t.x},${t.y})`)
      .on("mousemove", (evt, t) => showTip(evt, tipHtml(t))).on("mouseleave", hideTip);
    mk.append("circle").attr("r", (t) => t.r);
    mk.append("text").attr("class", "mk-n").attr("y", 4).text((t) => t.items.length);
    // 標籤：只在單一圖層時顯示即時發電功率（台電自有僅彰濱光、南鹽光有個別數值）
    const lbls = mapLayer === "pur" ? purC.map((t) => ({ t, s: `${t.c.slice(0, 2)} ${fmt(t.size)} MW` }))
      : mapLayer === "own" ? ownC.filter((t) => t.live.length).map((t) => ({ t, s: t.live.map((s) => `${s.unit} ${fmt(unitNet[s.unit])} MW`).join("、") })) : [];
    let lastY = -1e9;
    lbls.sort((a, b) => a.t.y - b.t.y).forEach((l) => { l.y = Math.max(l.t.y + 4, lastY + 17); lastY = l.y; });
    mg.selectAll("text.dot-lbl").data(lbls).join("text").attr("class", "dot-lbl").attr("x", (l) => l.t.x + l.t.r + 5).attr("y", (l) => l.y).text((l) => l.s);

    const nPur = d.units.filter((u) => u.category === "購電" && u.name !== "其它購電太陽能").length, nOn = d3.sum(purC, (t) => t.items.length);
    // 圖例固定三列（未顯示的圖層變淡），切換時版面高度不變
    $("mapLegend").innerHTML =
      `<span class="${showOwn ? "" : "off"}"><i style="background:var(--s-own)"></i>台電自有：數字＝站數，大小＝裝置容量</span>` +
      `<span class="${showPur ? "" : "off"}"><i style="background:var(--s-site)"></i>大型案場：數字＝場數，大小＝發電功率（另 ${nPur - nOn} 場查無場址）</span>` +
      `<span>依縣市統整，位置為概略；標籤為即時發電功率</span>`;
    $("layerSw").innerHTML = LAYERS.map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${k === mapLayer}">${t}</button>`).join("");
    $("layerSw").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      mapLayer = b.dataset.k; try { localStorage.setItem("mapLayer", mapLayer); } catch (e) {}
      renderMap(lastMapData);
    }));
  }

  function renderPurchased(pur) {
    const list = pur.filter((u) => u.name !== "其它購電太陽能").sort((a, b) => (b.net || 0) - (a.net || 0));
    const max = d3.max(list, (u) => u.net || 0) || 1;
    $("purchasedBars").innerHTML =
      list.map((u) => {
        const tag = shortStatus(u.status) || (u.capacity == null ? "試運轉" : "");
        const loc = PUR_SITE[u.name] ? `<span class="loc">${PUR_SITE[u.name][0]}${PUR_SITE[u.name][1]}</span>` : `<span class="loc none">查無場址資料</span>`;
        return `<li title="${u.name}${tag ? "（" + tag + "）" : ""}"><span>${u.name}${tag ? ` <span class="tag">${tag}</span>` : ""}${loc}</span><span class="track"><span class="fill" style="width:${((u.net || 0) / max) * 100}%;display:block"></span></span><span class="num">${fmt(u.net)} MW</span></li>`;
      }).join("");
  }

  // ───── 堆疊面積圖 ─────
  function renderArea(series) {
    const el = d3.select("#areaChart"); el.selectAll("*").remove();
    $("areaLegend").innerHTML = GROUPS.slice().reverse().map((g) => `<span><i style="background:${g.color}"></i>${g.name}</span>`).join("") + `<span><i class="dash"></i>台電小計</span>`;
    if (!series || !series.length) { el.append("p").attr("class", "small muted").text("今天尚無資料"); return; }
    const W = el.node().clientWidth || 700, H = Math.max(240, Math.round(W * 0.42)), m = { t: 24, r: 22, b: 28, l: 62 };
    const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
    const x = d3.scaleLinear().domain([360, 1080]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, (d3.max(series, (s) => Math.max(s.sub, s.sum)) || 1) * 1.08]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(d3.range(360, 1081, 120)).tickFormat((v) => String(v / 60).padStart(2, "0") + ":00"));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format(",")(v)));
    svg.append("text").attr("x", 4).attr("y", 14).attr("fill", "var(--muted)").attr("font-size", 13.75).text("MW");
    const stack = d3.stack().keys(GROUPS.map((g) => g.key))(series);
    const area = d3.area().x((p) => x(toMin(p.data.t))).y0((p) => y(p[0])).y1((p) => y(p[1])).curve(d3.curveMonotoneX);
    svg.append("g").selectAll("path").data(stack).join("path").attr("d", area).style("fill", (s, i) => GROUPS[i].color).style("stroke", "var(--card)").style("stroke-width", 1);
    svg.append("path").datum(series).attr("d", d3.line().x((s) => x(toMin(s.t))).y((s) => y(s.sub)).curve(d3.curveMonotoneX))
      .style("fill", "none").style("stroke", "var(--s-sub)").style("stroke-width", 2).style("stroke-dasharray", "5 4");
    // 十字線＋提示框
    const cross = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).style("stroke", "var(--muted)").style("stroke-width", 1).style("opacity", 0);
    const bis = d3.bisector((s) => toMin(s.t)).center;
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent")
      .on("mousemove", (evt) => {
        const [mx] = d3.pointer(evt), s = series[bis(series, x.invert(mx))];
        cross.attr("x1", x(toMin(s.t))).attr("x2", x(toMin(s.t))).style("opacity", 1);
        showTip(evt, `<b>${s.t} 發電功率</b>${row("台電小計", fmt(s.sub) + " MW")}${GROUPS.slice().reverse().map((g) => row(g.name.replace(/（.*$/, ""), fmt(s[g.key]) + " MW")).join("")}`);
      })
      .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });
  }

  // ───── 資料一致性 ─────
  function renderConsistency(d) {
    const c = d.consistency || {}, pct = c.n ? (c.match / c.n) * 100 : null;
    $("consistBig").textContent = pct == null ? "–" : fmt(pct, pct === 100 ? 0 : 1) + "%";
    $("consistBig").classList.toggle("bad", pct != null && pct < 100);
    $("consistText").textContent = c.n ? `${c.match} / ${c.n} 個時段的各機組加總與台電小計一致（最大差值 ${fmt(c.maxAbs, 3)} MW）` : "";
    const el = d3.select("#diffChart"); el.selectAll("*").remove();
    const series = d.series || []; if (!series.length) return;
    const W = el.node().clientWidth || 320, H = 160, m = { t: 10, r: 20, b: 26, l: 48 };
    const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
    const x = d3.scaleLinear().domain([360, 1080]).range([m.l, W - m.r]);
    const lim = Math.max(0.1, (d3.max(series, (s) => Math.abs(s.diff)) || 0) * 1.1);
    const y = d3.scaleLinear().domain([-lim, lim]).range([H - m.b, m.t]);
    svg.append("rect").attr("x", m.l).attr("width", W - m.l - m.r).attr("y", y(0.05)).attr("height", y(-0.05) - y(0.05)).style("fill", "var(--band)");
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".2f")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(d3.range(360, 1081, 240)).tickFormat((v) => String(v / 60).padStart(2, "0") + ":00"));
    const bw = Math.max(1.5, ((W - m.l - m.r) / 73) * 0.6);
    svg.append("g").selectAll("rect").data(series).join("rect")
      .attr("x", (s) => x(toMin(s.t)) - bw / 2).attr("width", bw)
      .attr("y", (s) => y(Math.max(0, s.diff))).attr("height", (s) => Math.max(0.5, Math.abs(y(s.diff) - y(0))))
      .style("fill", (s) => (s.ok ? "var(--s-est)" : "var(--warn)"))
      .on("mousemove", (evt, s) => showTip(evt, `<b>${s.t}</b>${row("各機組加總", fmt(s.sum, 3) + " MW")}${row("台電小計", fmt(s.sub) + " MW")}${row("差值", fmt(s.diff, 3) + " MW")}${row("一致", s.ok ? "是" : "否")}`))
      .on("mouseleave", hideTip);
  }

  // ───── 機組表 ─────
  function renderTable(id, units, isPur) {
    const rows = units.slice().sort((a, b) => (b.net || 0) - (a.net || 0));
    const head = `<tr><th>機組</th><th class="n">發電功率 (MW)</th><th class="n">裝置容量 (MW)</th><th class="n">發電比率</th><th>狀態</th></tr>`;
    const body = rows.map((u) => {
      const st = u.status ? `<span class="pill">${shortStatus(u.status)}</span>` : u.capacity == null ? `<span class="pill">試運轉・暫不計入容量</span>` : u.name.startsWith("其它") ? `<span class="pill">整併項目</span>` : "";
      return `<tr><td>${u.name}</td><td class="n">${fmt(u.net, u.net >= 100 ? 1 : 2)}</td><td class="n">${u.capacity == null ? "–" : fmt(u.capacity)}</td><td class="n">${u.cf == null ? "–" : fmt(u.cf) + "%"}</td><td>${st}</td></tr>`;
    }).join("");
    const total = rows.reduce((s, u) => s + (u.net || 0), 0);
    $(id).innerHTML = `<thead>${head}</thead><tbody>${body}</tbody><tfoot><tr><td><b>合計</b></td><td class="n"><b>${fmt(total)}</b></td><td colspan="3"></td></tr></tfoot>`;
  }


  // ───── 第三分頁：收集紀錄與統計（2026-11-05 新增）─────
  // 資料：Apps Script ?view=stats（雲端收集的每日統計）；未設定 LIVE_URL 時使用 sample-stats.json
  let stats = null;
  const SLOTS = 73; // 06:00–18:00 每 10 分鐘一筆
  const DAY = 86400000;
  const toDate = (s) => new Date(s + "T00:00:00+08:00");
  const ymd = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const md = (s) => s.slice(5).replace("-", "/");
  const pctTxt = (v) => (v == null ? "–" : fmt(v * 100, v === 1 ? 0 : 2) + "%");

  async function loadStats() {
    const url = CFG.LIVE_URL ? CFG.LIVE_URL + (CFG.LIVE_URL.includes("?") ? "&" : "?") + "view=stats&_=" + Date.now() : "sample-stats.json";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    if (!CFG.LIVE_URL) j.sample = true;
    return j;
  }

  async function refreshStats() {
    try { stats = await loadStats(); renderStats(stats); }
    catch (e) { if (!stats) $("statsNote").textContent = "統計資料讀取失敗（" + e.message + "），稍後會自動重試。"; }
  }

  function summarize(days) {
    const n = d3.sum(days, (d) => d.n), cons = d3.sum(days, (d) => d.cons);
    const peakDay = days.reduce((m, d) => (d.peak != null && (!m || d.peak > m.peak) ? d : m), null);
    const lowDay = days.reduce((m, d) => (d.peak != null && (!m || d.peak < m.peak) ? d : m), null);
    return {
      days: days.length, n, cons, exp: days.length * SLOTS,
      comp: days.length ? n / (days.length * SLOTS) : null, consPct: n ? cons / n : null,
      full: days.filter((d) => d.n >= SLOTS).length,
      avgPeak: d3.mean(days, (d) => d.peak), avgNoon: d3.mean(days.filter((d) => d.noon != null), (d) => d.noon),
      peakDay, lowDay,
    };
  }

  function renderStats(j) {
    const start = CFG.STATS_START || "2026-10-13";
    const days = (j.days || []).filter((d) => d.d >= start).sort((a, b) => (a.d < b.d ? -1 : 1));
    $("statsNote").textContent = j.sample ? "目前顯示的是示範資料（電腦端收集，至 2026-11-04）。" : "";
    if (!days.length) { $("statsKpis").innerHTML = '<p class="small muted">尚無統計資料</p>'; return; }
    const lastDay = days[days.length - 1].d, s = summarize(days);
    $("statsRange").textContent = `統計期間 ${start.replace(/-/g, "/")}～${lastDay.replace(/-/g, "/")}（已結束的日期），資料更新於 ${j.generatedAt || "–"}`;
    const k = (lbl, val, unit, note) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}<small>${unit}</small></div>${note ? `<div class="kpi-note">${note}</div>` : ""}</div>`;
    $("statsKpis").innerHTML =
      k("收集天數", s.days, "天", `${md(start)}～${md(lastDay)}`) +
      k("收集完整度", pctTxt(s.comp).replace("%", ""), "%", `${s.n.toLocaleString()} / ${s.exp.toLocaleString()} 筆`) +
      k("資料一致性", pctTxt(s.consPct).replace("%", ""), "%", `${s.cons.toLocaleString()} / ${s.n.toLocaleString()} 筆`) +
      k("筆數完整的天數", s.full, "天", `共 ${s.days} 天，每天 ${SLOTS} 筆`);
    renderTrend(days);
    renderReg(days);
    renderWeeks(days, start, lastDay);
    renderMonths(days, start, lastDay);
  }

  // 數據異常說明（2026-11-09 新增）：日期區間內的原因說明；圖上以底色標示
  // 新增事件時，照格式加一筆即可（from／to 為 YYYY-MM-DD）
  const EVENTS = [
    { from: "2026-10-22", to: "2026-10-24", tag: "颱風", title: "薔琵颱風",
      note: "日照減少，尖峰降至約平常的 4 成；資料收集完整，非收集錯誤" },
  ];
  const LOW_RATIO = 0.8; // 尖峰低於統計期間中位數的 80% 視為「明顯偏低」
  const eventOf = (d) => EVENTS.find((e) => d >= e.from && d <= e.to);

  function renderTrend(days) {
    const el = d3.select("#trendChart"); el.selectAll("*").remove();
    const med = d3.median(days, (d) => d.peak), isLow = (d) => d.peak != null && med && d.peak < med * LOW_RATIO;
    const evs = EVENTS.filter((e) => e.to >= days[0].d && e.from <= days[days.length - 1].d);
    $("trendLegend").innerHTML = `<span><i style="background:var(--accent)"></i>每日尖峰發電功率</span><span><i style="background:var(--s-site)"></i>每日 12:00 發電功率</span>` +
      `<span><i style="background:var(--warn);border-radius:50%"></i>尖峰明顯偏低</span>`;
    const W = el.node().clientWidth || 900, H = Math.max(240, Math.round(W * 0.32)), m = { t: 24, r: 22, b: 30, l: 62 };
    const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const x = d3.scaleTime().domain([toDate(days[0].d), toDate(days[days.length - 1].d)]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, (d3.max(days, (d) => d.peak) || 1) * 1.08]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(days.filter((d, i) => i % Math.max(1, Math.ceil(days.length / Math.floor(W / 70))) === 0).map((d) => toDate(d.d))).tickFormat((d) => md(ymd(d))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format(",")(v)));
    svg.append("text").attr("x", 4).attr("y", 14).attr("fill", "var(--muted)").attr("font-size", 13.75).text("MW");
    // 異常說明期間：底色＋標籤
    evs.forEach((e) => {
      const x0 = Math.max(m.l, x(new Date(toDate(e.from).getTime() - DAY / 2))), x1 = Math.min(W - m.r, x(new Date(toDate(e.to).getTime() + DAY / 2)));
      svg.append("rect").attr("x", x0).attr("y", m.t).attr("width", Math.max(0, x1 - x0)).attr("height", H - m.t - m.b).style("fill", "var(--band)");
      svg.append("text").attr("x", (x0 + x1) / 2).attr("y", m.t + 14).attr("text-anchor", "middle").attr("font-size", 13.75).attr("font-weight", 700).attr("fill", "var(--ink2)").text(x1 - x0 >= 80 ? e.title : e.tag);
      if (x1 - x0 >= 80) svg.append("text").attr("x", (x0 + x1) / 2).attr("y", m.t + 30).attr("text-anchor", "middle").attr("font-size", 12.5).attr("fill", "var(--muted)").text(`${md(e.from)}～${md(e.to)}`);
    });
    const line = (key) => d3.line().defined((d) => d[key] != null).x((d) => x(toDate(d.d))).y((d) => y(d[key]));
    svg.append("path").datum(days).attr("d", line("noon")).style("fill", "none").style("stroke", "var(--s-site)").style("stroke-width", 2);
    svg.append("path").datum(days).attr("d", line("peak")).style("fill", "none").style("stroke", "var(--accent)").style("stroke-width", 2.5);
    svg.append("g").selectAll("circle").data(days).join("circle").attr("cx", (d) => x(toDate(d.d))).attr("cy", (d) => y(d.peak)).attr("r", (d) => (isLow(d) ? 5 : 3.5)).style("fill", (d) => (isLow(d) ? "var(--warn)" : "var(--accent)"));
    const cross = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).style("stroke", "var(--muted)").style("opacity", 0);
    const bis = d3.bisector((d) => toDate(d.d)).center;
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent")
      .on("mousemove", (evt) => {
        const [mx] = d3.pointer(evt), d = days[bis(days, x.invert(mx))];
        cross.attr("x1", x(toDate(d.d))).attr("x2", x(toDate(d.d))).style("opacity", 1);
        showTip(evt, `<b>${d.d}</b>${row("尖峰發電功率", fmt(d.peak) + " MW")}${row("尖峰時間", d.peakT || "–")}${row("12:00 發電功率", fmt(d.noon) + " MW")}${row("收集筆數", d.n + " / " + SLOTS)}${row("一致筆數", d.cons + " / " + d.n)}` +
          (eventOf(d.d) ? `<div class="tip-note">${eventOf(d.d).title}影響</div>` : isLow(d) ? `<div class="tip-note">尖峰明顯偏低，原因待查</div>` : ""));
      })
      .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });
    // 事件標註：在期間內最低點旁標出數值，與平常（中位數）對照；窄螢幕省略
    if (W >= 640) evs.forEach((e) => {
      const lo = days.filter((d) => d.d >= e.from && d.d <= e.to && d.peak != null).sort((a, b) => a.peak - b.peak)[0]; if (!lo) return;
      const px = x(toDate(lo.d)), py = y(lo.peak), tx = x(new Date(toDate(e.to).getTime() + DAY / 2)) + 14, ty = py + 4;
      const g = svg.append("g").style("pointer-events", "none");
      g.append("line").attr("x1", px + 6).attr("y1", py).attr("x2", tx - 4).attr("y2", ty - 4).style("stroke", "var(--warn)").style("stroke-width", 1.2);
      const t = g.append("text").attr("x", tx).attr("y", ty).attr("font-size", 13.75).attr("fill", "var(--ink)");
      t.append("tspan").attr("font-weight", 700).attr("fill", "var(--warn)").text(`尖峰約 ${fmt(lo.peak, 0)} MW`);
      t.append("tspan").attr("x", tx).attr("dy", 18).attr("fill", "var(--ink2)").text(`平常約 ${fmt(med, 0)} MW`);
    });
    renderTrendNotes(days);
  }

  // ───── 數據異常的推估（2026-11-09 雛型）：用每日統計本身推估原因，帶出判斷脈絡 ─────
  // 每日資料若含 lg（大型案場尖峰）、sm（小型案場尖峰）、u（各機組尖峰），推估會更細；沒有時只用總尖峰與筆數
  const UNIT_LOW = 0.3; // 個別機組尖峰低於自己中位數的 30% 視為異常
  function inferAnomalies(days) {
    const med = (k) => d3.median(days.filter((d) => d[k] != null), (d) => d[k]);
    const M = { peak: med("peak"), lg: med("lg"), sm: med("sm") };
    const out = [];
    days.forEach((d) => {
      const r = (k) => (d[k] != null && M[k] ? d[k] / M[k] : null);
      const low = r("peak") != null && r("peak") < LOW_RATIO, gap = d.n < SLOTS * 0.9;
      let type = null;
      if (gap) type = "gap";
      else if (low && r("lg") != null) type = r("lg") < LOW_RATIO ? "wide" : "est";
      else if (low) type = "low";
      if (type) out.push({ d: d.d, type, key: type, day: d, rp: r("peak"), rl: r("lg"), rs: r("sm") });
      if (d.u && type !== "wide") Object.keys(d.u).forEach((u) => {
        const um = d3.median(days.filter((x) => x.u && x.u[u] != null), (x) => x.u[u]);
        if (um > 1 && d.u[u] < um * UNIT_LOW) out.push({ d: d.d, type: "unit", key: "unit:" + u, unit: u, v: d.u[u], um });
      });
    });
    // 連續日期、同類型合併為一段
    const groups = [];
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.d < b.d ? -1 : 1)).forEach((o) => {
      const g = groups[groups.length - 1];
      if (g && g.key === o.key && (toDate(o.d) - toDate(g.to)) / DAY === 1) { g.to = o.d; g.items.push(o); }
      else groups.push({ key: o.key, type: o.type, from: o.d, to: o.d, items: [o] });
    });
    return { groups: groups.sort((a, b) => (a.from < b.from ? -1 : 1)), M };
  }

  function renderTrendNotes(days) {
    const el = $("trendNotes"); if (!el) return;
    const { groups, M } = inferAnomalies(days);
    const pc = (v) => Math.round(v * 10) + " 成";
    const items = groups.map((g) => {
      const it = g.items, e = EVENTS.find((x) => x.from <= g.to && x.to >= g.from);
      const minBy = (k) => it.reduce((m, o) => (o[k] != null && (m == null || o[k] < m) ? o[k] : m), null);
      // 給一般民眾看的簡短說明：事件名稱（或推估類型）＋一句原因
      let title, text, est = !(e && g.type !== "unit");
      if (g.type === "unit") { title = it[0].unit; text = "單一案場數值異常，不影響全台"; }
      else if (g.type === "gap") { title = "資料不完整"; text = "當天收集中斷，數值可能偏低"; }
      else {
        const r = g.type === "wide" ? Math.min(minBy("rl"), minBy("rs")) : minBy("rp");
        title = e ? e.title : "天氣不佳";
        text = g.type === "est" ? "小型案場估算值偏低" : `日照減少，發電降至約平常的 ${pc(r)}`;
      }
      const range = est ? [g.from, g.to] : [e.from, e.to];
      return `<li><span class="pill${est ? " est" : ""}">${md(range[0])}${range[1] !== range[0] ? "～" + md(range[1]) : ""}</span><b>${title}</b>：${text}${est ? '<span class="est-tag">推估</span>' : ""}</li>`;
    });
    el.innerHTML = items.length ? `<span class="tn-h">數據異常說明</span><ul>${items.join("")}</ul>` : "";
  }

  function statRow(label, sub, ds, extra, expDays) {
    const s = summarize(ds);
    // expDays：統計期間內應有的天數（月彙總用，整天沒收到也會反映在完整度）
    if (expDays) s.comp = s.n / (expDays * SLOTS);
    return `<tr><td>${label}${sub ? `<div class="sub-cell">${sub}</div>` : ""}</td>${extra || ""}<td class="n">${fmt(s.avgPeak)}</td>` +
      `<td class="n">${s.peakDay ? fmt(s.peakDay.peak) + `<div class="sub-cell">${md(s.peakDay.d)}</div>` : "–"}</td>` +
      `<td class="n">${s.lowDay ? fmt(s.lowDay.peak) + `<div class="sub-cell">${md(s.lowDay.d)}</div>` : "–"}</td>` +
      `<td class="n">${fmt(s.avgNoon)}</td><td class="n">${pctTxt(s.comp)}</td></tr>`;
  }

  // 整體趨勢：每日尖峰的線性迴歸（最小平方法），排除已說明的異常事件日
  function linReg(pts) {
    const n = pts.length, mx = d3.mean(pts, (p) => p[0]), my = d3.mean(pts, (p) => p[1]);
    const sxy = d3.sum(pts, (p) => (p[0] - mx) * (p[1] - my)), sxx = d3.sum(pts, (p) => (p[0] - mx) ** 2);
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    const sst = d3.sum(pts, (p) => (p[1] - my) ** 2), sse = d3.sum(pts, (p) => (p[1] - (a + b * p[0])) ** 2);
    return { a, b, r2: sst ? 1 - sse / sst : 0, n, my };
  }
  function renderReg(days) {
    const el = d3.select("#regChart"); if (el.empty()) return; el.selectAll("*").remove();
    const t0 = toDate(days[0].d), dx = (d) => Math.round((toDate(d.d) - t0) / DAY);
    const used = days.filter((d) => d.peak != null && !eventOf(d.d)), skip = days.filter((d) => d.peak != null && eventOf(d.d));
    if (used.length < 7) { $("regSum").textContent = "資料少於 7 天，暫不計算趨勢。"; return; }
    const R = linReg(used.map((d) => [dx(d), d.peak])), wk = R.b * 7, pct = wk / R.my;
    const lvl = R.r2 >= 0.6 ? "明顯" : R.r2 >= 0.3 ? "中等" : "很弱";
    const dir = Math.abs(pct) < 0.005 ? "大致持平" : wk < 0 ? `每週約下降 ${fmt(-wk, 0)} MW（約 ${fmt(-pct * 100, 1)}%）` : `每週約上升 ${fmt(wk, 0)} MW（約 ${fmt(pct * 100, 1)}%）`;
    const evNames = [...new Set(skip.map((d) => eventOf(d.d).title))].join("、");
    $("regSum").innerHTML = `<b>近 ${days.length} 天尖峰${dir}</b>　趨勢強度：${lvl}（R² ${fmt(R.r2, 2)}）` +
      `${wk < 0 && R.r2 >= 0.3 ? "；推測與秋冬日照時間變短、太陽角度變低有關" : ""}<span class="est-tag">推估資訊</span>` +
      `<span class="reg-note">${skip.length ? `已排除 ${evNames} ${skip.length} 天；` : ""}由台電公布值計算的統計推估，非台電公布值；資料期間短，僅供參考</span>`;
    $("regLegend").innerHTML = `<span><i style="background:var(--accent);border-radius:50%"></i>每日尖峰（納入計算）</span>` +
      (skip.length ? `<span><i style="background:transparent;border:1.5px solid var(--muted);border-radius:50%"></i>異常事件日（排除）</span>` : "") +
      `<span><i class="dash" style="border-top-color:var(--warn)"></i>趨勢線</span>`;
    const W = el.node().clientWidth || 900, H = Math.max(200, Math.round(W * 0.24)), m = { t: 14, r: 22, b: 30, l: 62 };
    const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const x = d3.scaleTime().domain([t0, toDate(days[days.length - 1].d)]).range([m.l, W - m.r]);
    const lo = d3.min(days, (d) => d.peak), hi = d3.max(days, (d) => d.peak);
    const y = d3.scaleLinear().domain([Math.max(0, lo - 500), hi + 300]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(days.filter((d, i) => i % Math.max(1, Math.ceil(days.length / Math.floor(W / 70))) === 0).map((d) => toDate(d.d))).tickFormat((d) => md(ymd(d))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((v) => d3.format(",")(v)));
    svg.append("text").attr("x", 4).attr("y", 12).attr("fill", "var(--muted)").attr("font-size", 13.75).text("MW");
    const last = dx(days[days.length - 1]);
    svg.append("line").attr("x1", x(t0)).attr("x2", x(toDate(days[days.length - 1].d))).attr("y1", y(R.a)).attr("y2", y(R.a + R.b * last))
      .style("stroke", "var(--warn)").style("stroke-width", 2).style("stroke-dasharray", "6 5");
    svg.append("g").selectAll("circle").data(used).join("circle").attr("cx", (d) => x(toDate(d.d))).attr("cy", (d) => y(d.peak)).attr("r", 4).style("fill", "var(--accent)");
    svg.append("g").selectAll("circle").data(skip).join("circle").attr("cx", (d) => x(toDate(d.d))).attr("cy", (d) => y(d.peak)).attr("r", 4)
      .style("fill", "var(--card)").style("stroke", "var(--muted)").style("stroke-width", 1.5);
    svg.append("g").selectAll("circle").data(used.concat(skip)).join("circle").attr("cx", (d) => x(toDate(d.d))).attr("cy", (d) => y(d.peak)).attr("r", 10).style("fill", "transparent")
      .on("mousemove", (evt, d) => showTip(evt, `<b>${d.d}</b>${row("尖峰發電功率", fmt(d.peak) + " MW")}${row("趨勢線", fmt(R.a + R.b * dx(d), 0) + " MW")}` + (eventOf(d.d) ? `<div class="tip-note">${eventOf(d.d).title}（不納入計算）</div>` : "")))
      .on("mouseleave", hideTip);
  }

  function renderWeeks(days, start, lastDay) {
    // 自統計起始日起每 7 天為一週；平均尖峰不含已說明的異常事件日，並與前一週比較
    let ws = toDate(start);
    const rows = []; let i = 1, prev = null;
    while (ymd(ws) <= lastDay) {
      const we = new Date(ws.getTime() + 6 * DAY), a = ymd(ws), b = ymd(we);
      const ds = days.filter((d) => d.d >= a && d.d <= b);
      if (ds.length) {
        const ok = ds.filter((d) => d.peak != null && !eventOf(d.d)), ex = ds.length - ok.length;
        const avg = ok.length ? d3.mean(ok, (d) => d.peak) : null, s = summarize(ds), done = b <= lastDay && ds.length === 7;
        let cmp = "–";
        if (avg != null && prev != null) { const df = avg - prev; cmp = `<span class="${df < 0 ? "dn" : "up"}">${df < 0 ? "▼" : "▲"} ${fmt(Math.abs(df), 0)}</span>`; }
        rows.push(`<tr><td>第 ${i} 週<div class="sub-cell">${md(a)}～${md(b)}${done ? "" : "（進行中）"}</div></td><td class="n">${fmt(avg)}${ex ? `<div class="sub-cell">不含事件日 ${ex} 天</div>` : ""}</td><td class="n">${cmp}</td><td class="n">${pctTxt(s.comp)}</td></tr>`);
        if (avg != null) prev = avg; i++;
      }
      ws = new Date(ws.getTime() + 7 * DAY);
    }
    $("weekTable").innerHTML = `<thead><tr><th>週次</th><th class="n">平均尖峰 (MW)</th><th class="n">與前週相比 (MW)</th><th class="n">收集完整度</th></tr></thead><tbody>${rows.reverse().join("")}</tbody>`;
  }

  function renderMonths(days, start, lastDay) {
    // 依日曆月份彙總；統計期間＝該月第一天（或統計起始日）至該月最後一天（或最新已結束日期）
    const keys = [...new Set(days.map((d) => d.d.slice(0, 7)))];
    const rows = keys.map((mk) => {
      const ds = days.filter((d) => d.d.startsWith(mk));
      const [yy, mm] = mk.split("-").map(Number);
      const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate(), mEnd = `${mk}-${String(dim).padStart(2, "0")}`;
      const ended = mEnd <= lastDay;
      const from = start > `${mk}-01` ? start : `${mk}-01`, to = ended ? mEnd : lastDay;
      const expDays = Math.round((toDate(to) - toDate(from)) / DAY) + 1;
      return statRow(`${yy} 年 ${mm} 月`, `${md(from)}～${md(to)}${ended ? "" : "（進行中）"}`, ds,
        `<td class="n">${ds.length} / ${expDays}</td>`, expDays);
    });
    $("monthTable").innerHTML = `<thead><tr><th>月份</th><th class="n">收集天數</th><th class="n">平均尖峰 (MW)</th><th class="n">最高尖峰 (MW)</th><th class="n">最低尖峰 (MW)</th><th class="n">平均 12:00 (MW)</th><th class="n">收集完整度</th></tr></thead><tbody>${rows.reverse().join("")}</tbody>`;
  }


  // ───── 太陽光電怎麼發電：互動立體圖（2026-11-09；滑過顯示說明，觸控裝置點一下）─────
  function initPvScene() {
    const scene = $("pvScene"), stage = $("pvStage"), pop = $("pvPop"); if (!scene) return;
    const INFO = {
      house: { t: "屋頂型小型案場", li: ["在建物屋頂設置光電板", "發的電經電表送入台電電網"] },
      sun: { n: 1, t: "太陽光", li: ["提供發電的能量", "日射量越高，發電越多"] },
      panel: { n: 2, t: "光電板", li: ["把陽光轉成直流電（DC）"] },
      jbox: { n: 3, t: "接線箱", li: ["匯集多組光電板的直流電", "設有保護裝置"] },
      inverter: { n: 4, t: "變流器", li: ["直流電轉成交流電（AC）", "才能送進台電電網"] },
      meter: { n: 5, t: "計量（電表）", li: ["計算送入電網的電量（度＝kWh）", "台電依此計算購電量"],
        note: ["小型案場＝台電資料的「其它購電太陽能」，台電依取樣比例估算", "電表記錄「發電量」；本網站顯示的是「發電功率」"] },
      grid: { n: 6, t: "配電線路", li: ["經電表送入路旁的配電線路", "就近送到附近用戶"] },
      user: { n: 7, t: "用戶", li: ["家庭、工廠用電", "桿上變壓器把電壓降到住戶可用"] },
      sub: { n: 8, t: "變電所", li: ["轉換電壓；連接配電與輸電線路", "附近用不完的電送往其他地區"] },
    };
    let pinned = null, hideT = null;
    const place = (g) => {
      if (window.matchMedia("(max-width: 640px)").matches) { pop.style.left = pop.style.top = ""; return; } // 手機：說明放在圖下方
      const sr = stage.getBoundingClientRect(), gr = g.getBoundingClientRect();
      pop.style.left = "0px"; pop.style.top = "0px";
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = gr.right - sr.left + 10, y = gr.top - sr.top + gr.height / 2 - ph / 2;
      if (x + pw > sr.width - 6) x = gr.left - sr.left - pw - 10;   // 右邊放不下改放左邊
      if (x < 6) x = Math.max(6, Math.min(sr.width - pw - 6, gr.left - sr.left + gr.width / 2 - pw / 2)), y = gr.bottom - sr.top + 8;
      y = Math.max(6, Math.min(sr.height - ph - 6, y));
      pop.style.left = x + "px"; pop.style.top = y + "px";
    };
    const show = (g) => {
      clearTimeout(hideT);
      const s = INFO[g.dataset.k]; if (!s) return;
      scene.querySelectorAll(".hs").forEach((x) => x.classList.toggle("on", x === g));
      pop.innerHTML = `<b>${s.n ? `<span class="pv-n">${s.n}</span>` : ""}${s.t}</b><ul>${s.li.map((x) => `<li>${x}</li>`).join("")}</ul>` +
        (s.note ? `<ul class="pv-note">${s.note.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
      pop.hidden = false; place(g);
    };
    const hide = () => { hideT = setTimeout(() => { if (pinned) return; pop.hidden = true; scene.querySelectorAll(".hs.on").forEach((x) => x.classList.remove("on")); }, 120); };
    scene.querySelectorAll(".hs").forEach((g) => {
      g.addEventListener("mouseenter", () => { if (!pinned) show(g); });
      g.addEventListener("mouseleave", hide);
      g.addEventListener("focus", () => show(g));
      g.addEventListener("blur", () => { pinned = null; hide(); });
      g.addEventListener("click", (e) => { e.stopPropagation(); pinned = pinned === g ? null : g; if (pinned) show(g); else hide(); });
    });
    document.addEventListener("click", () => { if (pinned) { pinned = null; hide(); } });
    window.addEventListener("resize", () => { const g = scene.querySelector(".hs.on"); if (g && !pop.hidden) place(g); });
  }
  initPvScene();
  init().catch((e) => { $("dataTime").textContent = "載入失敗：" + e.message; });
})();
