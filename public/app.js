const state = {
  snapshot: null,
  analysis: null,
  range: "45",
  search: ""
};

const els = {
  statusPill: document.querySelector("#statusPill"),
  refreshBtn: document.querySelector("#refreshBtn"),
  summaryGrid: document.querySelector("#summaryGrid"),
  dailyChart: document.querySelector("#dailyChart"),
  dailyRows: document.querySelector("#dailyRows"),
  issueList: document.querySelector("#issueList"),
  tierList: document.querySelector("#tierList"),
  categoryList: document.querySelector("#categoryList"),
  locationList: document.querySelector("#locationList"),
  identityList: document.querySelector("#identityList"),
  contributorRows: document.querySelector("#contributorRows"),
  rangeSelect: document.querySelector("#rangeSelect"),
  searchInput: document.querySelector("#searchInput")
};

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function fmtPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function dayKey(dateLike) {
  return String(dateLike || "").slice(0, 10);
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000));
}

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function moduleShort(moduleName) {
  return String(moduleName || "").split("/").slice(1).join("/") || moduleName;
}

function topEntries(obj, limit = 8) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function cleanCompany(company) {
  return String(company || "").replace(/^@+/, "").trim();
}

function normalizeLocation(location) {
  const raw = String(location || "").trim();
  if (!raw) return "未填写";
  const lower = raw.toLowerCase();
  if (/(china|beijing|shanghai|shenzhen|hangzhou|guangzhou|nanjing|chengdu|wuhan|xian|xi'an|中国|北京|上海|深圳|杭州|广州|南京|成都|武汉|西安)/.test(lower)) return "中国";
  if (/(japan|tokyo|osaka|kyoto|日本|東京|东京)/.test(lower)) return "日本";
  if (/(singapore|新加坡)/.test(lower)) return "新加坡";
  if (/(united states|usa|u\.s\.|california|san francisco|new york|seattle|boston|austin|美国)/.test(lower)) return "美国";
  if (/(canada|toronto|vancouver|加拿大)/.test(lower)) return "加拿大";
  if (/(germany|berlin|munich|deutschland|德国)/.test(lower)) return "德国";
  if (/(france|paris|法国)/.test(lower)) return "法国";
  if (/(united kingdom|uk|london|england|英国)/.test(lower)) return "英国";
  if (/(india|bangalore|印度)/.test(lower)) return "印度";
  if (/(taiwan|taipei|台湾|台北)/.test(lower)) return "中国台湾";
  if (/(hong kong|香港)/.test(lower)) return "中国香港";
  return raw.split(",").map((part) => part.trim()).filter(Boolean).at(-1) || raw;
}

function identityFor(profile, person) {
  const company = cleanCompany(profile?.company);
  const text = `${profile?.type || ""} ${company} ${profile?.bio || ""} ${person.owner} ${person.topKeywords?.map(([key]) => key).join(" ") || ""}`.toLowerCase();
  if ((profile?.type || "").toLowerCase() === "organization" || /(community|foundation|org|team|lang|moonbit-community|moonbitlang)/.test(text)) return "组织/社区账号";
  if (/(university|college|institute|school|lab|research|academy|大学|学院|研究|实验室)/.test(text)) return "高校/研究机构线索";
  if (/(compiler|programming language|language|parser|tree-sitter|wasm|ffi|native|toolchain|pl\b)/.test(text)) return "语言/工具链开发者";
  if (/(ai|llm|agent|machine learning|ml|model|openai|anthropic|genai)/.test(text)) return "AI/LLM 开发者";
  if (/(game|graphics|canvas|svg|render|audio|engine|font|pdf)/.test(text)) return "图形/游戏/媒体开发者";
  if (/(web|frontend|front-end|react|dom|css|http|server|browser|ui)/.test(text)) return "Web/前端/网络开发者";
  if (company) return "公司/组织线索";
  if (profile?.bio) return "个人开发者";
  return "公开资料较少";
}

function categoryFor(module) {
  const text = `${module.name || ""} ${(module.keywords || []).join(" ")} ${module.description || ""}`.toLowerCase();
  if (/(parser|parse|json|yaml|toml|xml|html|markdown|regex|lexer|syntax|protobuf|csv|serialize|encoding|unicode|gb18030|base64)/.test(text)) return "数据格式/解析/文本";
  if (/(math|algorithm|graph|sort|hash|crypto|random|matrix|geometry|number|statistics|compress|zstd|sha|md5|crc|algebra)/.test(text)) return "算法/数学/底层";
  if (/(cli|tool|test|testing|build|ci|debug|fmt|format|benchmark|version|moonver|coverage|wasm|ffi|native)/.test(text)) return "开发工具/工程化";
  if (/(web|http|server|api|request|react|ui|dom|browser|css|router|preact)/.test(text)) return "Web/网络/前端";
  if (/(game|image|audio|canvas|graphics|svg|color|font|render|music|ray|draw|pdf)/.test(text)) return "图形/游戏/媒体";
  if (/(ai|llm|agent|ml|neural|model|anthropic|openai|genai)/.test(text)) return "AI/LLM";
  return "通用/实验";
}

function analyze(snapshot) {
  const modules = snapshot.modules || [];
  const stats = snapshot.statistics || {};
  const githubProfiles = snapshot.github_profiles || {};
  const githubMeta = snapshot.github_meta || {};
  const owners = new Map();
  const daily = new Map();
  const categories = {};
  const locations = {};
  const identities = {};
  const licenses = {};
  let repoMissing = 0;
  let repoGithub = 0;
  let repoCommunity = 0;

  for (const module of modules) {
    const owner = ownerOf(module.name);
    const created = dayKey(module.created_at);
    if (!owners.has(owner)) {
      owners.set(owner, {
        owner,
        count: 0,
        first: "",
        last: "",
        recent30: 0,
        recent7: 0,
        modules: [],
        keywords: {},
        categories: {},
        repoMissing: 0,
        repoCount: 0,
        licenses: {}
      });
    }
    const person = owners.get(owner);
    person.count += 1;
    person.modules.push(module);
    person.first = !person.first || created < person.first ? created : person.first;
    person.last = !person.last || created > person.last ? created : person.last;

    const ageFromSnapshot = daysBetween(created, snapshot.date);
    if (ageFromSnapshot <= 30) person.recent30 += 1;
    if (ageFromSnapshot <= 7) person.recent7 += 1;

    for (const keyword of module.keywords || []) {
      const key = String(keyword).toLowerCase();
      person.keywords[key] = (person.keywords[key] || 0) + 1;
    }
    const category = categoryFor(module);
    person.categories[category] = (person.categories[category] || 0) + 1;
    categories[category] = (categories[category] || 0) + 1;

    const license = module.license || "(未填写)";
    licenses[license] = (licenses[license] || 0) + 1;
    person.licenses[license] = (person.licenses[license] || 0) + 1;

    if (!module.repository) {
      repoMissing += 1;
      person.repoMissing += 1;
    } else {
      person.repoCount += 1;
      if (module.repository.includes("github.com/moonbit-community")) repoCommunity += 1;
      else if (module.repository.includes("github.com")) repoGithub += 1;
    }

    if (!daily.has(created)) {
      daily.set(created, { date: created, count: 0, owners: new Set(), modules: [] });
    }
    const day = daily.get(created);
    day.count += 1;
    day.owners.add(owner);
    day.modules.push(module.name);
  }

  const contributors = Array.from(owners.values()).map((person) => {
    const topCategories = topEntries(person.categories, 3);
    const topKeywords = topEntries(person.keywords, 5);
    const profile = githubProfiles[person.owner] || null;
    const location = normalizeLocation(profile?.location);
    const identity = identityFor(profile, { ...person, topKeywords });
    const signals = [];
    if (person.count >= 20) signals.push("核心高产");
    if (person.recent30 >= 5) signals.push("近期活跃");
    if (person.count === 1) signals.push("一次性贡献");
    if (person.repoMissing / person.count >= 0.5) signals.push("仓库缺失偏高");
    if (daysBetween(person.last, snapshot.date) >= 180) signals.push("可能沉寂");
    if (!profile) signals.push("GitHub 未覆盖");
    if (profile && !profile.location) signals.push("地区未填写");
    if (profile && !profile.company && !profile.bio) signals.push("身份线索少");
    if (profile) {
      locations[location] = (locations[location] || 0) + 1;
      identities[identity] = (identities[identity] || 0) + 1;
    }
    return {
      ...person,
      profile,
      location,
      identity,
      topCategories,
      topKeywords,
      signals,
      searchText: [
        person.owner,
        profile?.name || "",
        profile?.company || "",
        profile?.location || "",
        profile?.bio || "",
        location,
        identity,
        person.modules.map((m) => m.name).join(" "),
        topKeywords.map(([key]) => key).join(" "),
        signals.join(" ")
      ].join(" ").toLowerCase()
    };
  }).sort((a, b) => b.count - a.count || b.recent30 - a.recent30 || a.owner.localeCompare(b.owner));

  const dailyRows = Array.from(daily.values())
    .map((day) => ({ ...day, ownerCount: day.owners.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recent30 = dailyRows.filter((day) => daysBetween(day.date, snapshot.date) <= 30);
  const recent7 = dailyRows.filter((day) => daysBetween(day.date, snapshot.date) <= 7);
  const previous7 = dailyRows.filter((day) => {
    const age = daysBetween(day.date, snapshot.date);
    return age > 7 && age <= 14;
  });
  const recent30Count = recent30.reduce((sum, day) => sum + day.count, 0);
  const recent7Count = recent7.reduce((sum, day) => sum + day.count, 0);
  const previous7Count = previous7.reduce((sum, day) => sum + day.count, 0);
  const active30Owners = new Set(modules.filter((m) => daysBetween(dayKey(m.created_at), snapshot.date) <= 30).map((m) => ownerOf(m.name))).size;
  const singleOwners = contributors.filter((person) => person.count === 1).length;
  const top10Count = contributors.slice(0, 10).reduce((sum, person) => sum + person.count, 0);
  const top20Count = contributors.slice(0, 20).reduce((sum, person) => sum + person.count, 0);

  const issues = buildIssues({
    modules,
    contributors,
    singleOwners,
    top10Count,
    top20Count,
    repoMissing,
    recent7Count,
    previous7Count,
    recent30Count,
    active30Owners,
    categories,
    githubMeta,
    snapshot
  });

  return {
    modules,
    stats,
    contributors,
    dailyRows,
    categories,
    locations,
    identities,
    licenses,
    githubProfiles,
    githubMeta,
    repo: { missing: repoMissing, github: repoGithub, community: repoCommunity },
    recent30Count,
    recent7Count,
    previous7Count,
    active30Owners,
    singleOwners,
    top10Count,
    top20Count,
    issues
  };
}

function buildIssues(context) {
  const total = context.modules.length || 1;
  const ownerTotal = context.contributors.length || 1;
  const issues = [];
  const top10Share = context.top10Count / total;
  const singleShare = context.singleOwners / ownerTotal;
  const missingRepoShare = context.repoMissing / total;
  const delta7 = context.previous7Count ? (context.recent7Count - context.previous7Count) / context.previous7Count : 0;
  const aiShare = (context.categories["AI/LLM"] || 0) / total;
  const githubCoverage = (context.githubMeta?.profiles_available || 0) / ownerTotal;

  if (top10Share >= 0.4) {
    issues.push({
      severity: "high",
      title: `头部集中度偏高：Top 10 贡献 ${fmtPct(top10Share)}`,
      body: "生态增长高度依赖少数高产 owner。适合重点维护头部关系，同时用专题激励腰部贡献者。"
    });
  }
  if (singleShare >= 0.5) {
    issues.push({
      severity: "medium",
      title: `长尾留存压力：${context.singleOwners} 个 owner 只发 1 个模块`,
      body: "入口吸引力不错，但二次贡献不足。可以补发布模板、包质量反馈、每周推荐来推动复投。"
    });
  }
  if (missingRepoShare >= 0.18) {
    issues.push({
      severity: "medium",
      title: `透明度缺口：${fmtNumber(context.repoMissing)} 个模块未填写 repository`,
      body: "缺仓库链接会影响信任、复用和协作。建议把 repository 完整率作为包质量指标。"
    });
  }
  if (delta7 < -0.25) {
    issues.push({
      severity: "medium",
      title: `近 7 天新增放缓：环比 ${fmtPct(delta7)}`,
      body: "短周期新增下降，需要看是否是自然波动，或是否缺少活动、文档、示例带动。"
    });
  } else if (delta7 > 0.25) {
    issues.push({
      severity: "low",
      title: `近 7 天新增提速：环比 +${fmtPct(delta7)}`,
      body: "近期有明显增长，可以追踪来源 owner 和主题，及时做案例扩散。"
    });
  }
  if (aiShare < 0.08) {
    issues.push({
      severity: "low",
      title: `AI/LLM 相关占比 ${fmtPct(aiShare)}，还不是主赛道`,
      body: "如果要强调 AI 原生生态，需要更多 agent、SDK、评测、工具调用类包作为证据。"
    });
  }
  if (githubCoverage > 0 && githubCoverage < 0.8) {
    issues.push({
      severity: "low",
      title: `GitHub 画像覆盖 ${fmtPct(githubCoverage)}，还有缺口`,
      body: "未配置 GITHUB_TOKEN 时会受 GitHub API 限制。可以先看头部贡献者，配置 token 后再做全量画像。"
    });
  }
  return issues.slice(0, 6);
}

function render() {
  const analysis = state.analysis;
  if (!analysis) return;
  renderSummary();
  renderDaily();
  renderIssues();
  renderTiers();
  renderCategories();
  renderGithubPanels();
  renderContributors();
}

function renderSummary() {
  const a = state.analysis;
  const s = state.snapshot;
  const total = a.modules.length || 1;
  const ownerTotal = a.contributors.length || 1;
  const metrics = [
    ["总模块", fmtNumber(a.modules.length), `mooncakes 统计接口：${fmtNumber(a.stats.total_packages)} packages`],
    ["贡献者 owner", fmtNumber(a.contributors.length), `${fmtNumber(a.singleOwners)} 个只发 1 个模块`],
    ["今日新增", fmtNumber((a.dailyRows.find((day) => day.date === s.date) || {}).count), `${s.date} 的模块 created_at`],
    ["近 30 天新增", fmtNumber(a.recent30Count), `${fmtNumber(a.active30Owners)} 个 owner 参与`],
    ["Top 10 占比", fmtPct(a.top10Count / total), `Top 20 占比 ${fmtPct(a.top20Count / total)}`],
    ["GitHub 覆盖", fmtPct((a.githubMeta.profiles_available || 0) / ownerTotal), `${fmtNumber(a.githubMeta.profiles_available || 0)} / ${fmtNumber(ownerTotal)} 个 owner`]
  ];
  els.summaryGrid.innerHTML = metrics.map(([label, value, note]) => `
    <div class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </div>
  `).join("");
  const cachedText = s.cached ? "今日已分析" : "今日新分析";
  els.statusPill.textContent = `${cachedText} ${s.date}`;
}

function selectedDailyRows() {
  const rows = state.analysis.dailyRows;
  if (state.range === "all") return rows;
  const limit = Number(state.range);
  return rows.filter((day) => daysBetween(day.date, state.snapshot.date) < limit);
}

function renderDaily() {
  const rows = selectedDailyRows();
  drawChart(rows);
  els.dailyRows.innerHTML = rows.slice().reverse().map((day) => `
    <tr>
      <td>${day.date}</td>
      <td><strong>${fmtNumber(day.count)}</strong></td>
      <td>${fmtNumber(day.ownerCount)}</td>
      <td class="subtle">${day.modules.slice(0, 4).map(moduleShort).join("、")}${day.modules.length > 4 ? " ..." : ""}</td>
    </tr>
  `).join("");
}

function drawChart(rows) {
  const canvas = els.dailyChart;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(220, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 16, right: 18, bottom: 44, left: 42 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;
  const max = Math.max(1, ...rows.map((day) => day.count));

  ctx.strokeStyle = "#dce5ea";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#66737f";
  ctx.font = "12px system-ui";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + width, y);
    ctx.stroke();
    const label = Math.round(max - (max * i) / 4);
    ctx.fillText(label, 8, y + 4);
  }

  const barGap = rows.length > 60 ? 1 : 3;
  const barWidth = Math.max(2, width / Math.max(rows.length, 1) - barGap);
  rows.forEach((day, index) => {
    const x = padding.left + index * (width / Math.max(rows.length, 1));
    const barHeight = (day.count / max) * height;
    const y = padding.top + height - barHeight;
    ctx.fillStyle = day.date === state.snapshot.date ? "#b76145" : "#4c80a8";
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  ctx.fillStyle = "#66737f";
  ctx.textAlign = "left";
  if (rows[0]) ctx.fillText(rows[0].date, padding.left, rect.height - 16);
  ctx.textAlign = "right";
  if (rows.at(-1)) ctx.fillText(rows.at(-1).date, rect.width - padding.right, rect.height - 16);
}

function renderIssues() {
  els.issueList.innerHTML = state.analysis.issues.map((issue) => `
    <div class="issue-card severity-${issue.severity}">
      <strong>${issue.title}</strong>
      <p>${issue.body}</p>
    </div>
  `).join("");
}

function renderTiers() {
  const contributors = state.analysis.contributors;
  const tiers = [
    ["核心高产", contributors.filter((person) => person.count >= 20), "20 个以上模块，适合重点维护、访谈、专题扩散。"],
    ["稳定腰部", contributors.filter((person) => person.count >= 5 && person.count < 20), "5-19 个模块，是生态扩张和复投的关键人群。"],
    ["轻量贡献", contributors.filter((person) => person.count >= 2 && person.count < 5), "已经完成二次贡献，适合用模板和反馈继续拉升。"],
    ["一次性贡献", contributors.filter((person) => person.count === 1), "只发布 1 个模块，反映留存和持续贡献压力。"]
  ];
  els.tierList.innerHTML = tiers.map(([name, people, note]) => `
    <div class="tier-card">
      <strong>${name}：${fmtNumber(people.length)} 人</strong>
      <p>${note}</p>
      <div class="pill-row">${people.slice(0, 10).map((person) => `<span class="tag">${person.owner}</span>`).join("")}</div>
    </div>
  `).join("");
}

function renderCategories() {
  const entries = topEntries(state.analysis.categories, 12);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  els.categoryList.innerHTML = entries.map(([name, value]) => `
    <div class="bar-item">
      <div>${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
      <strong>${fmtNumber(value)}</strong>
    </div>
  `).join("");
}

function renderGithubPanels() {
  renderBarList(els.locationList, state.analysis.locations, 12);
  renderBarList(els.identityList, state.analysis.identities, 12);
}

function renderBarList(container, data, limit) {
  const entries = topEntries(data, limit);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  if (!entries.length) {
    container.innerHTML = `<div class="loading">还没有 GitHub 公开资料。未配置 GITHUB_TOKEN 时，首次抓取可能只能覆盖头部贡献者。</div>`;
    return;
  }
  container.innerHTML = entries.map(([name, value]) => `
    <div class="bar-item">
      <div>${name}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
      <strong>${fmtNumber(value)}</strong>
    </div>
  `).join("");
}

function renderContributors() {
  const query = state.search.trim().toLowerCase();
  const rows = state.analysis.contributors
    .filter((person) => !query || person.searchText.includes(query))
    .slice(0, 300);

  els.contributorRows.innerHTML = rows.map((person) => {
    const category = person.topCategories.map(([name, value]) => `${name} ${value}`).join(" / ") || "通用";
    const tags = person.signals.length ? person.signals : ["正常"];
    const modules = person.modules
      .slice()
      .sort((a, b) => dayKey(b.created_at).localeCompare(dayKey(a.created_at)))
      .slice(0, 6)
      .map((module) => moduleShort(module.name));
    const profile = person.profile;
    const profileHtml = profile ? `
      <div class="profile-cell">
        <a href="${profile.html_url}" target="_blank" rel="noreferrer">${profile.name || profile.login || person.owner}</a>
        <div class="subtle">${profile.location || "地区未填写"}</div>
        <div class="subtle">${cleanCompany(profile.company) || "组织未填写"}</div>
        <div class="subtle">followers ${fmtNumber(profile.followers)} / repos ${fmtNumber(profile.public_repos)}</div>
      </div>
    ` : `<span class="subtle">未抓取</span>`;
    return `
      <tr>
        <td class="owner-cell">${person.owner}<div class="subtle">${person.first} 至 ${person.last}</div></td>
        <td>${profileHtml}</td>
        <td><strong>${fmtNumber(person.count)}</strong></td>
        <td>${person.last}</td>
        <td>${fmtNumber(person.recent30)} / 30 天</td>
        <td>${category}<div class="subtle">${person.topKeywords.map(([key]) => key).join("、")}</div></td>
        <td><span class="tag hot">${person.identity}</span><div class="subtle">${person.location}</div></td>
        <td><div class="pill-row">${tags.map((tag) => `<span class="tag ${tag.includes("缺失") || tag.includes("沉寂") ? "risk" : tag.includes("活跃") || tag.includes("核心") ? "hot" : "warn"}">${tag}</span>`).join("")}</div></td>
        <td class="subtle">${modules.join("、")}</td>
      </tr>
    `;
  }).join("");
}

async function load(force = false) {
  els.refreshBtn.disabled = true;
  els.statusPill.textContent = force ? "刷新中" : "分析中";
  els.summaryGrid.innerHTML = `<div class="loading" style="grid-column:1 / -1">正在拉取 mooncakes.io 数据并生成今日快照...</div>`;
  try {
    state.snapshot = await fetchSnapshot(force);
    state.analysis = analyze(state.snapshot);
    render();
  } catch (error) {
    els.statusPill.textContent = "分析失败";
    els.summaryGrid.innerHTML = `<div class="loading" style="grid-column:1 / -1">分析失败：${error.message}</div>`;
  } finally {
    els.refreshBtn.disabled = false;
  }
}

async function fetchSnapshot(force) {
  const isLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  if (isLocal) {
    try {
      const response = await fetch(`api/analyze${force ? "?force=1" : ""}`);
      if (response.ok) return response.json();
    } catch {
      // Fall back to static data.
    }
  }
  const response = await fetch(`data/latest.json?ts=${force ? Date.now() : ""}`);
  if (!response.ok) throw new Error(`静态数据读取失败：HTTP ${response.status}`);
  const snapshot = await response.json();
  return { ...snapshot, cached: true };
}

els.refreshBtn.addEventListener("click", () => load(true));
els.rangeSelect.addEventListener("change", (event) => {
  state.range = event.target.value;
  renderDaily();
});
els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderContributors();
});
window.addEventListener("resize", () => {
  if (state.analysis) drawChart(selectedDailyRows());
});

load(false);
