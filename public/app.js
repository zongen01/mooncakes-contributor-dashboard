const state = {
  snapshot: null,
  analysis: null,
  range: "7",
  search: ""
};

const ANALYSIS_DAYS = 7;

const els = {
  statusPill: document.querySelector("#statusPill"),
  refreshBtn: document.querySelector("#refreshBtn"),
  summaryGrid: document.querySelector("#summaryGrid"),
  newUserContributionSummary: document.querySelector("#newUserContributionSummary"),
  newUserContributionNote: document.querySelector("#newUserContributionNote"),
  newUserContributionRows: document.querySelector("#newUserContributionRows"),
  registeredNoContributionNote: document.querySelector("#registeredNoContributionNote"),
  registeredNoContributionRows: document.querySelector("#registeredNoContributionRows"),
  dailyChart: document.querySelector("#dailyChart"),
  dailyRows: document.querySelector("#dailyRows"),
  issueList: document.querySelector("#issueList"),
  newcomerSummary: document.querySelector("#newcomerSummary"),
  newcomerLocationList: document.querySelector("#newcomerLocationList"),
  newcomerIdentityList: document.querySelector("#newcomerIdentityList"),
  newcomerSourceList: document.querySelector("#newcomerSourceList"),
  newcomerInsightList: document.querySelector("#newcomerInsightList"),
  newcomerFocusNote: document.querySelector("#newcomerFocusNote"),
  newcomerFocusList: document.querySelector("#newcomerFocusList"),
  newcomerMapNote: document.querySelector("#newcomerMapNote"),
  newcomerModuleMap: document.querySelector("#newcomerModuleMap"),
  dataReconcileList: document.querySelector("#dataReconcileList"),
  newcomerRows: document.querySelector("#newcomerRows"),
  tierList: document.querySelector("#tierList"),
  categoryList: document.querySelector("#categoryList"),
  locationList: document.querySelector("#locationList"),
  identityList: document.querySelector("#identityList"),
  contributorRows: document.querySelector("#contributorRows"),
  contributorCountNote: document.querySelector("#contributorCountNote"),
  olderContributorPanel: document.querySelector("#olderContributorPanel"),
  olderContributorSummary: document.querySelector("#olderContributorSummary"),
  olderContributorRows: document.querySelector("#olderContributorRows"),
  rangeSelect: document.querySelector("#rangeSelect"),
  searchInput: document.querySelector("#searchInput")
};

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function fmtPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dayKey(dateLike) {
  const parsed = new Date(dateLike);
  return Number.isNaN(parsed.getTime()) ? String(dateLike || "").slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function fmtUtcDateTime(dateLike) {
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return `${String(dateLike || "-")} UTC`;
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function isWithinUtcWindow(dateLike, snapshotDate, days = ANALYSIS_DAYS) {
  const age = daysBetween(dayKey(dateLike), snapshotDate);
  return age >= 0 && age < days;
}

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function moduleShort(moduleName) {
  return String(moduleName || "").split("/").slice(1).join("/") || moduleName;
}

function moduleFirstPublishedAt(module) {
  return module?.first_published_at || module?.created_at || "";
}

function moduleLastPublishedAt(module) {
  return module?.last_published_at || module?.created_at || "";
}

function safeWebUrl(url) {
  const text = String(url || "").trim();
  return /^https?:\/\//i.test(text) ? text : "";
}

function externalLink(url, label) {
  const safeUrl = safeWebUrl(url);
  const safeLabel = escapeHtml(label);
  return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${safeLabel}</a>` : safeLabel;
}

function topEntries(obj, limit = 8) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function cleanCompany(company) {
  return String(company || "").replace(/^@+/, "").trim();
}

function hasUsableProfile(profile) {
  return Boolean(profile && profile.exists !== false && !profile.error);
}

function hasAiPortrait(portrait) {
  return Boolean(portrait && !portrait.error && portrait.summary && Number.isFinite(Number(portrait.confidence)));
}

const UNKNOWN_LOCATION = "未公开/不可判定";

function normalizeLocation(location) {
  const raw = String(location || "").trim();
  if (!raw) return UNKNOWN_LOCATION;
  const lower = raw
    .toLowerCase()
    .replace(/[，、|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(earth|world|global|internet|your computer|your heart|location|r|ua|gmt ?[+-]?\d+|utc ?[+-]?\d+|127\.0\.0\.1|localhost|overworld|complex manifold|the peach blossom spring|as16-.+)$/i.test(lower)) {
    return UNKNOWN_LOCATION;
  }
  if (/^(miraland|璃月港|阿宅专属宿舍|『.*』)$/.test(raw)) return UNKNOWN_LOCATION;
  if (/\b(prc|china|beijing|shanghai|shenzhen|hangzhou|guangzhou|nanjing|chengdu|wuhan|xian|xi'an|chongqing|tianjin|zhuhai|hefei|urumqi|xinjiang|guangxi|guangdong|zhejiang|jiangsu|jiangxi|henan|liaoning|shenyang|dalian|xiamen|quanzhou|lanzhou|nanchang|changzhou|shihezi)\b/.test(lower) || /中国|北京|上海|深圳|杭州|广州|南京|成都|武汉|西安|重庆|天津|珠海|合肥|新疆|广西|广东|浙江|江苏|江西|河南|辽宁|沈阳|大连|厦门|泉州|兰州|南昌|常州|石河子/.test(raw)) return "中国";
  if (/\b(japan|tokyo|osaka|kyoto|yokohama|saitama|iwate|fukuoka)\b/.test(lower) || /日本|東京|东京|大阪|京都|横滨/.test(raw)) return "日本";
  if (/\b(singapore)\b/.test(lower) || /新加坡/.test(raw)) return "新加坡";
  if (/\b(united states|usa|u\.s\.|california|san francisco|new york|nyc|seattle|boston|austin|orlando|berkeley|bay area|pittsburgh|new haven|macon)\b/.test(lower) || /\b(ca|ny|pa|ct|fl|ga)\b/.test(lower) || /美国/.test(raw)) return "美国";
  if (/\b(canada|toronto|vancouver|ottawa)\b/.test(lower) || /\b(on|bc)\b/.test(lower) || /加拿大/.test(raw)) return "加拿大";
  if (/\b(germany|berlin|munich|hamburg|deutschland)\b/.test(lower) || /德国/.test(raw)) return "德国";
  if (/\b(france|paris|antibes)\b/.test(lower) || /法国/.test(raw)) return "法国";
  if (/\b(united kingdom|uk|london|england|reading|bristol)\b/.test(lower) || /英国/.test(raw)) return "英国";
  if (/\b(india|bangalore)\b/.test(lower) || /印度/.test(raw)) return "印度";
  if (/\b(taiwan|taipei)\b/.test(lower) || /台湾|台北/.test(raw)) return "中国台湾";
  if (/\b(hong kong)\b/.test(lower) || /香港/.test(raw)) return "中国香港";
  if (/\b(switzerland|zurich)\b/.test(lower)) return "瑞士";
  if (/\b(italy|rome)\b/.test(lower)) return "意大利";
  return "其他公开地区";
}

function inferIdentity(profile, person) {
  if (!hasUsableProfile(profile)) {
    return {
      label: "GitHub 资料未覆盖",
      confidence: 0,
      evidence: ["导出站点未提供可用 GitHub 映射资料"]
    };
  }
  const company = cleanCompany(profile?.company);
  const profileText = `${profile?.name || ""} ${profile?.type || ""} ${company} ${profile?.bio || ""}`.toLowerCase();
  const moduleText = `${person.topCategories?.map(([key]) => key).join(" ") || ""} ${person.topKeywords?.map(([key]) => key).join(" ") || ""}`.toLowerCase();
  if ((profile?.type || "").toLowerCase() === "organization") {
    return { label: "组织账号", confidence: 0.92, evidence: ["GitHub type=Organization"] };
  }
  if (/(university|college|institute|school|lab|research|academy|大学|学院|研究|实验室)/.test(profileText)) {
    return { label: "高校/研究机构线索", confidence: 0.78, evidence: ["公开资料含学校/研究机构关键词"] };
  }
  if (/(compiler|programming language|language engineer|parser|tree-sitter|wasm|ffi|native|toolchain|\bpl\b)/.test(profileText)) {
    return { label: "语言/工具链开发者", confidence: 0.72, evidence: ["公开 bio/company 含语言或工具链关键词"] };
  }
  if (/(ai|llm|agent|machine learning|openai|anthropic|genai)/.test(profileText)) {
    return { label: "AI/LLM 开发者", confidence: 0.72, evidence: ["公开 bio/company 含 AI 关键词"] };
  }
  if (/(game|graphics|canvas|svg|render|audio|engine|font|pdf)/.test(profileText)) {
    return { label: "图形/游戏/媒体开发者", confidence: 0.68, evidence: ["公开资料含图形/媒体关键词"] };
  }
  if (/(web|frontend|front-end|react|dom|css|http|server|browser|ui)/.test(profileText)) {
    return { label: "Web/前端/网络开发者", confidence: 0.68, evidence: ["公开资料含 Web/前端关键词"] };
  }
  if (/(语言\/工具链|开发工具|工程化)/.test(moduleText)) {
    return { label: "贡献方向：工具链/工程化", confidence: 0.52, evidence: ["根据模块关键词推断贡献方向"] };
  }
  if (/ai\/llm/.test(moduleText)) {
    return { label: "贡献方向：AI/LLM", confidence: 0.52, evidence: ["根据模块关键词推断贡献方向"] };
  }
  if (/图形\/游戏\/媒体/.test(moduleText)) {
    return { label: "贡献方向：图形/媒体", confidence: 0.5, evidence: ["根据模块关键词推断贡献方向"] };
  }
  if (company) return { label: "有组织归属线索", confidence: 0.56, evidence: ["公开 company 已填写"] };
  if (profile?.bio) return { label: "个人开发者", confidence: 0.48, evidence: ["公开 bio 已填写，但缺少明确方向"] };
  return { label: "公开资料较少", confidence: 0.24, evidence: ["GitHub 公开资料字段较少"] };
}

function inferSource(person, profile, snapshotDate) {
  const recentModules = person.modules.filter((module) => isWithinUtcWindow(moduleLastPublishedAt(module), snapshotDate));
  const repositories = recentModules.map((module) => String(module.repository || "")).filter(Boolean);
  const company = cleanCompany(profile?.company);
  const profileText = `${profile?.type || ""} ${profile?.name || ""} ${company} ${profile?.bio || ""}`.toLowerCase();

  if ((profile?.type || "").toLowerCase() === "organization") {
    return { label: "GitHub 组织账号", evidence: "GitHub type=Organization" };
  }
  if (repositories.some((repo) => /github\.com\/moonbit-community|github\.com\/moonbitlang/i.test(repo))) {
    return { label: "MoonBit 社区仓库", evidence: "近期活跃模块 repository 指向 moonbit-community/moonbitlang" };
  }
  if (/(university|college|institute|school|lab|research|academy|大学|学院|研究|实验室)/.test(profileText)) {
    return { label: "高校/研究机构公开资料", evidence: "GitHub company/bio/name 含高校或研究机构线索" };
  }
  if (company) {
    return { label: "组织字段公开", evidence: `GitHub company=${company}` };
  }
  if (repositories.length) {
    const githubRepos = repositories.filter((repo) => /github\.com/i.test(repo)).length;
    return {
      label: githubRepos ? "个人 GitHub 仓库" : "外部仓库链接",
      evidence: `近 7 天活跃模块 ${repositories.length} 个填写 repository`
    };
  }
  if (profile?.location || profile?.bio) {
    return { label: "GitHub 公开资料", evidence: "公开 location/bio 可作为来源线索" };
  }
  return { label: "来源线索不足", evidence: "GitHub 公开资料少，近期活跃模块 repository 也不足" };
}

function newcomerActionFor(person) {
  if (hasAiPortrait(person.aiPortrait) && person.aiPortrait.suggested_action) return `AI建议：${person.aiPortrait.suggested_action}`;
  if (person.portrait?.priority === "P0") return "重点跟进：可邀约交流、案例共创或社区专题";
  if (person.portrait?.priority === "P1") return "优先观察：适合加入新增贡献者名单并轻触达";
  if (person.count >= 3 || person.recent7 >= 3) return "优先关注，可邀约交流或案例复盘";
  if (person.identity === "语言/工具链开发者") return "适合邀请参与工具链/基础库专题";
  if (person.identity === "AI/LLM 开发者") return "适合追踪 AI 原生案例";
  if (person.identity === "高校/研究机构线索") return "适合纳入校园/研究者触达";
  if (person.identity.startsWith("贡献方向：")) return "先按模块方向观察，避免过度判断个人身份";
  if (person.identity === "公开资料较少" || person.identity === "GitHub 资料未覆盖" || person.signals.includes("身份线索少")) return "先观察模块质量，补充公开信息线索";
  return "加入新增贡献者观察名单";
}

function buildContributorPortrait(person, snapshotDate) {
  const profile = person.profile;
  const usableProfile = hasUsableProfile(profile);
  const aiPortrait = hasAiPortrait(person.aiPortrait) ? person.aiPortrait : null;
  const accountAgeDays = profile?.created_at ? daysBetween(dayKey(profile.created_at), snapshotDate) : null;
  const activeSpanDays = daysBetween(person.first, person.last);
  const repoRatio = person.count ? person.repoCount / person.count : 0;
  const profileFields = [
    profile?.name,
    profile?.bio,
    profile?.location,
    profile?.company,
    profile?.blog,
    profile?.twitter_username
  ];
  const profileScore = usableProfile ? profileFields.filter(Boolean).length / profileFields.length : 0;
  const followers = profile?.followers || 0;
  const publicRepos = profile?.public_repos || 0;
  const primaryCategory = person.topCategories?.[0]?.[0] || "通用/实验";
  const hasReliableLocation = person.location && person.location !== UNKNOWN_LOCATION;
  const confidenceRaw =
    (usableProfile ? 0.2 : 0) +
    ((profile?.bio || profile?.company) ? 0.18 : 0) +
    (hasReliableLocation ? 0.14 : 0) +
    (person.count >= 2 ? 0.14 : 0) +
    (repoRatio >= 0.6 ? 0.14 : 0) +
    ((person.identityConfidence || 0) * 0.2);
  const confidence = Math.min(0.95, confidenceRaw);

  let accountAgeLabel = "GitHub 资历未知";
  if (usableProfile && accountAgeDays !== null) {
    if (accountAgeDays >= 3650) accountAgeLabel = "10 年以上 GitHub 老用户";
    else if (accountAgeDays >= 1825) accountAgeLabel = "5 年以上 GitHub 用户";
    else if (accountAgeDays >= 730) accountAgeLabel = "2 年以上 GitHub 用户";
    else accountAgeLabel = "较新的 GitHub 账号";
  }

  let influenceLabel = "公开影响力较低";
  if (followers >= 1000) influenceLabel = "高公开影响力";
  else if (followers >= 200) influenceLabel = "较高公开影响力";
  else if (followers >= 50) influenceLabel = "中等公开影响力";
  else if (publicRepos >= 50) influenceLabel = "仓库活跃但粉丝较少";

  let paceLabel = "试水型贡献者";
  if (person.count >= 20 || person.versionCount >= 30) paceLabel = "核心高产贡献者";
  else if (person.versionCount >= 5 && activeSpanDays >= 90) paceLabel = "持续发布型";
  else if (person.recentReleaseCount >= 3 && person.recentReleaseCount / Math.max(person.versionCount, 1) >= 0.7) paceLabel = "近期集中发布型";
  else if (person.versionCount >= 2) paceLabel = "已有再次发布";

  let transparencyLabel = "仓库透明度偏低";
  if (repoRatio >= 0.9) transparencyLabel = "仓库透明度高";
  else if (repoRatio >= 0.6) transparencyLabel = "仓库透明度中等";

  let profileLabel = "公开资料较少";
  if (profileScore >= 0.65) profileLabel = "公开资料较完整";
  else if (profileScore >= 0.35) profileLabel = "公开资料中等";

  let priority = aiPortrait?.priority || "P2";
  let priorityReason = "先观察模块质量、公开资料和后续发布";
  if (
    person.count >= 5 ||
    (usableProfile && followers >= 200) ||
    (person.count >= 3 && repoRatio >= 0.6) ||
    (person.identityConfidence >= 0.68 && ["语言/工具链开发者", "AI/LLM 开发者", "高校/研究机构线索"].includes(person.identity))
  ) {
    priority = "P1";
    priorityReason = "有较明确公开线索或持续发布迹象";
  }
  if (person.count >= 10 || (usableProfile && followers >= 1000) || (person.recent7 >= 5 && repoRatio >= 0.8)) {
    priority = "P0";
    priorityReason = "高产或高影响力，值得重点跟进";
  }
  if (aiPortrait && aiPortrait.priority === "P0" && priority !== "P0") {
    priority = "P1";
    priorityReason = "AI 画像提示有重点观察价值，先按 P1 跟进";
  }

  return {
    accountAgeLabel,
    influenceLabel,
    paceLabel,
    transparencyLabel,
    profileLabel,
    priority,
    priorityReason,
    confidence: aiPortrait ? Math.max(confidence, Math.min(0.95, Number(aiPortrait.confidence))) : confidence,
    primaryCategory,
    repoRatio,
    profileScore,
    followers,
    publicRepos,
    activeSpanDays,
    evidence: person.identityEvidence || [],
    aiPortrait
  };
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
  const moduleHistory = snapshot.module_history || {};
  const ownerHistory = snapshot.owner_history || {};
  const aiPortraits = snapshot.ai_portraits || {};
  const aiMeta = snapshot.ai_meta || { enabled: false };
  const rawGithubMeta = snapshot.github_meta || {};
  const githubProfileAvailable = Object.values(githubProfiles).filter(hasUsableProfile).length;
  const githubMeta = {
    ...rawGithubMeta,
    profiles_available: githubProfileAvailable,
    requested: Object.keys(githubProfiles).length,
    invalid_profiles: Object.values(githubProfiles).filter((profile) => profile && !hasUsableProfile(profile)).length
  };
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
    const created = dayKey(moduleLastPublishedAt(module));
    const firstPublished = dayKey(moduleFirstPublishedAt(module));
    if (!owners.has(owner)) {
      owners.set(owner, {
        owner,
        count: 0,
        first: "",
        last: "",
        recent7: 0,
        recentReleaseCount: 0,
        versionCount: 0,
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
    const history = moduleHistory[module.name] || {};
    const releaseDays = Object.entries(history.release_days || {});
    const moduleVersionCount = Number(history.version_count ?? module.version_count ?? 1);
    const moduleRecentReleaseCount = releaseDays.length
      ? releaseDays.reduce((sum, [date, count]) => sum + (isWithinUtcWindow(date, snapshot.date) ? Number(count || 0) : 0), 0)
      : (isWithinUtcWindow(moduleLastPublishedAt(module), snapshot.date) ? 1 : 0);
    person.versionCount += moduleVersionCount;
    person.recentReleaseCount += moduleRecentReleaseCount;
    person.first = !person.first || created < person.first ? created : person.first;
    person.last = !person.last || created > person.last ? created : person.last;

    const ageFromSnapshot = daysBetween(created, snapshot.date);
    if (ageFromSnapshot >= 0 && ageFromSnapshot < ANALYSIS_DAYS) person.recent7 += 1;

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

    if (!daily.has(firstPublished)) {
      daily.set(firstPublished, { date: firstPublished, count: 0, owners: new Set(), modules: [] });
    }
    const day = daily.get(firstPublished);
    day.count += 1;
    day.owners.add(owner);
    day.modules.push(module.name);
  }

  const contributors = Array.from(owners.values()).map((person) => {
    const history = ownerHistory[person.owner] || {};
    if (history.first_seen) {
      person.first = dayKey(history.first_seen);
      person.firstSeenAt = history.first_seen;
    }
    if (history.last_seen) {
      person.last = dayKey(history.last_seen);
      person.lastSeenAt = history.last_seen;
    }
    person.versionCount = Number(history.version_count ?? person.versionCount);
    const topCategories = topEntries(person.categories, 3);
    const topKeywords = topEntries(person.keywords, 5);
    const rawProfile = githubProfiles[person.owner] || null;
    const profile = hasUsableProfile(rawProfile) ? rawProfile : null;
    const rawAiPortrait = aiPortraits[person.owner] || null;
    const aiPortrait = hasAiPortrait(rawAiPortrait) ? rawAiPortrait : null;
    const location = normalizeLocation(profile?.location);
    const identityInfo = inferIdentity(profile, { ...person, topCategories, topKeywords });
    const identity = aiPortrait?.identity_label ? `AI：${aiPortrait.identity_label}` : identityInfo.label;
    const identityConfidence = aiPortrait ? Math.max(identityInfo.confidence, Number(aiPortrait.confidence)) : identityInfo.confidence;
    const source = inferSource({ ...person, topCategories, topKeywords }, profile, snapshot.date);
    const signals = [];
    if (person.count >= 20) signals.push("核心高产");
    if (person.recent7 >= 3) signals.push("近7天活跃");
    if (person.count === 1) signals.push("单模块");
    if (person.versionCount === 1) signals.push("仅1次发布");
    if (person.repoMissing / person.count >= 0.5) signals.push("仓库缺失偏高");
    if (daysBetween(person.last, snapshot.date) >= 180) signals.push("可能沉寂");
    if (!profile) signals.push("GitHub 未覆盖");
    if (profile && location === UNKNOWN_LOCATION) signals.push("地区不可判定");
    if (profile && !profile.company && !profile.bio) signals.push("身份线索少");
    if (aiPortrait) signals.push("AI已分析");
    if (profile) {
      if (location !== UNKNOWN_LOCATION) locations[location] = (locations[location] || 0) + 1;
      identities[identity] = (identities[identity] || 0) + 1;
    }
    const portrait = buildContributorPortrait(
      {
        ...person,
        profile,
        location,
        identity,
        identityConfidence,
        identityEvidence: aiPortrait?.evidence || identityInfo.evidence,
        aiPortrait,
        topCategories,
        topKeywords,
        signals
      },
      snapshot.date
    );
    return {
      ...person,
      profile,
      rawProfile,
      rawAiPortrait,
      aiPortrait,
      location,
      identity,
      identityConfidence,
      identityEvidence: aiPortrait?.evidence || identityInfo.evidence,
      source,
      portrait,
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
        source.label,
        source.evidence,
        portrait.accountAgeLabel,
        portrait.influenceLabel,
        portrait.paceLabel,
        portrait.transparencyLabel,
        portrait.profileLabel,
        portrait.priority,
        aiPortrait?.summary || "",
        (aiPortrait?.tags || []).join(" "),
        person.modules.map((m) => m.name).join(" "),
        topKeywords.map(([key]) => key).join(" "),
        signals.join(" ")
      ].join(" ").toLowerCase()
    };
  }).sort((a, b) => b.recent7 - a.recent7 || b.count - a.count || a.owner.localeCompare(b.owner));

  const dailyRows = Array.from(daily.values())
    .map((day) => ({ ...day, ownerCount: day.owners.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recent7 = dailyRows.filter((day) => isWithinUtcWindow(day.date, snapshot.date));
  const previous7 = dailyRows.filter((day) => {
    const age = daysBetween(day.date, snapshot.date);
    return age >= ANALYSIS_DAYS && age < ANALYSIS_DAYS * 2;
  });
  const recent7Count = recent7.reduce((sum, day) => sum + day.count, 0);
  const previous7Count = previous7.reduce((sum, day) => sum + day.count, 0);
  const active7Owners = Number(snapshot.publication_windows?.recent7?.active_owner_count ?? new Set(modules.filter((module) => isWithinUtcWindow(moduleLastPublishedAt(module), snapshot.date)).map((module) => ownerOf(module.name))).size);
  const singleOwners = contributors.filter((person) => person.count === 1).length;
  const top10Count = contributors.slice(0, 10).reduce((sum, person) => sum + person.count, 0);
  const top20Count = contributors.slice(0, 20).reduce((sum, person) => sum + person.count, 0);
  const newcomers = buildNewcomerAnalysis(contributors, snapshot.date);

  const issues = buildIssues({
    modules,
    contributors,
    singleOwners,
    top10Count,
    top20Count,
    repoMissing,
    recent7Count,
    previous7Count,
    categories,
    githubMeta,
    snapshot
  });

  return {
    modules,
    stats,
    contributors,
    newcomers,
    dailyRows,
    categories,
    locations,
    identities,
    licenses,
    githubProfiles,
    aiPortraits,
    aiMeta,
    githubMeta,
    repo: { missing: repoMissing, github: repoGithub, community: repoCommunity },
    recent7Count,
    previous7Count,
    active7Owners,
    singleOwners,
    top10Count,
    top20Count,
    issues
  };
}

function buildNewcomerAnalysis(contributors, snapshotDate) {
  const in7 = contributors
    .filter((person) => isWithinUtcWindow(person.first, snapshotDate))
    .sort((a, b) => b.first.localeCompare(a.first) || b.count - a.count || a.owner.localeCompare(b.owner));
  const today = in7.filter((person) => person.first === snapshotDate);
  const locations = {};
  const identities = {};
  const sources = {};
  const categories = {};
  let withProfile = 0;
  let withLocation = 0;
  let withCompany = 0;
  let highConfidence = 0;
  let withAi = 0;
  let highConfidenceAi = 0;
  let singleModule = 0;
  let singleRelease = 0;

  for (const person of in7) {
    if (person.profile) withProfile += 1;
    if (person.aiPortrait) withAi += 1;
    locations[person.location] = (locations[person.location] || 0) + 1;
    identities[person.identity] = (identities[person.identity] || 0) + 1;
    sources[person.source.label] = (sources[person.source.label] || 0) + 1;
    if (person.location !== UNKNOWN_LOCATION) withLocation += 1;
    if (cleanCompany(person.profile?.company)) withCompany += 1;
    if ((person.portrait?.confidence || 0) >= 0.66) highConfidence += 1;
    if ((person.aiPortrait?.confidence || 0) >= 0.66) highConfidenceAi += 1;
    if (person.count === 1) singleModule += 1;
    if (person.versionCount === 1) singleRelease += 1;
    for (const [category, count] of person.topCategories) {
      categories[category] = (categories[category] || 0) + count;
    }
  }

  return {
    in7,
    today,
    locations,
    identities,
    sources,
    categories,
    withProfile,
    withLocation,
    withCompany,
    highConfidence,
    withAi,
    highConfidenceAi,
    singleModule,
    singleRelease
  };
}

function buildIssues(context) {
  const recentModules = context.modules.filter((module) => isWithinUtcWindow(moduleLastPublishedAt(module), context.snapshot.date));
  const recentContributors = context.contributors.filter((person) => person.recent7 > 0);
  const total = recentModules.length || 1;
  const activeOwnerTotal = recentContributors.length || 1;
  const newcomerContributors = recentContributors.filter((person) => isWithinUtcWindow(person.first, context.snapshot.date));
  const newcomerOwnerTotal = newcomerContributors.length || 1;
  const issues = [];
  const top10Share = recentContributors
    .slice()
    .sort((left, right) => right.recent7 - left.recent7 || right.count - left.count)
    .slice(0, 10)
    .reduce((sum, person) => sum + person.recent7, 0) / total;
  const singleOwners = newcomerContributors.filter((person) => person.count === 1).length;
  const singleShare = singleOwners / newcomerOwnerTotal;
  const missingRepoCount = recentModules.filter((module) => !module.repository).length;
  const missingRepoShare = missingRepoCount / total;
  const delta7 = context.previous7Count ? (context.recent7Count - context.previous7Count) / context.previous7Count : 0;
  const recentCategories = {};
  for (const module of recentModules) {
    const category = categoryFor(module);
    recentCategories[category] = (recentCategories[category] || 0) + 1;
  }
  const aiShare = (recentCategories["AI/LLM"] || 0) / total;
  const githubCoverage = recentContributors.filter((person) => person.profile).length / activeOwnerTotal;

  if (top10Share >= 0.4) {
    issues.push({
      severity: "high",
      title: `近 7 天头部集中度偏高：Top 10 贡献 ${fmtPct(top10Share)}`,
      body: "近期模块活跃高度依赖少数高产 owner。适合重点维护头部关系，同时追踪是否能带动更多贡献者持续发布。"
    });
  }
  if (singleShare >= 0.5) {
    issues.push({
      severity: "medium",
      title: `近 7 天新增 owner 单模块占比 ${fmtPct(singleShare)}`,
      body: `${singleOwners} / ${newcomerContributors.length} 位新增 owner 目前只发布 1 个模块。可以补发布模板、包质量反馈、每周推荐来推动第二次贡献。`
    });
  }
  if (missingRepoShare >= 0.18) {
    issues.push({
      severity: "medium",
      title: `近 7 天透明度缺口：${fmtNumber(missingRepoCount)} 个活跃模块未填写 repository`,
      body: "缺仓库链接会影响信任、复用和协作。建议把近 7 天活跃模块的 repository 完整率作为质量指标。"
    });
  }
  if (delta7 < -0.25) {
    issues.push({
      severity: "medium",
      title: `近 7 天新模块首发放缓：环比 ${fmtPct(delta7)}`,
      body: "短周期首次发布的新模块数量下降，需要看是否是自然波动，或是否缺少活动、文档、示例带动。"
    });
  } else if (delta7 > 0.25) {
    issues.push({
      severity: "low",
      title: `近 7 天新模块首发提速：环比 +${fmtPct(delta7)}`,
      body: "近期首次发布的新模块明显增长，可以追踪来源 owner 和主题，及时做案例扩散。"
    });
  }
  if (aiShare < 0.08) {
    issues.push({
      severity: "low",
      title: `近 7 天活跃模块中 AI/LLM 占比 ${fmtPct(aiShare)}，还不是主赛道`,
      body: "如果要强调 AI 原生生态，需要更多 agent、SDK、评测、工具调用类包形成持续发布证据。"
    });
  }
  if (githubCoverage > 0 && githubCoverage < 0.8) {
    issues.push({
      severity: "low",
      title: `近 7 天 GitHub 画像覆盖 ${fmtPct(githubCoverage)}，还有缺口`,
      body: "导出站点 users.csv 里部分 owner 缺少 GitHub login 或头像字段，可以先看近 7 天活跃贡献者，再回补映射数据。"
    });
  }
  return issues.slice(0, 6);
}

function render() {
  const analysis = state.analysis;
  if (!analysis) return;
  renderSummary();
  renderNewUserContributions();
  renderRegisteredNonContributors();
  renderDaily();
  renderIssues();
  renderNewcomers();
  renderDataReconciliation();
  renderTiers();
  renderCategories();
  renderGithubPanels();
  renderContributors();
}

function renderSummary() {
  const a = state.analysis;
  const s = state.snapshot;
  const derived = s.derived_metrics || {};
  const recentWindow = s.publication_windows?.recent7 || {};
  const recentWindowLabel = recentWindow.from && recentWindow.to ? `${recentWindow.from} 至 ${recentWindow.to} UTC` : "当前 7 个 UTC 自然日";
  const active7 = a.contributors.filter((person) => person.recent7 > 0);
  const active7Total = active7.length || 1;
  const activeModuleTotal = Number(derived.recent7_active_module_count ?? active7.reduce((sum, person) => sum + person.recent7, 0)) || 1;
  const recent7Top10 = active7
    .slice()
    .sort((left, right) => right.recent7 - left.recent7 || right.count - left.count)
    .slice(0, 10)
    .reduce((sum, person) => sum + person.recent7, 0);
  const active7Github = active7.filter((person) => person.profile).length;
  const active7Single = active7.filter((person) => person.count === 1).length;
  const metrics = [
    ["近7天活跃 owner", fmtNumber(derived.recent7_active_owner_count ?? active7.length), `${fmtNumber(activeModuleTotal)} 个活跃模块 · ${fmtNumber(derived.recent7_version_release_count ?? 0)} 次版本发布`],
    ["近7天新增 owner", fmtNumber(a.newcomers.in7.length), `${recentWindowLabel} 首次发布模块的 owner`],
    ["近7天新增模块", fmtNumber(derived.recent7_new_module_count ?? a.recent7Count), "首次发布时间落在当前 UTC 窗口"],
    ["近7天 GitHub 覆盖", fmtPct(active7Github / active7Total), `${fmtNumber(active7Github)} / ${fmtNumber(active7.length)} 个活跃 owner 可用`],
    ["近7天 Top10 占比", fmtPct(recent7Top10 / activeModuleTotal), `Top 10 覆盖 ${fmtNumber(recent7Top10)} 个近 7 天活跃模块`],
    ["近7天单模块 owner", fmtPct(active7Single / active7Total), `${fmtNumber(active7Single)} 个活跃 owner 当前只有 1 个模块`]
  ];
  els.summaryGrid.innerHTML = metrics.map(([label, value, note]) => `
    <div class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </div>
  `).join("");
  const cachedText = s.cached ? "快照已载入" : "源站已刷新";
  els.statusPill.textContent = `${cachedText} · ${fmtUtcDateTime(s.captured_at)}`;
}

function recentNewUserModules(person) {
  return person.modules
    .filter((module) => isWithinUtcWindow(moduleFirstPublishedAt(module), state.snapshot.date))
    .sort((left, right) => Date.parse(moduleFirstPublishedAt(right)) - Date.parse(moduleFirstPublishedAt(left)) || String(left.name).localeCompare(String(right.name)));
}

function renderNewUserContributions() {
  if (!els.newUserContributionSummary || !els.newUserContributionRows) return;
  const newcomers = state.analysis.newcomers;
  const people = newcomers.in7;
  const rows = people.map((person) => ({ person, modules: recentNewUserModules(person) }));
  const visibleRows = rows.slice(0, 60);
  const moduleCount = rows.reduce((sum, row) => sum + row.modules.length, 0);
  const downloads = rows.reduce((sum, row) => sum + row.modules.reduce((subtotal, module) => subtotal + Number(module.downloads || 0), 0), 0);
  const repeatPublishers = people.filter((person) => person.versionCount > 1).length;
  const recentWindow = state.snapshot.publication_windows?.recent7 || {};
  const registrationWindow = state.snapshot.registration_window || {};
  const recentWindowLabel = recentWindow.from && recentWindow.to ? `${recentWindow.from} 至 ${recentWindow.to} UTC` : "当前 7 个 UTC 自然日";
  const summary = [
    ["UTC 今日新用户", fmtNumber(newcomers.today.length), `${state.snapshot.date} UTC 首次贡献`],
    ["近 7 天新用户", fmtNumber(people.length), `${recentWindowLabel}，按 owner 历史首次贡献`],
    ["贡献模块", fmtNumber(moduleCount), "这些新用户在近 7 天发布的模块"],
    ["当前累计下载", fmtNumber(downloads), `${fmtNumber(repeatPublishers)} 位新用户已有第 2 次版本发布`],
    ["上周注册未贡献", fmtNumber(registrationWindow.no_contribution_count ?? 0), registrationWindow.from && registrationWindow.to ? `${registrationWindow.from} 至 ${registrationWindow.to} UTC，单独标记` : "上一完整 UTC 自然周"]
  ];

  els.newUserContributionSummary.innerHTML = summary.map(([label, value, note]) => `
    <div class="new-user-metric">
      <div class="metric-label">${label}</div>
      <div class="mini-metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </div>
  `).join("");

  if (els.newUserContributionNote) {
    const visibleNote = rows.length > visibleRows.length ? ` · 显示前 ${fmtNumber(visibleRows.length)} 位` : "";
    els.newUserContributionNote.textContent = `${fmtNumber(people.length)} 位新用户 · ${fmtNumber(moduleCount)} 个模块${visibleNote} · 截止 ${fmtUtcDateTime(state.snapshot.captured_at)}`;
  }

  if (!rows.length) {
    els.newUserContributionRows.innerHTML = `<div class="loading">近 7 天暂无首次贡献的新用户。</div>`;
    return;
  }

  els.newUserContributionRows.innerHTML = visibleRows.map(({ person, modules }) => {
    const contributionDownloads = modules.reduce((sum, module) => sum + Number(module.downloads || 0), 0);
    const moduleHtml = modules.slice(0, 8).map((module) => {
      const moduleName = externalLink(module.repository, moduleShort(module.name));
      return `
        <li>
          <div><strong>${moduleName}</strong><span>${categoryFor(module)}</span></div>
          <div><strong>${fmtNumber(module.downloads || 0)}</strong><span>下载</span></div>
          <time datetime="${moduleFirstPublishedAt(module)}">首发 ${fmtUtcDateTime(moduleFirstPublishedAt(module))}</time>
        </li>
      `;
    }).join("");
    const owner = externalLink(person.profile?.html_url, person.owner);
    return `
      <article class="new-user-contribution-card">
        <div class="new-user-identity">
          <span class="new-user-kicker">NEW CONTRIBUTOR</span>
          <strong>${owner}</strong>
          <span>首次贡献 ${fmtUtcDateTime(person.firstSeenAt || person.first)}</span>
          <div class="pill-row">
            <span class="tag">${escapeHtml(person.location)}</span>
            <span class="tag">${escapeHtml(person.topCategories[0]?.[0] || "通用/实验")}</span>
          </div>
        </div>
        <ul class="new-user-module-list">${moduleHtml}</ul>
        <div class="new-user-contribution-stats">
          <div><strong>${fmtNumber(modules.length)}</strong><span>近7天模块</span></div>
          <div><strong>${fmtNumber(person.versionCount)}</strong><span>版本发布</span></div>
          <div><strong>${fmtNumber(contributionDownloads)}</strong><span>当前下载</span></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderRegisteredNonContributors() {
  if (!els.registeredNoContributionRows) return;
  const window = state.snapshot.registration_window || {};
  const users = state.snapshot.registered_non_contributors || [];
  const range = window.from && window.to ? `${window.from} 至 ${window.to} UTC` : "上一完整 UTC 自然周";

  if (els.registeredNoContributionNote) {
    els.registeredNoContributionNote.textContent = `${range} · 注册 ${fmtNumber(window.enabled_registered_count ?? window.registered_count ?? 0)} 人 · 尚未贡献 ${fmtNumber(users.length)} 人`;
  }
  if (!users.length) {
    els.registeredNoContributionRows.innerHTML = `<div class="loading">上周没有已注册但尚未贡献的用户。</div>`;
    return;
  }

  els.registeredNoContributionRows.innerHTML = users.map((user) => {
    const username = externalLink(user.github_url, user.username);
    const githubNote = user.github_login
      ? `公开 GitHub 映射：${externalLink(user.github_url, user.github_login)}`
      : "公开 GitHub 映射：暂无";
    return `
      <article class="registration-watch-card">
        <div class="registration-watch-card-head">
          <strong>${username}</strong>
          <span class="registration-status">已注册 · 尚未贡献</span>
        </div>
        <p>注册日期 ${escapeHtml(user.registered_on)} UTC · 距快照 ${fmtNumber(daysBetween(user.registered_on, state.snapshot.date))} 天</p>
        <p>${githubNote}</p>
        <p>截至快照未发现非撤回模块或版本记录。</p>
      </article>
    `;
  }).join("");
}

function selectedDailyRows() {
  const rows = state.analysis.dailyRows;
  if (state.range === "all") return rows;
  const limit = Number(state.range);
  return rows.filter((day) => isWithinUtcWindow(day.date, state.snapshot.date, limit));
}

function renderDaily() {
  const rows = selectedDailyRows();
  drawChart(rows);
  els.dailyRows.innerHTML = rows.slice().reverse().map((day) => `
    <tr>
      <td>${day.date} UTC</td>
      <td><strong>${fmtNumber(day.count)}</strong></td>
      <td>${fmtNumber(day.ownerCount)}</td>
      <td class="subtle">${day.modules.slice(0, 4).map((name) => escapeHtml(moduleShort(name))).join("、")}${day.modules.length > 4 ? " ..." : ""}</td>
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

function aiMetaNote(aiMeta, total) {
  if (aiMeta?.enabled) {
    return `${fmtNumber(aiMeta.succeeded || 0)} / ${fmtNumber(total)} 人，模型 ${aiMeta.model || "未记录"}，窗口 ${fmtNumber(aiMeta.window_days || 7)} 天`;
  }
  if (aiMeta?.reason === "RUN_AI_PORTRAITS not enabled") return "未手动触发 AI，当前使用规则画像";
  if (aiMeta?.reason === "OPENAI_API_KEY not configured") return "未配置 OPENAI_API_KEY，当前使用规则画像";
  if (aiMeta?.reason === "AI_PORTRAIT_LIMIT is 0") return "AI_PORTRAIT_LIMIT 为 0，当前使用规则画像";
  return `${aiMeta?.reason || "AI 未运行"}，当前使用规则画像`;
}

function renderNewcomerInsights(newcomers) {
  if (!els.newcomerInsightList || !els.newcomerFocusList) return;
  const people = newcomers.in7;
  const total = people.length;
  if (!total) {
    els.newcomerInsightList.innerHTML = `<div class="loading">近 7 天暂无新用户，暂时无法形成群体结论。</div>`;
    els.newcomerFocusList.innerHTML = `<div class="loading">暂无重点观察对象。</div>`;
    if (els.newcomerFocusNote) els.newcomerFocusNote.textContent = "";
    return;
  }

  const recentModules = people.flatMap((person) => recentNewUserModules(person));
  const topCategory = topEntries(newcomers.categories, 1)[0];
  const singleShare = newcomers.singleRelease / total;
  const repeatPublishers = total - newcomers.singleRelease;
  const priorities = people.reduce((counts, person) => {
    const priority = person.portrait?.priority || "P2";
    counts[priority] = (counts[priority] || 0) + 1;
    return counts;
  }, { P0: 0, P1: 0, P2: 0 });
  const focusCount = priorities.P0 + priorities.P1;
  const profileShare = newcomers.withProfile / total;
  const locationShare = newcomers.withLocation / total;
  const categoryShare = topCategory && recentModules.length ? topCategory[1] / recentModules.length : 0;

  const depthTitle = singleShare >= 0.6
    ? "新用户以单次发布试水为主"
    : singleShare >= 0.4
      ? "新增活跃，再次发布仍需观察"
      : "新用户已出现较强重复发布迹象";
  const depthTone = singleShare >= 0.6 ? "risk" : singleShare >= 0.4 ? "warn" : "good";
  const focusTitle = focusCount
    ? `${fmtNumber(focusCount)} 位值得优先观察`
    : "暂未出现高优先级信号";
  const profileTitle = profileShare >= 0.75
    ? "公开资料覆盖较好"
    : profileShare >= 0.5
      ? "公开资料仍有明显缺口"
      : "画像证据覆盖不足";

  const insights = [
    {
      label: "发布深度",
      value: fmtPct(singleShare),
      title: depthTitle,
      body: `${fmtNumber(newcomers.singleRelease)} / ${fmtNumber(total)} 人目前仅有 1 次版本发布，${fmtNumber(repeatPublishers)} 人已有再次发布。`,
      action: "优先跟进已有再次发布的用户，并在首次发布后 3 至 7 天观察后续版本或第二个模块。",
      tone: depthTone
    },
    {
      label: "技术方向",
      value: topCategory ? topCategory[0] : "暂无",
      title: topCategory ? `主方向占新增模块 ${fmtPct(categoryShare)}` : "暂无可归类方向",
      body: topCategory
        ? `${fmtNumber(topCategory[1])} / ${fmtNumber(recentModules.length)} 个近 7 天新增模块归入该方向。`
        : "当前窗口没有足够模块形成方向结论。",
      action: topCategory ? `可围绕“${topCategory[0]}”组织案例征集或专题交流。` : "继续积累样本后再判断。",
      tone: "info"
    },
    {
      label: "运营优先级",
      value: `${fmtNumber(priorities.P0)} P0 · ${fmtNumber(priorities.P1)} P1`,
      title: focusTitle,
      body: `${fmtNumber(priorities.P2)} 位仍处于低证据或单次贡献观察阶段。`,
      action: focusCount ? "先核对代表模块，再做轻触达、案例共创或社区专题邀约。" : "暂不做强身份判断，先观察模块质量与后续发布。",
      tone: focusCount ? "good" : "warn"
    },
    {
      label: "证据完整度",
      value: fmtPct(profileShare),
      title: profileTitle,
      body: `GitHub 资料覆盖 ${fmtNumber(newcomers.withProfile)} / ${fmtNumber(total)}，可判定地区 ${fmtNumber(newcomers.withLocation)} / ${fmtNumber(total)}（${fmtPct(locationShare)}）。`,
      action: "资料不足时只描述贡献行为，不推断国籍、年龄、性别或其他敏感属性。",
      tone: profileShare >= 0.75 ? "good" : profileShare >= 0.5 ? "warn" : "risk"
    }
  ];

  els.newcomerInsightList.innerHTML = insights.map((insight) => `
    <article class="newcomer-insight-card tone-${insight.tone}">
      <div class="newcomer-insight-top">
        <span>${insight.label}</span>
        <strong>${insight.value}</strong>
      </div>
      <h4>${insight.title}</h4>
      <p>${insight.body}</p>
      <p class="newcomer-insight-action">建议：${insight.action}</p>
    </article>
  `).join("");

  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  const ranked = people.slice().sort((left, right) => {
    const priorityDelta = priorityOrder[left.portrait?.priority || "P2"] - priorityOrder[right.portrait?.priority || "P2"];
    if (priorityDelta) return priorityDelta;
    if (right.recent7 !== left.recent7) return right.recent7 - left.recent7;
    if ((right.portrait?.confidence || 0) !== (left.portrait?.confidence || 0)) {
      return (right.portrait?.confidence || 0) - (left.portrait?.confidence || 0);
    }
    return left.owner.localeCompare(right.owner);
  });
  const focusPeople = ranked.filter((person) => ["P0", "P1"].includes(person.portrait?.priority || "P2"));
  const visiblePeople = (focusPeople.length ? focusPeople : ranked).slice(0, 6);

  if (els.newcomerFocusNote) {
    els.newcomerFocusNote.textContent = focusPeople.length
      ? `显示 ${fmtNumber(visiblePeople.length)} / ${fmtNumber(focusPeople.length)} 位 P0/P1 新用户`
      : "暂无 P0/P1，按贡献量与公开证据展示当前前 6 位";
  }

  els.newcomerFocusList.innerHTML = visiblePeople.map((person) => {
    const priority = person.portrait?.priority || "P2";
    const modules = recentNewUserModules(person);
    const downloads = modules.reduce((sum, module) => sum + Number(module.downloads || 0), 0);
    const owner = externalLink(person.profile?.html_url, person.owner);
    return `
      <article class="newcomer-focus-card">
        <div class="newcomer-focus-head">
          <strong>${owner}</strong>
          <span class="tag ${priority === "P0" ? "hot" : priority === "P1" ? "warn" : ""}">${priority}</span>
        </div>
        <div class="pill-row">
          <span class="tag">${escapeHtml(person.topCategories[0]?.[0] || "通用/实验")}</span>
          <span class="tag">${escapeHtml(person.identity)}</span>
        </div>
        <p>${escapeHtml(person.portrait?.priorityReason || "先观察模块质量与后续发布")}</p>
        <div class="newcomer-focus-metrics">
          <span><strong>${fmtNumber(modules.length)}</strong> 近7天新增模块</span>
          <span><strong>${fmtNumber(downloads)}</strong> 当前下载</span>
          <span><strong>${fmtPct(person.portrait?.repoRatio || 0, 0)}</strong> repo</span>
        </div>
        <p class="newcomer-insight-action">${escapeHtml(newcomerActionFor(person))}</p>
      </article>
    `;
  }).join("");
}

function renderNewcomers() {
  const newcomers = state.analysis.newcomers;
  const in7 = newcomers.in7;
  const topCategory = topEntries(newcomers.categories, 1)[0];
  const aiMeta = state.analysis.aiMeta || {};
  const summary = [
    ["统计窗口", "近 7 天", `本区所有占比的分母都是近 7 天新增 owner：${fmtNumber(in7.length)} 人`],
    ["今日新增人员", fmtNumber(newcomers.today.length), `${state.snapshot.date} UTC 首次出现的 owner`],
    ["近 7 天新增人员", fmtNumber(in7.length), `近 7 天首次出现的 owner`],
    ["近7天 AI 画像覆盖", fmtPct(in7.length ? newcomers.withAi / in7.length : 0), aiMetaNote(aiMeta, in7.length)],
    ["近7天 GitHub 资料覆盖", fmtPct(in7.length ? newcomers.withProfile / in7.length : 0), `${fmtNumber(newcomers.withProfile)} / ${fmtNumber(in7.length)} 个新增 owner 可用`],
    ["近7天可判定地区人数", fmtPct(in7.length ? newcomers.withLocation / in7.length : 0), `${fmtNumber(newcomers.withLocation)} / ${fmtNumber(in7.length)} 个新增 owner 的公开 location 可归类`],
    ["近7天高置信画像", fmtPct(in7.length ? newcomers.highConfidence / in7.length : 0), `${fmtNumber(newcomers.highConfidence)} / ${fmtNumber(in7.length)} 个画像置信度 >= 66%，AI 高置信 ${fmtNumber(newcomers.highConfidenceAi)}`],
    ["近7天仅1次发布占比", fmtPct(in7.length ? newcomers.singleRelease / in7.length : 0), `${fmtNumber(newcomers.singleRelease)} / ${fmtNumber(in7.length)} 人目前只有 1 次版本发布`],
    ["近7天新增主方向", topCategory ? topCategory[0] : "暂无", topCategory ? `近 7 天新增 owner 模块中 ${fmtNumber(topCategory[1])} 个命中` : "近 7 天暂无新增人员"],
    ["近7天组织字段填写", fmtPct(in7.length ? newcomers.withCompany / in7.length : 0), `${fmtNumber(newcomers.withCompany)} / ${fmtNumber(in7.length)} 个 owner 填写 company`]
  ];

  els.newcomerSummary.innerHTML = summary.map(([label, value, note]) => `
    <div class="mini-metric">
      <div class="metric-label">${label}</div>
      <div class="mini-metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </div>
  `).join("");

  renderBarList(els.newcomerLocationList, newcomers.locations, 8);
  renderBarList(els.newcomerIdentityList, newcomers.identities, 8);
  renderBarList(els.newcomerSourceList, newcomers.sources, 8);
  renderNewcomerInsights(newcomers);
  renderNewcomerModuleMap(in7);

  els.newcomerRows.innerHTML = in7.slice(0, 40).map((person) => renderContributorCard(person, { mode: "newcomer" })).join("");

  if (!in7.length) {
    els.newcomerRows.innerHTML = `<div class="loading">近 7 天暂无首次出现的新增 owner。</div>`;
  }
}

function renderNewcomerModuleMap(people) {
  if (!els.newcomerModuleMap) return;
  if (els.newcomerMapNote) {
    const moduleCount = people.reduce((sum, person) => sum + person.modules.filter((module) => isWithinUtcWindow(moduleFirstPublishedAt(module), state.snapshot.date)).length, 0);
    els.newcomerMapNote.textContent = `${fmtNumber(people.length)} 个新增 owner，对应 ${fmtNumber(moduleCount)} 个近 7 天新增模块`;
  }
  if (!people.length) {
    els.newcomerModuleMap.innerHTML = `<div class="loading">近 7 天暂无新增 owner。</div>`;
    return;
  }
  els.newcomerModuleMap.innerHTML = people.map((person) => {
    const recentModules = person.modules
      .filter((module) => isWithinUtcWindow(moduleFirstPublishedAt(module), state.snapshot.date))
      .sort((a, b) => dayKey(moduleFirstPublishedAt(b)).localeCompare(dayKey(moduleFirstPublishedAt(a))) || String(a.name).localeCompare(String(b.name)));
    const moduleHtml = recentModules.map((module) => {
      const repoUrl = safeWebUrl(module.repository);
      const repo = repoUrl ? externalLink(repoUrl, "repo") : module.repository ? `<span class="tag warn">repo 非链接</span>` : `<span class="tag risk">repo 未填</span>`;
      return `<li><strong>${escapeHtml(moduleShort(module.name))}</strong><span>首发 ${fmtUtcDateTime(moduleFirstPublishedAt(module))} · ${escapeHtml(categoryFor(module))} · ${repo}</span></li>`;
    }).join("");
    return `
      <div class="owner-module-card">
        <div>
          <strong>${externalLink(person.profile?.html_url, person.owner)}</strong>
          <p class="subtle">${escapeHtml(person.source.label)} · ${escapeHtml(person.source.evidence)}</p>
        </div>
        <div class="pill-row">
          <span class="tag">${escapeHtml(person.location)}</span>
          <span class="tag">${escapeHtml(person.identity)}</span>
          <span class="tag ${person.portrait?.priority === "P0" ? "hot" : person.portrait?.priority === "P1" ? "warn" : ""}">${person.portrait?.priority || "P2"}</span>
        </div>
        <ul class="module-mini-list">${moduleHtml}</ul>
        <p class="subtle action-line">${escapeHtml(newcomerActionFor(person))}</p>
      </div>
    `;
  }).join("");
}

function renderDataReconciliation() {
  if (!els.dataReconcileList) return;
  const a = state.analysis;
  const s = state.snapshot;
  const derived = s.derived_metrics || {};
  const quality = s.data_quality || {};
  const integrity = s.source_integrity || {};
  const recentWindow = s.publication_windows?.recent7 || {};
  const registrationWindow = s.registration_window || {};
  const active7 = a.contributors.filter((person) => person.recent7 > 0);
  const newcomerModuleCount = a.newcomers.in7.reduce((sum, person) => sum + person.modules.filter((module) => isWithinUtcWindow(moduleFirstPublishedAt(module), s.date)).length, 0);
  const cards = [
    ["数据校验", quality.status === "pass" ? "通过" : quality.status === "warn" ? "有警告" : quality.status === "fail" ? "失败" : "未记录", quality.status === "pass" ? "模块数、owner 去重、日期解析等硬校验已通过。" : "查看下方校验项，警告不会改写事实计数。"],
    ["近7天 UTC 窗口", recentWindow.from && recentWindow.to ? `${recentWindow.from} 至 ${recentWindow.to}` : "未记录", "首尾日期均包含，共 7 个 UTC 自然日；第 8 个日期不计入。"],
    ["上周 UTC 注册窗口", registrationWindow.from && registrationWindow.to ? `${registrationWindow.from} 至 ${registrationWindow.to}` : "未记录", `上一完整 UTC 自然周注册 ${fmtNumber(registrationWindow.enabled_registered_count ?? 0)} 人，其中已贡献 ${fmtNumber(registrationWindow.contributed_count ?? 0)} 人。`],
    ["上周注册未贡献", fmtNumber(registrationWindow.no_contribution_count ?? 0), "没有任何非撤回模块或版本记录；只进入待转化列表，不计入贡献者人数。"],
    ["大盘模块数", fmtNumber(derived.statistics_total_modules || a.stats.total_modules || a.modules.length), `导出站点当前拼出 ${fmtNumber(derived.module_array_count || a.modules.length)} 条最新模块；必须等于 statistics.total_modules。`],
    ["当前子包数量", fmtNumber(a.stats.total_packages || 0), "各模块最新有效版本的 package_count 之和，不是版本记录数。"],
    ["大小字段缺失", `${fmtNumber(Math.max(Number(integrity.latest_module_missing_line_count ?? 0), Number(integrity.latest_module_missing_package_count ?? 0)))} 个模块`, `源站当前版本中 line_count 缺失 ${fmtNumber(integrity.latest_module_missing_line_count ?? 0)} 个、package_count 缺失 ${fmtNumber(integrity.latest_module_missing_package_count ?? 0)} 个；汇总时空值按 0。`],
    ["历史版本记录", fmtNumber(a.stats.total_versions || 0), "packages.csv 中全部非撤回版本发布记录。"],
    ["贡献者 owner", fmtNumber(derived.owner_count || a.contributors.length), "从模块名 owner/package 的 owner 段去重得到，是本面板的人数口径。"],
    ["近7天活跃 owner", fmtNumber(derived.recent7_active_owner_count ?? active7.length), "近 7 天内有过非撤回版本发布的 owner，不要求是第一次出现。"],
    ["近7天活跃模块", fmtNumber(derived.recent7_active_module_count ?? 0), `对应 ${fmtNumber(derived.recent7_version_release_count ?? 0)} 次版本发布。`],
    ["近7天新增模块", fmtNumber(derived.recent7_new_module_count ?? a.recent7Count), "模块首次发布时间落在近 7 个 UTC 自然日内。"],
    ["近7天新增 owner", fmtNumber(derived.recent7_new_owner_count ?? a.newcomers.in7.length), "owner 首次出现日期在近 7 天内，才算新增人。"],
    ["新增 owner 对应模块", fmtNumber(derived.recent7_new_owner_module_count ?? newcomerModuleCount), "近 7 天新增 owner 在同一窗口内发布的模块数。"]
  ];
  const checkHtml = (quality.checks || []).map((check) => `
    <div class="quality-check ${check.passed ? "passed" : check.severity}">
      <strong>${check.passed ? "通过" : check.severity === "warning" ? "警告" : "失败"}</strong>
      <span>${check.label}</span>
      <em>实际 ${check.actual} / 期望 ${check.expected}</em>
    </div>
  `).join("");
  els.dataReconcileList.innerHTML = cards.map(([label, value, note]) => `
    <div class="reconcile-card">
      <div class="metric-label">${label}</div>
      <div class="mini-metric-value">${value}</div>
      <p>${note}</p>
    </div>
  `).join("") + (checkHtml ? `<div class="quality-check-list">${checkHtml}</div>` : "");
}

function renderTiers() {
  const contributors = state.analysis.contributors.filter((person) => person.recent7 > 0);
  const tiers = [
    ["近7天高活跃", contributors.filter((person) => person.recent7 >= 5), "近 7 天有 5 个以上活跃模块，适合重点跟进和案例扩散。"],
    ["近7天多模块活跃", contributors.filter((person) => person.recent7 >= 2 && person.recent7 < 5), "近 7 天有 2-4 个活跃模块，已经出现多模块发布迹象。"],
    ["近7天轻量活跃", contributors.filter((person) => person.recent7 === 1 && person.count > 1), "近 7 天有 1 个活跃模块，历史上不止一个模块。"],
    ["近7天单模块回访", contributors.filter((person) => person.recent7 === 1 && person.count === 1 && !isWithinUtcWindow(person.first, state.snapshot.date)), "历史单模块 owner 近 7 天发布了新版本，不属于新增用户。"],
    ["近7天新增首发", contributors.filter((person) => person.recent7 === 1 && person.count === 1 && isWithinUtcWindow(person.first, state.snapshot.date)), "近 7 天首次发布 1 个模块，是新增转化和留存观察重点。"]
  ];
  els.tierList.innerHTML = tiers.map(([name, people, note]) => `
    <div class="tier-card">
      <strong>${name}：${fmtNumber(people.length)} 人</strong>
      <p>${note}</p>
      <div class="pill-row">${people.slice(0, 10).map((person) => `<span class="tag">${escapeHtml(person.owner)} +${fmtNumber(person.recent7)}</span>`).join("")}</div>
    </div>
  `).join("");
}

function renderCategories() {
  const categories = {};
  for (const module of state.analysis.modules) {
    if (!isWithinUtcWindow(moduleFirstPublishedAt(module), state.snapshot.date)) continue;
    const category = categoryFor(module);
    categories[category] = (categories[category] || 0) + 1;
  }
  const entries = topEntries(categories, 12);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  els.categoryList.innerHTML = entries.map(([name, value]) => `
    <div class="bar-item">
      <div>${escapeHtml(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
      <strong>${fmtNumber(value)}</strong>
    </div>
  `).join("");
}

function renderGithubPanels() {
  const locations = {};
  const identities = {};
  for (const person of state.analysis.contributors) {
    if (person.recent7 <= 0 || !person.profile) continue;
    if (person.location !== UNKNOWN_LOCATION) locations[person.location] = (locations[person.location] || 0) + 1;
    identities[person.identity] = (identities[person.identity] || 0) + 1;
  }
  renderBarList(els.locationList, locations, 12);
  renderBarList(els.identityList, identities, 12);
}

function renderBarList(container, data, limit) {
  const entries = topEntries(data, limit);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  if (!entries.length) {
    container.innerHTML = `<div class="loading">还没有 GitHub 映射资料。请检查导出站点 users.csv 是否包含 gh_login、gh_name、gh_avatar 字段。</div>`;
    return;
  }
  container.innerHTML = entries.map(([name, value]) => `
    <div class="bar-item">
      <div>${escapeHtml(name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
      <strong>${fmtNumber(value)}</strong>
    </div>
  `).join("");
}

function renderPortraitDetails(person) {
  const portrait = person.portrait;
  if (!portrait) return `<span class="subtle">暂无画像</span>`;
  const confidenceClass = portrait.confidence >= 0.66 ? "hot" : portrait.confidence >= 0.42 ? "warn" : "risk";
  const evidence = (portrait.evidence || []).slice(0, 2).join("；") || "仅按公开字段和模块元数据估算";
  const ai = hasAiPortrait(person.aiPortrait) ? person.aiPortrait : null;
  const aiHtml = ai ? `
    <div class="ai-portrait">
      <div class="pill-row">
        <span class="tag hot">AI画像</span>
        <span class="tag ${Number(ai.confidence) >= 0.66 ? "hot" : Number(ai.confidence) >= 0.42 ? "warn" : "risk"}">AI ${fmtPct(Number(ai.confidence), 0)}</span>
      </div>
      <div>${escapeHtml(ai.summary)}</div>
      <div class="subtle">证据：${escapeHtml((ai.evidence || []).slice(0, 2).join("；") || "未给出")}</div>
      ${(ai.risks || []).length ? `<div class="subtle">风险：${escapeHtml(ai.risks.slice(0, 2).join("；"))}</div>` : ""}
    </div>
  ` : "";
  return `
    <div class="portrait-cell">
      <div class="pill-row">
        <span class="tag ${portrait.priority === "P0" ? "hot" : portrait.priority === "P1" ? "warn" : ""}">${portrait.priority}</span>
        <span class="tag ${confidenceClass}">置信度 ${fmtPct(portrait.confidence, 0)}</span>
      </div>
      <div class="portrait-lines">
        <div>${escapeHtml(portrait.accountAgeLabel)}</div>
        <div>${escapeHtml(portrait.influenceLabel)} · followers ${fmtNumber(portrait.followers)}</div>
        <div>${escapeHtml(portrait.paceLabel)} · ${escapeHtml(portrait.primaryCategory)}</div>
        <div>${escapeHtml(portrait.transparencyLabel)} · repo ${fmtPct(portrait.repoRatio, 0)}</div>
        <div>${escapeHtml(portrait.profileLabel)}</div>
      </div>
      <div class="subtle">${escapeHtml(portrait.priorityReason)}</div>
      <div class="evidence-line">${escapeHtml(evidence)}</div>
      ${aiHtml}
    </div>
  `;
}

function tagClassFor(tag) {
  if (tag.includes("缺失") || tag.includes("沉寂") || tag.includes("未覆盖")) return "risk";
  if (tag.includes("活跃") || tag.includes("核心") || tag.includes("AI已分析")) return "hot";
  return "warn";
}

function renderProfileSummary(person) {
  const profile = person.profile;
  if (!profile) {
    return `
      <div class="profile-summary missing">
        <strong>GitHub 未覆盖</strong>
        <span>没有可用公开主页数据，身份和地区只能按模块元数据低置信判断。</span>
      </div>
    `;
  }
  return `
    <div class="profile-summary">
      <strong>${externalLink(profile.html_url, profile.name || profile.login || person.owner)}</strong>
      <span>${escapeHtml(profile.location || "地区未填写")} · ${escapeHtml(cleanCompany(profile.company) || "组织未填写")}</span>
      <span>followers ${fmtNumber(profile.followers)} / repos ${fmtNumber(profile.public_repos)}</span>
    </div>
  `;
}

function renderContributorCard(person, options = {}) {
  const isNewcomer = options.mode === "newcomer";
  const category = person.topCategories.map(([name, value]) => `${name} ${value}`).join(" / ") || "通用";
  const tags = person.signals.length ? person.signals : ["正常"];
  const modules = person.modules
    .slice()
    .sort((a, b) => dayKey(moduleLastPublishedAt(b)).localeCompare(dayKey(moduleLastPublishedAt(a))))
    .slice(0, isNewcomer ? 5 : 6)
    .map((module) => escapeHtml(moduleShort(module.name)));
  const priorityClass = person.portrait?.priority === "P0" ? "hot" : person.portrait?.priority === "P1" ? "warn" : "";
  const identityClass = person.identityConfidence >= 0.68 ? "hot" : person.identityConfidence >= 0.45 ? "warn" : "";
  const confidence = person.portrait?.confidence || 0;
  const confidenceClass = confidence >= 0.66 ? "hot" : confidence >= 0.42 ? "warn" : "risk";

  if (!isNewcomer) {
    return `
      <article class="person-card compact-person-card">
        <div class="person-card-head compact-card-head">
          <div>
            <div class="owner-title">
              ${externalLink(person.profile?.html_url, person.owner)}
            </div>
            <div class="subtle">${person.first} UTC 至 ${person.last} UTC · ${escapeHtml(person.location)}</div>
          </div>
          <div class="pill-row compact-pills">
            <span class="tag ${priorityClass}">${person.portrait?.priority || "P2"}</span>
            <span class="tag ${confidenceClass}">画像 ${fmtPct(confidence, 0)}</span>
          </div>
        </div>

        <div class="compact-summary-row">
          <strong>${fmtNumber(person.count)}</strong><span>模块</span>
          <strong>${fmtNumber(person.recent7)}</strong><span>近7天</span>
          <strong>${person.last} UTC</strong><span>最近</span>
        </div>

        <div class="compact-line">
          <span class="tag">${escapeHtml(category)}</span>
          <span class="tag ${identityClass}">${escapeHtml(person.identity)}</span>
          ${tags.slice(0, 3).map((tag) => `<span class="tag ${tagClassFor(tag)}">${escapeHtml(tag)}</span>`).join("")}
        </div>

        <div class="compact-modules subtle">${modules.join("、")}</div>

        <details class="card-detail-toggle">
          <summary>展开画像细节</summary>
          <div class="person-body compact-detail-body">
            <section>
              <h3>公开资料</h3>
              ${renderProfileSummary(person)}
            </section>
            <section>
              <h3>方向与身份</h3>
              <p class="subtle">身份置信 ${fmtPct(person.identityConfidence, 0)}</p>
              <p class="subtle">${escapeHtml(person.topKeywords.map(([key]) => key).slice(0, 6).join("、") || "暂无关键词")}</p>
            </section>
            <section class="full-row">
              <h3>画像判断</h3>
              ${renderPortraitDetails(person)}
            </section>
          </div>
        </details>
      </article>
    `;
  }

  return `
    <article class="person-card ${isNewcomer ? "newcomer-card" : ""}">
      <div class="person-card-head">
        <div>
          <div class="owner-title">
            ${externalLink(person.profile?.html_url, person.owner)}
          </div>
          <div class="subtle">${person.first} UTC 至 ${person.last} UTC</div>
        </div>
        <div class="pill-row compact-pills">
          <span class="tag ${priorityClass}">${person.portrait?.priority || "P2"}</span>
          <span class="tag ${confidenceClass}">画像 ${fmtPct(confidence, 0)}</span>
        </div>
      </div>

      <div class="person-stats">
        <div><strong>${fmtNumber(person.count)}</strong><span>模块</span></div>
        <div><strong>${fmtNumber(person.recent7)}</strong><span>近7天活跃模块</span></div>
        <div><strong>${person.last} UTC</strong><span>最近发布</span></div>
      </div>

      <div class="person-body">
        <section>
          <h3>公开资料</h3>
          ${renderProfileSummary(person)}
        </section>
        <section>
          <h3>方向与身份</h3>
          <div class="pill-row">
            <span class="tag">${escapeHtml(category)}</span>
            <span class="tag ${identityClass}">${escapeHtml(person.identity)}</span>
          </div>
          <p class="subtle">${escapeHtml(person.location)} · 身份置信 ${fmtPct(person.identityConfidence, 0)}</p>
          <p class="subtle">${escapeHtml(person.topKeywords.map(([key]) => key).slice(0, 6).join("、") || "暂无关键词")}</p>
        </section>
        <section class="full-row">
          <h3>画像判断</h3>
          ${renderPortraitDetails(person)}
        </section>
        <section>
          <h3>问题提示</h3>
          <div class="pill-row">${tags.map((tag) => `<span class="tag ${tagClassFor(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>
        </section>
        <section>
          <h3>${isNewcomer ? "建议动作" : "代表模块"}</h3>
          <p class="subtle">${isNewcomer ? escapeHtml(newcomerActionFor(person)) : modules.join("、")}</p>
          ${isNewcomer ? `<p class="subtle module-line">${modules.join("、")}</p>` : ""}
        </section>
      </div>
    </article>
  `;
}

function renderContributors() {
  const query = state.search.trim().toLowerCase();
  const active = state.analysis.contributors.filter((person) => person.recent7 > 0);
  const older = state.analysis.contributors.filter((person) => person.recent7 === 0);
  const activeMatches = active.filter((person) => !query || person.searchText.includes(query));
  const olderMatches = older.filter((person) => query && person.searchText.includes(query));
  const activeRows = activeMatches.slice(0, 180);
  const olderRows = olderMatches.slice(0, 120);

  if (els.contributorCountNote) {
    if (query) {
      els.contributorCountNote.textContent = `搜索全部贡献者：近 7 天匹配 ${fmtNumber(activeMatches.length)} 个，7 天以外匹配 ${fmtNumber(olderMatches.length)} 个。`;
    } else {
      els.contributorCountNote.textContent = `默认展示 ${fmtNumber(activeRows.length)} 个近 7 天活跃 owner；7 天以外 ${fmtNumber(older.length)} 个已折叠，可用搜索框检索。`;
    }
  }

  els.contributorRows.innerHTML = activeRows.length
    ? activeRows.map((person) => renderContributorCard(person)).join("")
    : `<div class="loading">${query ? "近 7 天没有匹配的贡献者，看看下方 7 天以外结果。" : "近 7 天暂无活跃贡献者。"}</div>`;

  if (els.olderContributorPanel && els.olderContributorSummary && els.olderContributorRows) {
    els.olderContributorPanel.open = Boolean(query && olderRows.length);
    els.olderContributorSummary.textContent = query
      ? `7 天以外匹配 ${fmtNumber(olderMatches.length)} 个${olderMatches.length > olderRows.length ? `，显示前 ${fmtNumber(olderRows.length)} 个` : ""}`
      : `7 天以外贡献者 ${fmtNumber(older.length)} 个（已折叠，搜索可查）`;
    els.olderContributorRows.innerHTML = query
      ? (olderRows.length ? olderRows.map((person) => renderContributorCard(person)).join("") : `<div class="loading">7 天以外没有匹配的贡献者。</div>`)
      : `<div class="loading">默认收起历史贡献者，使用上方搜索框可按 owner、地区、组织、关键词、模块名检索。</div>`;
  }
}

async function load(force = false) {
  els.refreshBtn.disabled = true;
  els.statusPill.textContent = force ? "刷新中" : "分析中";
  els.summaryGrid.innerHTML = `<div class="loading" style="grid-column:1 / -1">正在读取最新数据快照并生成页面...</div>`;
  try {
    state.snapshot = await fetchSnapshot(force);
    state.analysis = analyze(state.snapshot);
    render();
  } catch (error) {
    els.statusPill.textContent = "分析失败";
    els.summaryGrid.innerHTML = `<div class="loading" style="grid-column:1 / -1">分析失败：${escapeHtml(error.message)}</div>`;
  } finally {
    els.refreshBtn.disabled = false;
  }
}

async function fetchSnapshot(force) {
  const isLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  if (isLocal) {
    try {
      const response = await fetch(`api/analyze${force ? "?force=1" : ""}`, {
        cache: "no-store"
      });
      if (response.ok) return response.json();
    } catch {
      // Fall back to static data.
    }
  }
  const response = await fetch(`data/latest.json?ts=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
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
