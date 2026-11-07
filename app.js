/* 고객 한마디 분류기 — 화면.
 *
 * 흐름: 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js)
 * 채점: 정답 100건을 규칙으로, 또는 AI로(BATCH건씩 묶어서) 돌려 맞힌 비율을 잰다.
 * 모델: 화면 위쪽 «AI 모델» 에서 고른다. 고른 이름은 요청의 "model" 로 간다(비면 서버 기본값).
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, test: [], practice: [], aiResults: null, serverDefault: null };

  // AI에 한 번에 보내는 문장 수(채점). 서버의 MAX_TEXTS(20)보다 작게 둔다 — 느린 모델이 서버 대기 한도(60초)를 넘기지 않게.
  const BATCH = 10;

  async function load() {
    const [c, t, p] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("data/answer100.json").then(r => r.json()),
      fetch("data/practice200.json").then(r => r.json()),
    ]);
    S.criteria = c; S.test = t; S.practice = p;
    renderCriteria();
  }

  // ── 탭 ──────────────────────────────────────────────
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score", "rules"].forEach(k => { $("#tab-" + k).hidden = k !== b.dataset.tab; });
  }));

  // ── AI 모델 고르기 ──────────────────────────────────
  // 무료(Free tier)로 표시된 글쓰기 모델 5개. 출처: https://aistudio.google.com/docs/pricing (2026-11-07 확인).
  //   앞의 넷은 가격표 본문에서 직접 읽었고, 다섯째(프리뷰)는 요약본으로만 읽었다 — 다시 확인할 것.
  //   음성·번역·임베딩·TTS·이미지·영상 모델과, 지원 중단 표시가 붙은 모델은 뺐다.
  // 순서는 «추정»이다. 하루 요청 한도는 AI Studio 에 로그인해야 보이고 공식 문서에 표가 없어서
  //   한도가 높은 순서라는 근거를 찾지 못했다. 가격표에 나온 순서일 뿐이다.
  // 모델 이름은 자주 바뀐다. 목록에 없거나 사라진 이름은 «직접 입력…» 으로 쓴다.
  const MODELS = [
    { id: "gemini-3.8-flash" },
    { id: "gemini-3.6-flash" },
    { id: "gemini-3.5-flash-lite" },
    { id: "gemini-3.1-flash-lite" },
    { id: "gemini-3-flash-preview", note: "프리뷰" },
  ];
  const CUSTOM = "__custom__";
  const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/;   // 서버(api/classify.py)와 같은 규칙
  const PREF_KEY = "classifier.ai-model";
  const selEl = $("#model-select");
  const customEl = $("#model-custom");

  // localStorage 를 못 써도(시크릿 창 등) 앱은 그대로 돈다
  function readPref() {
    try {
      const v = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }
  function savePref() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ sel: selEl.value, custom: customEl.value })); }
    catch (e) { /* 기억만 못 할 뿐 */ }
  }

  function currentModel() {
    return (selEl.value === CUSTOM ? customEl.value.trim() : selEl.value);
  }

  function refreshModelLine() {
    const line = $("#model-now");
    const m = currentModel();
    line.classList.remove("bad");
    if (m && !MODEL_RE.test(m)) {
      line.classList.add("bad");
      line.textContent = "이 이름은 쓸 수 없습니다 — 영문·숫자와 . _ - 만, 64자 이하. 이대로 보내면 서버가 거절하고 규칙으로 분류합니다.";
    } else if (m) {
      line.textContent = `지금 호출하는 모델: ${m}`;
    } else {
      const why = selEl.value === CUSTOM ? " (직접 입력칸이 비어 있습니다)" : "";
      line.textContent = S.serverDefault
        ? `지금 호출하는 모델: 서버 기본값 — ${S.serverDefault}${why}`
        : `지금 호출하는 모델: 서버 기본값${why} — 서버 함수가 없으면 이름을 알 수 없습니다`;
    }
  }

  function initModelPicker() {
    selEl.innerHTML = [`<option value="">서버 기본값</option>`]
      .concat(MODELS.map(m => `<option value="${m.id}">${m.id}${m.note ? " · " + m.note : ""}</option>`))
      .concat(`<option value="${CUSTOM}">직접 입력…</option>`).join("");
    const pref = readPref();
    selEl.value = typeof pref.sel === "string" ? pref.sel : "";
    if (selEl.selectedIndex < 0) selEl.value = "";          // 목록에서 사라진 이름이면 서버 기본값으로
    customEl.value = typeof pref.custom === "string" ? pref.custom.slice(0, 64) : "";
    customEl.hidden = selEl.value !== CUSTOM;
    selEl.addEventListener("change", () => {
      customEl.hidden = selEl.value !== CUSTOM;
      if (!customEl.hidden) customEl.focus();
      savePref(); refreshModelLine();
    });
    customEl.addEventListener("input", () => { savePref(); refreshModelLine(); });
    refreshModelLine();
    // «서버 기본값»이 어떤 모델인지 서버에 묻는다 — 서버 함수가 없으면(로컬) 조용히 넘어간다
    fetch("api/classify").then(r => r.ok ? r.json() : null).then(j => {
      if (j && typeof j.default === "string") { S.serverDefault = j.default; refreshModelLine(); }
    }).catch(() => {});
  }
  initModelPicker();

  function setAiHeader(model) { $("#th-ai").textContent = model ? "AI · " + model : "AI"; }

  // ── AI 호출 ─────────────────────────────────────────
  async function askAI(maskedTexts, model) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria, model: model || "" }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (${r.status}) — 배포하면 생깁니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chips(el, res) {
    el.innerHTML = ["category", "sentiment", "urgency"]
      .map(k => `<span class="chip ${res[k]}">${res[k]}</span>`).join("");
  }

  // ── 분류해 보기 ─────────────────────────────────────
  $("#btn-sample").addEventListener("click", () => {
    const r = S.practice[Math.floor(Math.random() * S.practice.length)];
    $("#input").value = r.text;
  });

  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#sent").hidden = false;
    $("#sent-text").textContent = m.masked;
    $("#sent-found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${f.type} 가림</span>`).join("")
      : `<span class="muted">가린 것 없음</span>`;

    const rule = Rules.classify(m.masked, S.criteria);
    const ai = await askAI([m.masked], currentModel());
    const got = ai.results && ai.results[0];

    $("#result").hidden = false;
    if (got) {
      $("#main-by").textContent = "AI · " + (ai.model || "");
      chips($("#main-chips"), got);
      $("#main-reason").textContent = got.reason || "";
      $("#note").hidden = true;
    } else {
      $("#main-by").textContent = "규칙";
      chips($("#main-chips"), rule);
      $("#main-reason").textContent = `분류: ${rule.why.category} · 감정: ${rule.why.sentiment} · 긴급도: ${rule.why.urgency}`;
      $("#note").hidden = false;
      $("#note").textContent = `AI 없이 규칙으로만 분류했습니다 — ${ai.reason || "AI 응답 없음"}`;
    }
    chips($("#rule-chips"), rule);
    $("#rule-reason").textContent = `분류: ${rule.why.category}`;
    $("#card-rule").hidden = !got;

    btn.disabled = false; btn.textContent = "분류하기";
  });

  // ── 채점 ───────────────────────────────────────────
  function pct(x) { return x.toFixed(x % 1 ? 1 : 0) + "%"; }

  function showScore(who, s) {
    $("#score-table").hidden = false;
    for (const k of ["category", "sentiment", "urgency"]) {
      document.querySelector(`[data-k="${who}-${k}"]`).textContent = pct(s.accuracy[k]);
    }
    document.querySelector(`[data-k="${who}-all"]`).textContent = `${s.n - s.wrong.length} / ${s.n}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = (who === "ai" ? "— AI" : "— 규칙") + " · 정답 → 판정";
    $("#wrong-list").innerHTML = s.wrong.slice(0, 15).map(w => {
      const diff = ["category", "sentiment", "urgency"].filter(k => w.got[k] !== w.want[k])
        .map(k => `${w.want[k]}→${w.got[k]}`).join(" · ");
      return `<li><span class="t">${w.text}</span><br><span class="d">${diff}${w.note ? " · " + w.note : ""}</span></li>`;
    }).join("") + (s.wrong.length > 15 ? `<li class="d">… 외 ${s.wrong.length - 15}건</li>` : "");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    const s = Rules.score(S.test, r => Rules.classify(Mask.mask(r.text).masked, S.criteria));
    showScore("rule", s);
    $("#score-msg").hidden = true;
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    const masked = S.test.map(r => Mask.mask(r.text).masked);
    const model = currentModel();          // 채점 도중 드롭다운을 바꿔도 이번 채점은 처음 고른 모델로 끝까지
    const results = [];
    let used = "";
    for (let i = 0; i < masked.length; i += BATCH) {
      btn.textContent = `AI 채점 중… ${i}/${masked.length}`;
      let r = await askAI(masked.slice(i, i + BATCH), model);
      if (!r.results && r.timeout) {       // 느려서 끊긴 묶음만 한 번 더
        btn.textContent = `다시 시도… ${i}/${masked.length}`;
        r = await askAI(masked.slice(i, i + BATCH), model);
        if (!r.results && r.timeout) r.reason += " (한 번 다시 시도했지만 같은 결과였습니다)";
      }
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 — ${r.reason}`;
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      if (r.model) used = r.model;
      results.push(...r.results);
    }
    setAiHeader(used || model);
    // 답을 못 받은 문장은 «오답»으로 센다 — 빠진 것을 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-", urgency: "-" };
    S.aiResults = results;
    const s = Rules.score(S.test, (r, i) => results[i] || miss);
    showScore("ai", s);
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = !blank;
    if (blank) $("#score-msg").textContent = `AI가 답하지 않은 문장 ${blank}건은 오답으로 셌습니다.`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.test.map((r, i) => ({ id: r.id, text: r.text, 정답: r, AI: S.aiResults[i] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  // ── 기준 ───────────────────────────────────────────
  function renderCriteria() {
    const c = S.criteria;
    $("#owner").textContent = c.owner;
    $("#crit-cats").innerHTML = c.categories
      .map(x => `<tr><td>${x.name}</td><td>${x.definition}</td></tr>`).join("");
    $("#crit-priority").textContent = c.priority.join(" → ") + " 순서로 먼저 봅니다.";
    $("#crit-priority-reason").textContent = c.priority_reason;
    $("#crit-sent").textContent = c.sentiment.guide;
    $("#crit-urg").textContent = c.urgency.guide;
  }

  load();
})();
