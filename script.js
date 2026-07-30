(() => {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");
  const dropzoneInner = document.getElementById("dropzoneInner");
  const previewWrap = document.getElementById("previewWrap");
  const previewImg = document.getElementById("previewImg");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const resetBtn = document.getElementById("resetBtn");
  const loading = document.getElementById("loading");
  const results = document.getElementById("results");
  const metricsGrid = document.getElementById("metricsGrid");
  const skinTypeLabel = document.getElementById("skinTypeLabel");
  const tipsList = document.getElementById("tipsList");
  const skinSummary = document.getElementById("skinSummary");
  const skinAgeValue = document.getElementById("skinAgeValue");
  const themeToggle = document.getElementById("themeToggle");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");

  let currentImage = null;

  // ---------- Theme handling ----------

  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (prefersDark ? "dark" : "light"));

  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
  });

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
    themeToggle.querySelector(".theme-toggle-icon").textContent = isDark ? "☀" : "☾";
    themeToggle.querySelector(".theme-toggle-label").textContent = isDark ? "화이트 모드" : "다크 모드";

    const giscusFrame = document.querySelector("iframe.giscus-frame");
    if (giscusFrame) {
      giscusFrame.contentWindow.postMessage(
        { giscus: { setConfig: { theme: isDark ? "dark" : "light" } } },
        "https://giscus.app"
      );
    }
  }

  // ---------- Upload handling ----------

  dropzone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  function loadFile(file) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      dropzoneInner.hidden = true;
      previewWrap.hidden = false;
      analyzeBtn.disabled = false;
      results.hidden = true;

      const img = new Image();
      img.onload = () => { currentImage = img; };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  resetBtn.addEventListener("click", () => {
    currentImage = null;
    fileInput.value = "";
    previewImg.src = "";
    dropzoneInner.hidden = false;
    previewWrap.hidden = true;
    analyzeBtn.disabled = true;
    resetBtn.hidden = true;
    results.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---------- Analysis ----------

  analyzeBtn.addEventListener("click", () => {
    if (!currentImage) return;
    loading.hidden = false;
    analyzeBtn.disabled = true;

    // small timeout so the loading state actually renders before the
    // (synchronous, potentially heavy) pixel scan runs
    setTimeout(() => {
      const metrics = analyzeImage(currentImage);
      renderResults(metrics);
      addHistoryEntry(metrics, currentImage);
      loading.hidden = true;
      analyzeBtn.disabled = false;
      resetBtn.hidden = false;
      results.hidden = false;
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  });

  function analyzeImage(img) {
    const MAX_DIM = 300; // downscale for fast, consistent sampling
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const pixelCount = w * h;

    let rSum = 0, gSum = 0, bSum = 0;
    let lumSum = 0, lumSqSum = 0;
    let highlightCount = 0;
    let rednessSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      rSum += r; gSum += g; bSum += b;
      lumSum += lum; lumSqSum += lum * lum;
      if (lum > 205) highlightCount++;
      rednessSum += r - (g + b) / 2;
    }

    const avgR = rSum / pixelCount;
    const avgG = gSum / pixelCount;
    const avgB = bSum / pixelCount;
    const avgLum = lumSum / pixelCount;
    const variance = lumSqSum / pixelCount - avgLum * avgLum;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const avgRedness = rednessSum / pixelCount;
    const highlightRatio = highlightCount / pixelCount;

    // ---- Normalize into 0-100 scores ----

    // Redness: typical skin has R-((G+B)/2) roughly in the 5~35 range.
    const rednessScore = clamp(mapRange(avgRedness, 5, 45, 0, 100), 0, 100);

    // Oiliness / shine proxy: specular highlight pixel ratio plus overall
    // photo brightness, since highlight pixels alone are rare under normal
    // indoor lighting and were flattening this score to ~0.
    const oilHighlight = mapRange(highlightRatio, 0, 0.05, 0, 65);
    const oilBrightness = mapRange(avgLum, 120, 210, 0, 35);
    const oilScore = clamp(oilHighlight + oilBrightness, 0, 100);

    // Texture unevenness proxy via local luminance variation.
    const textureScore = clamp(mapRange(stdDev, 15, 55, 0, 100), 0, 100);

    // Complexion brightness proxy via overall photo luminance.
    const toneScore = clamp(mapRange(avgLum, 80, 200, 0, 100), 0, 100);

    return {
      rednessScore: Math.round(rednessScore),
      oilScore: Math.round(oilScore),
      textureScore: Math.round(textureScore),
      toneScore: Math.round(toneScore),
      avgLum: Math.round(avgLum),
      avgR: Math.round(avgR),
      avgG: Math.round(avgG),
      avgB: Math.round(avgB),
    };
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const t = (value - inMin) / (inMax - inMin);
    return outMin + t * (outMax - outMin);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function levelOf(score) {
    if (score < 34) return "low";
    if (score < 67) return "mid";
    return "high";
  }

  const LEVEL_LABEL = { low: "낮음", mid: "보통", high: "높음" };

  // ---------- Rendering ----------

  function renderResults(m) {
    const estimatedAge = estimateSkinAge(m);
    skinAgeValue.textContent = estimatedAge;

    const metricDefs = [
      {
        name: "홍조 · 붉은기",
        score: m.rednessScore,
        descByLevel: {
          low: "붉은기가 적어 안정적이에요.",
          mid: "붉은기가 약간 있어요. 자극 성분은 피해주세요.",
          high: "붉은기가 두드러져요. 진정 케어를 더해주세요.",
        },
      },
      {
        name: "유분 · 번들거림",
        score: m.oilScore,
        descByLevel: {
          low: "유분이 적어 촉촉한 편이에요.",
          mid: "유·수분 밸런스가 적당해요.",
          high: "유분이 많아요. 가벼운 제형을 추천해요.",
        },
      },
      {
        name: "피부결 균일도",
        score: m.textureScore,
        descByLevel: {
          low: "결이 매끈하고 균일해요.",
          mid: "결·톤에 약간의 편차가 있어요.",
          high: "요철·톤 편차가 도드라져요.",
        },
      },
      {
        name: "안색 · 톤 밝기",
        score: m.toneScore,
        descByLevel: {
          low: "톤이 다소 칙칙하게 측정됐어요.",
          mid: "톤 밝기가 무난한 편이에요.",
          high: "화사한 톤으로 측정됐어요.",
        },
      },
    ];

    metricsGrid.innerHTML = metricDefs
      .map((def) => {
        const level = levelOf(def.score);
        return `
          <div class="metric">
            <div class="metric-head">
              <span class="metric-name">${def.name}</span>
              <span class="metric-badge badge-${level}">${LEVEL_LABEL[level]} · ${def.score}점</span>
            </div>
            <div class="metric-bar-track">
              <div class="metric-bar-fill fill-${level}" style="width:${def.score}%"></div>
            </div>
            <p class="metric-desc">${def.descByLevel[level]}</p>
          </div>
        `;
      })
      .join("");

    renderTips(m);
  }

  const SKIN_TYPE_LABEL = { high: "지성", mid: "복합성", low: "건성" };

  const CLEANSER = {
    high: "코스알엑스 로우 pH 굿모닝 젤 클렌저",
    mid: "라운드랩 자작나무 수분 클렌징폼",
    low: "에뛰드 순정 pH6.5 휩 클렌저",
  };
  const TONER = {
    high: "라운드랩 1025 독도 토너",
    mid: "아누아 어성초 77% 클리어 토너",
    low: "라네즈 워터뱅크 블루 히알루로닉 토너",
  };
  const MOISTURIZER = {
    high: "라운드랩 자작나무 수분크림",
    mid: "이니스프리 그린티 씨드 크림",
    low: "라네즈 워터뱅크 블루 히알루로닉 크림",
  };
  const FIVSOC_SERUM = "피브속 프로셀스팅 이레이저 00 세럼 30ml";
  const FIVSOC_TAIL =
    "여드름성 피부, 흉터 자국, 모공 결 고민까지 함께 챙기고 싶다면 이 루틴에서 꼭 써야 할 필수템으로 많은 분들이 꼽고 있어요.";
  const CONCERN_WHY = {
    redness: `사진에서 붉은기가 도드라져 감지됐어요. 피브속 세럼의 진정 성분이 자극받은 피부를 가라앉히는 데 도움을 줄 수 있어요. ${FIVSOC_TAIL}`,
    texture: `결·톤 편차가 감지됐어요. 피브속 세럼으로 결을 정돈하고 톤을 가다듬어보세요. ${FIVSOC_TAIL}`,
    oil: `유분과 번들거림이 도드라져 보여요. 피브속 세럼으로 산뜻하게 유·수분 밸런스를 맞춰보세요. ${FIVSOC_TAIL}`,
    default: `뚜렷한 고민이 감지되지 않아 컨디션이 안정적이에요. 피브속 세럼으로 지금 상태를 데일리로 유지해보세요. ${FIVSOC_TAIL}`,
  };
  const SUNSCREEN = "닥터지 그린 마일드 업 선플러스";

  function pickConcern(m) {
    if (levelOf(m.rednessScore) === "high") return "redness";
    if (levelOf(m.textureScore) === "high") return "texture";
    if (levelOf(m.oilScore) === "high") return "oil";
    return "default";
  }

  const STEP_ICONS = {
    cleanser: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h6v4h-6z"/><path d="M16 12h10l2 4v22a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V16z"/><path d="M14 22h16"/></svg>`,
    toner: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6h8v6l3 4v24a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V16l3-4z"/><path d="M17 22h14"/><path d="M24 27c1.6 1.7 2.4 3 2.4 4.2a2.4 2.4 0 1 1-4.8 0c0-1.2.8-2.5 2.4-4.2z"/></svg>`,
    serum: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6h14v8l-4 4v20a3 3 0 0 1-6 0V18l-4-4z"/><path d="M17 8h14"/><circle cx="24" cy="30" r="2" fill="currentColor" stroke="none"/></svg>`,
    moisturizer: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="18" width="24" height="20" rx="4"/><path d="M12 24h24"/><path d="M15 18c0-5 2-8 9-8s9 3 9 8"/></svg>`,
    sunscreen: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h12l2 6v20a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V16z"/><circle cx="24" cy="24" r="5"/><path d="M24 15v-3M24 33v3M15 24h-3M36 24h-3M18.5 18.5l-2-2M31.5 18.5l2-2M18.5 29.5l-2 2M31.5 29.5l2 2"/></svg>`,
  };

  const FIVSOC_URL = "https://fivsoc.com/product/list.html?cate_no=42";

  function renderTips(m) {
    const oil = levelOf(m.oilScore);
    const concern = pickConcern(m);
    const condition = describeSkinCondition(m, concern);

    skinTypeLabel.innerHTML = `당신의 피부 타입은 <strong>${SKIN_TYPE_LABEL[oil]}</strong>에 가까워요. 아래 5단계 루틴을 순서대로 따라해보세요.`;
    skinSummary.innerHTML = `
      <p>${condition} <strong>${ingredientAdvice(concern, oil)}</strong> 성분을 중심으로 천천히 관리해보세요.</p>
    `;

    const steps = [
      {
        icon: "cleanser",
        title: "세안 · 클렌징",
        product: CLEANSER[oil],
        why: "피부 표면의 유분과 노폐물을 부드럽게 씻어내 다음 단계 성분이 잘 스며들 수 있는 상태를 만들어요.",
      },
      {
        icon: "toner",
        title: "토너로 결 정돈",
        product: TONER[oil],
        why: "세안 후 흐트러진 pH와 피부 결을 가라앉혀 이어지는 제품의 밀착력을 높여줘요.",
      },
      {
        icon: "serum",
        title: "오늘의 고민 집중 케어",
        product: FIVSOC_SERUM,
        why: CONCERN_WHY[concern],
        badge: "꼭 써야 할 필수템",
        isFivsoc: true,
      },
      {
        icon: "moisturizer",
        title: "수분 마무리",
        product: MOISTURIZER[oil],
        why: "앞서 채운 수분을 가두고 장벽을 보호해 하루 종일 편안한 피부 상태를 유지해줘요.",
      },
      {
        icon: "sunscreen",
        title: "자외선 차단",
        product: SUNSCREEN,
        why: "자외선으로 인한 자극과 톤 변화가 쌓이지 않도록 막아주는, 절대 빼놓으면 안 되는 마무리 단계예요.",
      },
    ];

    const stepCard = (s, n) => `
      <div class="care-step${s.isFivsoc ? " care-step-featured" : ""}">
        <div class="care-step-visual" aria-hidden="true">${STEP_ICONS[s.icon]}</div>
        <div class="care-step-body">
          <div class="care-step-head">
            <span class="care-step-num">STEP ${n}</span>
            <h3>${s.title}</h3>
            ${s.badge ? `<span class="care-step-badge">${s.badge}</span>` : ""}
          </div>
          <p class="care-step-product">${s.product}</p>
          <p class="care-step-why">${s.why}</p>
          ${s.isFivsoc ? `<a class="care-step-cta" href="${FIVSOC_URL}" target="_blank" rel="noopener noreferrer">피브속 최저가 비밀링크</a>` : ""}
        </div>
      </div>
    `;

    tipsList.innerHTML = steps.map((s, i) => stepCard(s, i + 1)).join("");
  }

  function estimateSkinAge(m) {
    const index = m.textureScore * 0.13 + m.rednessScore * 0.04 + m.oilScore * 0.02;
    return Math.round(clamp(20 + index * 0.45, 20, 29));
  }

  function describeSkinCondition(m, concern) {
    const texture = levelOf(m.textureScore);
    if (concern === "redness") return "사진에서는 붉은기가 비교적 눈에 띄어 피부가 자극에 민감해진 상태일 수 있어요.";
    if (concern === "texture") return "사진에서는 명암 편차가 있어 피부결과 톤이 다소 고르게 보이지 않을 수 있어요.";
    if (concern === "oil") return "사진에서는 표면 반사가 높아 유분과 번들거림이 도드라져 보여요.";
    if (texture === "low") return "사진에서는 전반적인 결이 비교적 균일하게 보여 현재의 수분 장벽을 유지하는 관리가 좋아요.";
    return "사진에서는 수분·유분 균형이 크게 치우치지 않은 편으로 보여요.";
  }

  function ingredientAdvice(concern, oil) {
    if (concern === "redness") return "병풀추출물·판테놀·세라마이드";
    if (concern === "texture") return "저농도 AHA/PHA와 나이아신아마이드";
    if (concern === "oil") return "나이아신아마이드·징크 PCA·BHA";
    return oil === "low" ? "세라마이드·글리세린·히알루론산" : "판테놀·나이아신아마이드·글리세린";
  }

  // ---------- History ----------

  const HISTORY_KEY = "skinAnalysisHistory";
  const MAX_HISTORY = 20;
  const THUMB_DIM = 96;

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveHistory(entries) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // storage full or unavailable — silently skip persistence
    }
  }

  function makeThumbnail(img) {
    const scale = Math.min(1, THUMB_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.6);
  }

  function addHistoryEntry(m, img) {
    const entries = loadHistory();
    entries.unshift({
      id: Date.now(),
      date: new Date().toISOString(),
      rednessScore: m.rednessScore,
      oilScore: m.oilScore,
      textureScore: m.textureScore,
      skinType: SKIN_TYPE_LABEL[levelOf(m.oilScore)],
      thumb: makeThumbnail(img),
    });
    saveHistory(entries.slice(0, MAX_HISTORY));
    renderHistory();
  }

  function formatHistoryDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderHistory() {
    const entries = loadHistory();

    historyEmpty.hidden = entries.length > 0;
    clearHistoryBtn.hidden = entries.length === 0;

    historyList.innerHTML = entries
      .map(
        (e) => `
        <div class="history-item" data-id="${e.id}">
          <img class="history-thumb" src="${e.thumb}" alt="">
          <div class="history-info">
            <div class="history-date">${formatHistoryDate(e.date)}</div>
            <div class="history-type">${e.skinType} 피부</div>
            <div class="history-scores">
              <span>홍조 ${e.rednessScore}</span>
              <span>유분 ${e.oilScore}</span>
              <span>결 ${e.textureScore}</span>
            </div>
          </div>
          <button class="history-delete" type="button" data-id="${e.id}" aria-label="이 기록 삭제">✕</button>
        </div>
      `
      )
      .join("");
  }

  historyList.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-delete");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    saveHistory(loadHistory().filter((entry) => entry.id !== id));
    renderHistory();
  });

  clearHistoryBtn.addEventListener("click", () => {
    saveHistory([]);
    renderHistory();
  });

  renderHistory();
})();
