/* 台電太陽能即時發電｜GitHub Pages 前端
 * 即時資料：config.js 的 LIVE_URL（Google Apps Script ?view=live）；未設定時使用 data/sample-live.json
 */
(function () {
  "use strict";
  const CFG = window.SOLAR_CONFIG || {};
  const LIVE_UNITS = ["彰濱光", "南鹽光"]; // 可一對一對應到發電站的機組
  const GROUPS = [
    { key: "purEst", name: "購電：其它購電太陽能（估算整併）", color: "var(--s-est)" },
    { key: "purSite", name: "購電：個別案場", color: "var(--s-site)" },
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
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => last && renderAll(last), 200); });
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
    const sum = (a) => a.reduce((s, u) => s + (u.net || 0), 0);
    const ownMW = sum(own), purMW = sum(pur);
    renderHeader(d);
    renderKpis(d, ownMW, purMW);
    renderMap(d);
    renderPurchased(pur);
    renderArea(d.series);
    renderConsistency(d);
    renderTable("ownTable", own, false);
    renderTable("purTable", pur, true);
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

  function renderKpis(d, ownMW, purMW) {
    const c = d.consistency || {};
    const pct = c.n ? (c.match / c.n) * 100 : null;
    const k = (lbl, val, unit, sw) => `<div class="kpi"><div class="lbl">${sw ? `<span class="sw" style="background:${sw}"></span>` : ""}${lbl}</div><div class="val">${val}<small>${unit}</small></div></div>`;
    const ser = d.series || [];
    const peak = ser.reduce((m, s) => (s.sub > (m ? m.sub : -1) ? s : m), null);
    $("kpis").innerHTML =
      k("即時發購電量", fmt(d.subtotal), "MW").replace('class="kpi"', 'class="kpi wide"') +
      k("資料一致性（今日）", pct == null ? "–" : fmt(pct, pct === 100 ? 0 : 1), "%") +
      k(`今日尖峰發購電量${peak ? "（" + peak.t + "）" : ""}`, peak ? fmt(peak.sub) : "–", "MW") +
      k("台電自有", fmt(ownMW), "MW", "var(--s-own)") +
      k("購電", fmt(purMW), "MW", "var(--s-est)");
  }

  // ───── 地圖 ─────
  function renderMap(d) {
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
    const r = d3.scaleSqrt().domain([0, d3.max(sites.stations, (s) => s.capacityKW)]).range([3, 17]);
    const pos = (s) => {
      const pj = projs.find((p) => p.test && p.test.test(s.county)) || projs[0];
      return pj.proj([s.lon, s.lat]);
    };
    const data = sites.stations.slice().sort((a, b) => b.capacityKW - a.capacityKW);
    const g = svg.append("g");
    g.selectAll("circle").data(data).join("circle")
      .attr("class", (s) => "dot" + (LIVE_UNITS.includes(s.unit) ? " live" : ""))
      .attr("cx", (s) => pos(s)[0]).attr("cy", (s) => pos(s)[1]).attr("r", (s) => r(s.capacityKW))
      .style("fill", "var(--s-own)").style("fill-opacity", (s) => (LIVE_UNITS.includes(s.unit) ? 0.95 : 0.7))
      .on("mousemove", (evt, s) => {
        const live = LIVE_UNITS.includes(s.unit)
          ? row("即時發電", fmt(unitNet[s.unit]) + " MW")
          : row("即時發電", "含在「其它台電自有」") + row("其它台電自有合計", fmt(otherOwn) + " MW");
        showTip(evt, `<b>${s.name}</b>${row("位置", s.county + s.town + (s.village || ""))}${row("裝置容量（2024 場址資料）", fmt(s.capacityKW / 1000, 2) + " MW")}${s.trialKW ? row("其中試運轉", fmt(s.trialKW / 1000, 2) + " MW") : ""}${live}${row("場址數", s.sites)}${row("定位精度", s.precision)}`);
      })
      .on("mouseleave", hideTip);
    g.selectAll("text").data(data.filter((s) => LIVE_UNITS.includes(s.unit))).join("text")
      .attr("class", "dot-lbl").attr("x", (s) => pos(s)[0] + r(s.capacityKW) + 5).attr("y", (s) => pos(s)[1] + 4)
      .text((s) => `${s.unit} ${fmt(unitNet[s.unit])} MW`);

    $("mapLegend").innerHTML =
      `<span><i style="background:var(--s-own)"></i>台電自有發電站（圓的大小＝2024 場址資料的裝置容量）</span>` +
      `<span><i style="background:var(--s-own);box-shadow:0 0 0 2px var(--ink)"></i>可顯示個別即時發電量</span>` +
      `<span>位置為村里或鄉鎮中心點（概略）</span>`;
  }

  function renderPurchased(pur) {
    const list = pur.filter((u) => u.name !== "其它購電太陽能").sort((a, b) => (b.net || 0) - (a.net || 0));
    const max = d3.max(list, (u) => u.net || 0) || 1;
    const est = pur.find((u) => u.name === "其它購電太陽能");
    $("purchasedBars").innerHTML =
      (est ? `<li><span>其它購電太陽能</span><span class="tag">估算整併，不畫長條</span><span class="num">${fmt(est.net)} MW</span></li>` : "") +
      list.map((u) => {
        const tag = shortStatus(u.status) || (u.capacity == null ? "試運轉" : "");
        return `<li title="${u.name}${tag ? "（" + tag + "）" : ""}"><span>${u.name}${tag ? ` <span class="tag">${tag}</span>` : ""}</span><span class="track"><span class="fill" style="width:${((u.net || 0) / max) * 100}%;display:block"></span></span><span class="num">${fmt(u.net)} MW</span></li>`;
      }).join("");
  }

  // ───── 堆疊面積圖 ─────
  function renderArea(series) {
    const el = d3.select("#areaChart"); el.selectAll("*").remove();
    $("areaLegend").innerHTML = GROUPS.slice().reverse().map((g) => `<span><i style="background:${g.color}"></i>${g.name}</span>`).join("") + `<span><i class="dash"></i>台電小計</span>`;
    if (!series || !series.length) { el.append("p").attr("class", "small muted").text("今天尚無資料"); return; }
    const W = el.node().clientWidth || 700, H = Math.max(240, Math.round(W * 0.42)), m = { t: 10, r: 22, b: 26, l: 52 };
    const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`);
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
    const x = d3.scaleLinear().domain([360, 1080]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, (d3.max(series, (s) => Math.max(s.sub, s.sum)) || 1) * 1.08]).nice().range([H - m.b, m.t]);
    svg.append("g").attr("class", "gridline").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(d3.range(360, 1081, 120)).tickFormat((v) => String(v / 60).padStart(2, "0") + ":00"));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format(",")(v)));
    svg.append("text").attr("x", 4).attr("y", m.t + 4).attr("fill", "var(--muted)").attr("font-size", 11).text("MW");
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
        showTip(evt, `<b>${s.t}</b>${row("台電小計", fmt(s.sub) + " MW")}${GROUPS.slice().reverse().map((g) => row(g.name.replace("購電：", ""), fmt(s[g.key]) + " MW")).join("")}`);
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
    const W = el.node().clientWidth || 320, H = 150, m = { t: 8, r: 20, b: 22, l: 40 };
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
    const head = `<tr><th>機組</th><th class="n">即時發電 (MW)</th><th class="n">裝置容量 (MW)</th><th class="n">容量因數</th><th>狀態</th></tr>`;
    const body = rows.map((u) => {
      const st = u.status ? `<span class="pill">${shortStatus(u.status)}</span>` : u.capacity == null ? `<span class="pill">試運轉・容量未揭露</span>` : u.name.startsWith("其它") ? `<span class="pill">整併項目</span>` : "";
      return `<tr><td>${u.name}</td><td class="n">${fmt(u.net, u.net >= 100 ? 1 : 2)}</td><td class="n">${u.capacity == null ? "–" : fmt(u.capacity)}</td><td class="n">${u.cf == null ? "–" : fmt(u.cf) + "%"}</td><td>${st}</td></tr>`;
    }).join("");
    const total = rows.reduce((s, u) => s + (u.net || 0), 0);
    $(id).innerHTML = `<thead>${head}</thead><tbody>${body}</tbody><tfoot><tr><td><b>合計</b></td><td class="n"><b>${fmt(total)}</b></td><td colspan="3"></td></tr></tfoot>`;
  }

  init().catch((e) => { $("dataTime").textContent = "載入失敗：" + e.message; });
})();
