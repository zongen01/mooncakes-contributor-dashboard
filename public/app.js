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
  dailyChart: document.querySelector("#dailyChart"),
  dailyRows: document.querySelector("#dailyRows"),
  issueList: document.querySelector("#issueList"),
  newcomerSummary: document.querySelector("#newcomerSummary"),
  newcomerLocationList: document.querySelector("#newcomerLocationList"),
  newcomerIdentityList: document.querySelector("#newcomerIdentityList"),
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
      evidence: ["GitHub API 未返回可用公开资料"]
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
  if (person.count >= 20) paceLabel = "核心高产贡献者";
  else if (person.count >= 5 && activeSpanDays >= 90) paceLabel = "持续贡献型";
  else if (person.count >= 3 && person.recent7 / person.count >= 0.7) paceLabel = "近期集中爆发型";
  else if (person.count >= 2) paceLabel = "轻量复投型";

  let transparencyLabel = "仓库透明度偏低";
  if (repoRatio >= 0.9) transparencyLabel = "仓库透明度高";
  else if (repoRatio >= 0.6) transparencyLabel = "仓库透明度中等";

  let profileLabel = "公开资料较少";
  if (profileScore >= 0.65) profileLabel = "公开资料较完整";
  else if (profileScore >= 0.35) profileLabel = "公开资料中等";

  let priority = aiPortrait?.priority || "P2";
  let priorityReason = "先观察模块质量、公开资料和后续复投";
  if (
    person.count >= 5 ||
    (usableProfile && followers >= 200) ||
    (person.count >= 3 && repoRatio >= 0.6) ||
    (person.identityConfidence >= 0.68 && ["语言/工具链开发者", "AI/LLM 开发者", "高校/研究机构线索"].includes(person.identity))
  ) {
    priority = "P1";
    priorityReason = "有较明确公开线索或复投迹象";
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
    const created = dayKey(module.created_at);
    if (!owners.has(owner)) {
      owners.set(owner, {
        owner,
        count: 0,
        first: "",
        last: "",
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
    const rawProfile = githubProfiles[person.owner] || null;
    const profile = hasUsableProfile(rawProfile) ? rawProfile : null;
    const rawAiPortrait = aiPortraits[person.owner] || null;
    const aiPortrait = hasAiPortrait(rawAiPortrait) ? rawAiPortrait : null;
    const location = normalizeLocation(profile?.location);
    const identityInfo = inferIdentity(profile, { ...person, topCategories, topKeywords });
    const identity = aiPortrait?.identity_label ? `AI：${aiPortrait.identity_label}` : identityInfo.label;
    const identityConfidence = aiPortrait ? Math.max(identityInfo.confidence, Number(aiPortrait.confidence)) : identityInfo.confidence;
    const signals = [];
    if (person.count >= 20) signals.push("核心高产");
    if (person.recent7 >= 3) signals.push("近7天活跃");
    if (person.count === 1) signals.push("一次性贡献");
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

  const recent7 = dailyRows.filter((day) => daysBetween(day.date, snapshot.date) <= 7);
  const previous7 = dailyRows.filter((day) => {
    const age = daysBetween(day.date, snapshot.date);
    return age > 7 && age <= 14;
  });
  const recent7Count = recent7.reduce((sum, day) => sum + day.count, 0);
  const previous7Count = previous7.reduce((sum, day) => sum + day.count, 0);
  const active7Owners = new Set(modules.filter((m) => daysBetween(dayKey(m.created_at), snapshot.date) <= ANALYSIS_DAYS).map((m) => ownerOf(m.name))).size;
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
    .filter((person) => daysBetween(person.first, snapshotDate) <= ANALYSIS_DAYS)
    .sort((a, b) => b.first.localeCompare(a.first) || b.count - a.count || a.owner.localeCompare(b.owner));
  const today = in7.filter((person) => person.first === snapshotDate);
  const locations = {};
  const identities = {};
  const categories = {};
  let withProfile = 0;
  let withLocation = 0;
  let withCompany = 0;
  let highConfidence = 0;
  let withAi = 0;
  let highConfidenceAi = 0;
  let singleModule = 0;

  for (const person of in7) {
    if (person.profile) withProfile += 1;
    if (person.aiPortrait) withAi += 1;
    locations[person.location] = (locations[person.location] || 0) + 1;
    identities[person.identity] = (identities[person.identity] || 0) + 1;
    if (person.location !== UNKNOWN_LOCATION) withLocation += 1;
    if (cleanCompany(person.profile?.company)) withCompany += 1;
    if ((person.portrait?.confidence || 0) >= 0.66) highConfidence += 1;
    if ((person.aiPortrait?.confidence || 0) >= 0.66) highConfidenceAi += 1;
    if (person.count === 1) singleModule += 1;
    for (const [category, count] of person.topCategories) {
      categories[category] = (categories[category] || 0) + count;
    }
  }

  return {
    in7,
    today,
    locations,
    identities,
    categories,
    withProfile,
    withLocation,
    withCompany,
    highConfidence,
    withAi,
    highConfidenceAi,
    singleModule
  };
}

function buildIssues(context) {
  const recentModules = context.modules.filter((module) => daysBetween(dayKey(module.created_at), context.snapshot.date) <= ANALYSIS_DAYS);
  const recentContributors = context.contributors.filter((person) => person.recent7 > 0);
  const total = recentModules.length || 1;
  const ownerTotal = recentContributors.length || 1;
  const issues = [];
  const top10Share = recentContributors
    .slice()
    .sort((left, right) => right.recent7 - left.recent7 || right.count - left.count)
    .slice(0, 10)
    .reduce((sum, person) => sum + person.recent7, 0) / total;
  const singleOwners = recentContributors.filter((person) => person.count === 1).length;
  const singleShare = singleOwners / ownerTotal;
  const missingRepoCount = recentModules.filter((module) => !module.repository).length;
  const missingRepoShare = missingRepoCount / total;
  const delta7 = context.previous7Count ? (context.recent7Count - context.previous7Count) / context.previous7Count : 0;
  const recentCategories = {};
  for (const module of recentModules) {
    const category = categoryFor(module);
    recentCategories[category] = (recentCategories[category] || 0) + 1;
  }
  const aiShare = (recentCategories["AI/LLM"] || 0) / total;
  const githubCoverage = recentContributors.filter((person) => person.profile).length / ownerTotal;

  if (top10Share >= 0.4) {
    issues.push({
      severity: "high",
      title: `近 7 天头部集中度偏高：Top 10 贡献 ${fmtPct(top10Share)}`,
      body: "短期增长高度依赖少数高产 owner。适合重点维护头部关系，同时追踪是否能带动更多复投。"
    });
  }
  if (singleShare >= 0.5) {
    issues.push({
      severity: "medium",
      title: `近 7 天首发留存压力：${singleOwners} 个活跃 owner 目前只发 1 个模块`,
      body: "短期新增里首发占比较高。可以补发布模板、包质量反馈、每周推荐来推动复投。"
    });
  }
  if (missingRepoShare >= 0.18) {
    issues.push({
      severity: "medium",
      title: `近 7 天透明度缺口：${fmtNumber(missingRepoCount)} 个新增模块未填写 repository`,
      body: "缺仓库链接会影响信任、复用和协作。建议把近 7 天新增包的 repository 完整率作为质量指标。"
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
      title: `近 7 天 AI/LLM 相关占比 ${fmtPct(aiShare)}，还不是主赛道`,
      body: "如果要强调 AI 原生生态，需要更多 agent、SDK、评测、工具调用类包作为短期新增证据。"
    });
  }
  if (githubCoverage > 0 && githubCoverage < 0.8) {
    issues.push({
      severity: "low",
      title: `近 7 天 GitHub 画像覆盖 ${fmtPct(githubCoverage)}，还有缺口`,
      body: "未配置 GITHUB_TOKEN 时会受 GitHub API 限制。可以先看近 7 天活跃贡献者，配置 token 后再做全量画像。"
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
  renderNewcomers();
  renderTiers();
  renderCategories();
  renderGithubPanels();
  renderContributors();
}

function renderSummary() {
  const a = state.analysis;
  const s = state.snapshot;
  const active7 = a.contributors.filter((person) => person.recent7 > 0);
  const active7Total = active7.length || 1;
  const recent7ModuleTotal = a.recent7Count || 1;
  const recent7Top10 = active7
    .slice()
    .sort((left, right) => right.recent7 - left.recent7 || right.count - left.count)
    .slice(0, 10)
    .reduce((sum, person) => sum + person.recent7, 0);
  const active7Github = active7.filter((person) => person.profile).length;
  const active7Single = active7.filter((person) => person.count === 1).length;
  const metrics = [
    ["近7天活跃 owner", fmtNumber(active7.length), `近 7 天新增 ${fmtNumber(a.recent7Count)} 个模块`],
    ["近7天新增 owner", fmtNumber(a.newcomers.in7.length), "首次发布模块的 owner"],
    ["今日新增 owner", fmtNumber(a.newcomers.today.length), `${s.date} 首次出现的 owner`],
    ["近7天 GitHub 覆盖", fmtPct(active7Github / active7Total), `${fmtNumber(active7Github)} / ${fmtNumber(active7.length)} 个活跃 owner 可用`],
    ["近7天 Top10 占比", fmtPct(recent7Top10 / recent7ModuleTotal), `Top 10 贡献 ${fmtNumber(recent7Top10)} 个近 7 天新增模块`],
    ["近7天一次性贡献", fmtPct(active7Single / active7Total), `${fmtNumber(active7Single)} 个活跃 owner 目前只发 1 个模块`]
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
  return rows.filter((day) => daysBetween(day.date, state.snapshot.date) <= limit);
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

function aiMetaNote(aiMeta, total) {
  if (aiMeta?.enabled) {
    return `${fmtNumber(aiMeta.succeeded || 0)} / ${fmtNumber(total)} 人，模型 ${aiMeta.model || "未记录"}，窗口 ${fmtNumber(aiMeta.window_days || 7)} 天`;
  }
  if (aiMeta?.reason === "RUN_AI_PORTRAITS not enabled") return "未手动触发 AI，当前使用规则画像";
  if (aiMeta?.reason === "OPENAI_API_KEY not configured") return "未配置 OPENAI_API_KEY，当前使用规则画像";
  if (aiMeta?.reason === "AI_PORTRAIT_LIMIT is 0") return "AI_PORTRAIT_LIMIT 为 0，当前使用规则画像";
  return `${aiMeta?.reason || "AI 未运行"}，当前使用规则画像`;
}

function renderNewcomers() {
  const newcomers = state.analysis.newcomers;
  const in7 = newcomers.in7;
  const topCategory = topEntries(newcomers.categories, 1)[0];
  const aiMeta = state.analysis.aiMeta || {};
  const summary = [
    ["统计窗口", "近 7 天", `本区所有占比的分母都是近 7 天新增 owner：${fmtNumber(in7.length)} 人`],
    ["今日新增人员", fmtNumber(newcomers.today.length), `${state.snapshot.date} 首次出现的 owner`],
    ["近 7 天新增人员", fmtNumber(in7.length), `近 7 天首次出现的 owner`],
    ["近7天 AI 画像覆盖", fmtPct(in7.length ? newcomers.withAi / in7.length : 0), aiMetaNote(aiMeta, in7.length)],
    ["近7天 GitHub 资料覆盖", fmtPct(in7.length ? newcomers.withProfile / in7.length : 0), `${fmtNumber(newcomers.withProfile)} / ${fmtNumber(in7.length)} 个新增 owner 可用`],
    ["近7天可判定地区人数", fmtPct(in7.length ? newcomers.withLocation / in7.length : 0), `${fmtNumber(newcomers.withLocation)} / ${fmtNumber(in7.length)} 个新增 owner 的公开 location 可归类`],
    ["近7天高置信画像", fmtPct(in7.length ? newcomers.highConfidence / in7.length : 0), `${fmtNumber(newcomers.highConfidence)} / ${fmtNumber(in7.length)} 个画像置信度 >= 66%，AI 高置信 ${fmtNumber(newcomers.highConfidenceAi)}`],
    ["近7天一次性新增占比", fmtPct(in7.length ? newcomers.singleModule / in7.length : 0), `${fmtNumber(newcomers.singleModule)} / ${fmtNumber(in7.length)} 人目前只发 1 个模块`],
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

  els.newcomerRows.innerHTML = in7.slice(0, 40).map((person) => renderContributorCard(person, { mode: "newcomer" })).join("");

  if (!in7.length) {
    els.newcomerRows.innerHTML = `<div class="loading">近 7 天暂无首次出现的新增 owner。</div>`;
  }
}

function renderTiers() {
  const contributors = state.analysis.contributors.filter((person) => person.recent7 > 0);
  const tiers = [
    ["近7天高活跃", contributors.filter((person) => person.recent7 >= 5), "近 7 天新增 5 个以上模块，适合重点跟进和案例扩散。"],
    ["近7天复投", contributors.filter((person) => person.recent7 >= 2 && person.recent7 < 5), "近 7 天新增 2-4 个模块，已经出现连续贡献迹象。"],
    ["近7天轻量活跃", contributors.filter((person) => person.recent7 === 1 && person.count > 1), "近 7 天新增 1 个模块，但历史上不是第一次贡献。"],
    ["近7天新增首发", contributors.filter((person) => person.recent7 === 1 && person.count === 1), "近 7 天首次发布 1 个模块，是新增转化和留存观察重点。"]
  ];
  els.tierList.innerHTML = tiers.map(([name, people, note]) => `
    <div class="tier-card">
      <strong>${name}：${fmtNumber(people.length)} 人</strong>
      <p>${note}</p>
      <div class="pill-row">${people.slice(0, 10).map((person) => `<span class="tag">${person.owner} +${fmtNumber(person.recent7)}</span>`).join("")}</div>
    </div>
  `).join("");
}

function renderCategories() {
  const categories = {};
  for (const module of state.analysis.modules) {
    if (daysBetween(dayKey(module.created_at), state.snapshot.date) > ANALYSIS_DAYS) continue;
    const category = categoryFor(module);
    categories[category] = (categories[category] || 0) + 1;
  }
  const entries = topEntries(categories, 12);
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
      <div>${ai.summary}</div>
      <div class="subtle">证据：${(ai.evidence || []).slice(0, 2).join("；") || "未给出"}</div>
      ${(ai.risks || []).length ? `<div class="subtle">风险：${ai.risks.slice(0, 2).join("；")}</div>` : ""}
    </div>
  ` : "";
  return `
    <div class="portrait-cell">
      <div class="pill-row">
        <span class="tag ${portrait.priority === "P0" ? "hot" : portrait.priority === "P1" ? "warn" : ""}">${portrait.priority}</span>
        <span class="tag ${confidenceClass}">置信度 ${fmtPct(portrait.confidence, 0)}</span>
      </div>
      <div class="portrait-lines">
        <div>${portrait.accountAgeLabel}</div>
        <div>${portrait.influenceLabel} · followers ${fmtNumber(portrait.followers)}</div>
        <div>${portrait.paceLabel} · ${portrait.primaryCategory}</div>
        <div>${portrait.transparencyLabel} · repo ${fmtPct(portrait.repoRatio, 0)}</div>
        <div>${portrait.profileLabel}</div>
      </div>
      <div class="subtle">${portrait.priorityReason}</div>
      <div class="evidence-line">${evidence}</div>
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
      <strong>${profile.html_url ? `<a href="${profile.html_url}" target="_blank" rel="noreferrer">${profile.name || profile.login || person.owner}</a>` : profile.name || person.owner}</strong>
      <span>${profile.location || "地区未填写"} · ${cleanCompany(profile.company) || "组织未填写"}</span>
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
    .sort((a, b) => dayKey(b.created_at).localeCompare(dayKey(a.created_at)))
    .slice(0, isNewcomer ? 5 : 6)
    .map((module) => moduleShort(module.name));
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
              ${person.profile?.html_url ? `<a href="${person.profile.html_url}" target="_blank" rel="noreferrer">${person.owner}</a>` : person.owner}
            </div>
            <div class="subtle">${person.first} 至 ${person.last} · ${person.location}</div>
          </div>
          <div class="pill-row compact-pills">
            <span class="tag ${priorityClass}">${person.portrait?.priority || "P2"}</span>
            <span class="tag ${confidenceClass}">画像 ${fmtPct(confidence, 0)}</span>
          </div>
        </div>

        <div class="compact-summary-row">
          <strong>${fmtNumber(person.count)}</strong><span>模块</span>
          <strong>${fmtNumber(person.recent7)}</strong><span>近7天</span>
          <strong>${person.last}</strong><span>最近</span>
        </div>

        <div class="compact-line">
          <span class="tag">${category}</span>
          <span class="tag ${identityClass}">${person.identity}</span>
          ${tags.slice(0, 3).map((tag) => `<span class="tag ${tagClassFor(tag)}">${tag}</span>`).join("")}
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
              <p class="subtle">${person.topKeywords.map(([key]) => key).slice(0, 6).join("、") || "暂无关键词"}</p>
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
            ${person.profile?.html_url ? `<a href="${person.profile.html_url}" target="_blank" rel="noreferrer">${person.owner}</a>` : person.owner}
          </div>
          <div class="subtle">${person.first} 至 ${person.last}</div>
        </div>
        <div class="pill-row compact-pills">
          <span class="tag ${priorityClass}">${person.portrait?.priority || "P2"}</span>
          <span class="tag ${confidenceClass}">画像 ${fmtPct(confidence, 0)}</span>
        </div>
      </div>

      <div class="person-stats">
        <div><strong>${fmtNumber(person.count)}</strong><span>模块</span></div>
        <div><strong>${fmtNumber(person.recent7)}</strong><span>近7天</span></div>
        <div><strong>${person.last}</strong><span>最近新增</span></div>
      </div>

      <div class="person-body">
        <section>
          <h3>公开资料</h3>
          ${renderProfileSummary(person)}
        </section>
        <section>
          <h3>方向与身份</h3>
          <div class="pill-row">
            <span class="tag">${category}</span>
            <span class="tag ${identityClass}">${person.identity}</span>
          </div>
          <p class="subtle">${person.location} · 身份置信 ${fmtPct(person.identityConfidence, 0)}</p>
          <p class="subtle">${person.topKeywords.map(([key]) => key).slice(0, 6).join("、") || "暂无关键词"}</p>
        </section>
        <section class="full-row">
          <h3>画像判断</h3>
          ${renderPortraitDetails(person)}
        </section>
        <section>
          <h3>问题提示</h3>
          <div class="pill-row">${tags.map((tag) => `<span class="tag ${tagClassFor(tag)}">${tag}</span>`).join("")}</div>
        </section>
        <section>
          <h3>${isNewcomer ? "建议动作" : "代表模块"}</h3>
          <p class="subtle">${isNewcomer ? newcomerActionFor(person) : modules.join("、")}</p>
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
