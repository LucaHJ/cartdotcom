(function () {
  const STORAGE_KEY = "efb228-study-progress-v1";
  const CONCEPT_TERMS = {
    equilibriumDefinition: [
      ["demand", "supply", "meet"],
      ["demand", "supply", "intersect"],
      ["demand", "supply", "cross"],
      ["quantity demanded", "quantity supplied"],
      ["qd", "qs"],
      "market clears",
    ],
    excessSupply: [
      "surplus",
      ["excess", "supply"],
      ["quantity supplied", "greater", "quantity demanded"],
      ["qs", "greater", "qd"],
      ["supply", "greater", "demand"],
      ["more", "supplied", "demanded"],
    ],
    downwardPricePressure: [
      ["price", "fall"],
      ["price", "drop"],
      ["price", "decrease"],
      ["price", "lower"],
      ["sellers", "lower", "price"],
      ["price", "down"],
    ],
  };
  const STUDY_GUIDES = {
    "Economic foundations": {
      title: "Economic Foundations",
      source: "Lecture 1",
      core: [
        "Economics studies choices under scarcity.",
        "Opportunity cost is the value of the next best alternative sacrificed.",
        "Marginal analysis compares marginal benefit with marginal cost.",
        "Positive statements are testable; normative statements involve what should happen.",
      ],
      slides: [
        "Lecture 1 frames economics around scarcity, choice, opportunity cost and optimisation.",
        "The pizza example shows optimal consumption where marginal benefit is at least marginal cost, with the optimum at MB = MC.",
        "The graph section reviews positive/negative slopes, intersections, tangency and basic economic diagrams.",
      ],
      checklist: [
        "Can you identify the opportunity cost in a scenario?",
        "Can you separate positive claims from normative claims?",
        "Can you explain why MB = MC is an optimisation rule?",
      ],
      errors: [
        "Calling every forgone option the opportunity cost instead of the next best alternative.",
        "Treating a value judgement as a factual positive claim.",
      ],
    },
    "PPF and trade": {
      title: "PPF and Trade",
      source: "Lecture 2",
      core: [
        "The PPF shows maximum combinations of two goods using available resources and technology.",
        "Points on the PPF are efficient; inside points are inefficient; outside points are unattainable.",
        "Comparative advantage depends on lower opportunity cost.",
        "Specialisation and trade can allow consumption beyond what each party could produce alone.",
      ],
      slides: [
        "The Robinson Crusoe example uses mangoes and fish to show attainable, inefficient and unattainable combinations.",
        "A bowed-out PPF illustrates increasing opportunity cost.",
        "The trade section links comparative advantage to gains from exchange.",
      ],
      checklist: [
        "Can you calculate opportunity cost from a PPF table?",
        "Can you explain why a PPF shifts outward?",
        "Can you identify comparative rather than absolute advantage?",
      ],
      errors: [
        "Using absolute productivity instead of opportunity cost to decide comparative advantage.",
        "Calling a point inside the PPF unattainable rather than inefficient.",
      ],
    },
    "Demand and supply": {
      title: "Demand and Supply",
      source: "Lecture 3",
      core: [
        "Demand reflects willingness and ability to pay; supply reflects willingness to accept and production incentives.",
        "Equilibrium occurs where quantity demanded equals quantity supplied.",
        "A demand or supply shift changes equilibrium price and quantity.",
        "A price above equilibrium creates surplus; below equilibrium creates shortage.",
      ],
      slides: [
        "Lecture 3 introduces markets as arrangements bringing buyers and sellers together at mutually agreeable prices.",
        "The second-hand textbook example links WTP and WTA to demand and supply.",
        "The equilibrium slides show how increases in demand or supply alter price and quantity.",
      ],
      checklist: [
        "Can you distinguish a shift in demand from a movement along demand?",
        "Can you state what happens when price is above or below equilibrium?",
        "Can you draw the new equilibrium after a demand or supply shift?",
      ],
      errors: [
        "Saying price falls above equilibrium without mentioning surplus or excess supply.",
        "Shifting supply when the scenario changes consumers' willingness to pay.",
      ],
    },
    "Elasticity and policy": {
      title: "Elasticity and Government Policy",
      source: "Lecture 4",
      core: [
        "PED measures responsiveness of quantity demanded to price.",
        "Elastic demand means total revenue moves opposite to price; inelastic demand means total revenue moves with price.",
        "Tax incidence falls more heavily on the less elastic side of the market.",
        "Binding price ceilings create shortages; binding price floors create surpluses.",
      ],
      slides: [
        "Lecture 4 uses the midpoint formula for elasticity calculations.",
        "The petrol tax examples show how taxes reduce consumption and split burden between buyers and sellers.",
        "Rent control and minimum wage examples show price ceilings and floors.",
      ],
      checklist: [
        "Can you calculate PED with percentage changes?",
        "Can you predict total revenue changes from elasticity?",
        "Can you draw tax wedges, shortages and surpluses?",
      ],
      errors: [
        "Ignoring the negative sign and then misclassifying elastic vs inelastic demand.",
        "Drawing a price ceiling above equilibrium and calling it binding.",
      ],
    },
    "Consumer choice": {
      title: "Consumer Choice",
      source: "Lecture 5",
      core: [
        "Indifference curves represent bundles giving the same utility.",
        "MRS is the rate at which a consumer will trade one good for another while holding utility constant.",
        "The budget line shows affordable bundles given income and prices.",
        "Consumer equilibrium is the best affordable bundle, usually where MRS equals the relative price.",
      ],
      slides: [
        "Lecture 5 builds market demand from individual consumer preferences.",
        "The ham and cheese examples connect budget equations, budget lines and indifference curves.",
        "The cash vs in-kind award section asks how transfer form changes the feasible set and optimal bundle.",
      ],
      checklist: [
        "Can you draw a budget line from prices and income?",
        "Can you identify the tangency condition?",
        "Can you explain how a price change rotates the budget line?",
      ],
      errors: [
        "Confusing MRS with the market price ratio instead of comparing the two.",
        "Choosing an unaffordable bundle above the budget line.",
      ],
    },
    "Production and costs": {
      title: "Production and Costs",
      source: "Lecture 6",
      core: [
        "Economic cost includes explicit and implicit opportunity costs.",
        "Short run means at least one input is fixed; long run means all inputs are variable.",
        "Diminishing marginal returns eventually reduce marginal product when more variable input is added to fixed input.",
        "MC crosses AVC and ATC at their minimum points.",
      ],
      slides: [
        "Lecture 6 distinguishes accounting profit from economic profit and normal profit.",
        "The product-curve examples build total, average and marginal product.",
        "The cost-curve section links diminishing returns to rising marginal cost and U-shaped average cost.",
      ],
      checklist: [
        "Can you compute TC, AVC, AFC, ATC and MC from a table?",
        "Can you explain why ATC lies above AVC?",
        "Can you identify economies and diseconomies of scale on LRAC?",
      ],
      errors: [
        "Forgetting implicit costs when discussing economic profit.",
        "Drawing MC crossing average curves away from their minimum points.",
      ],
    },
    "Game theory": {
      title: "Game Theory",
      source: "Lecture 7",
      core: [
        "A game involves strategic interaction where each player's payoff depends on others' choices.",
        "A dominant strategy is best regardless of the other player's action.",
        "A Nash equilibrium is a set of mutual best responses.",
        "Sequential games are solved with backward induction.",
      ],
      slides: [
        "Lecture 7 classifies games by timing, repetition and whether interests conflict.",
        "Prisoner's dilemma shows individually rational choices can produce a collectively worse outcome.",
        "Sequential-move examples introduce rollback reasoning and first-mover advantage.",
      ],
      checklist: [
        "Can you find best responses in a payoff matrix?",
        "Can you tell whether a dominant strategy exists?",
        "Can you solve a simple game tree from the end backward?",
      ],
      errors: [
        "Calling any good outcome a Nash equilibrium without checking unilateral deviations.",
        "Assuming cooperation happens in one-shot prisoner's dilemma games.",
      ],
    },
    "Perfect competition": {
      title: "Perfect Competition",
      source: "Lecture 8",
      core: [
        "Perfectly competitive firms are price takers.",
        "For a competitive firm, MR equals market price.",
        "Profit maximisation occurs where P = MR = MC.",
        "The short-run shutdown rule is P below minimum AVC.",
        "Long-run equilibrium has zero economic profit and P equal to minimum LRAC.",
      ],
      slides: [
        "Lecture 8 links firm demand to a perfectly elastic demand curve at market price.",
        "The shutdown slides identify the MC curve above minimum AVC as the short-run supply curve.",
        "The welfare section defines consumer surplus, producer surplus and social surplus.",
      ],
      checklist: [
        "Can you apply P = MC to choose output?",
        "Can you distinguish shutdown from exit?",
        "Can you identify CS, PS and social surplus on a graph?",
      ],
      errors: [
        "Using the monopoly rule MR = MC without remembering that MR = P for competitive firms.",
        "Shutting down whenever P < ATC instead of P < AVC in the short run.",
      ],
    },
    Monopoly: {
      title: "Monopoly",
      source: "Lecture 9",
      core: [
        "A monopolist is a single seller facing the market demand curve.",
        "For a single-price monopolist, MR lies below demand.",
        "The monopolist chooses quantity where MR = MC, then reads price from demand.",
        "Monopoly usually creates deadweight loss by restricting output below the efficient quantity.",
      ],
      slides: [
        "Lecture 9 introduces barriers to entry such as patents, licences, key resources and economies of scale.",
        "The MR slides explain why selling more requires lowering price.",
        "The natural monopoly section compares marginal-cost pricing with average-cost pricing regulation.",
      ],
      checklist: [
        "Can you draw demand, MR and MC in the correct positions?",
        "Can you find monopoly Q and P from MR = MC and demand?",
        "Can you explain deadweight loss relative to competition?",
      ],
      errors: [
        "Setting monopoly price where MR = MC instead of using MR = MC to find quantity first.",
        "Assuming monopoly always earns profit; it can make losses if price is below average cost.",
      ],
    },
    "Imperfect competition": {
      title: "Imperfect Competition",
      source: "Lecture 10",
      core: [
        "Monopolistic competition has many firms selling differentiated products.",
        "Short-run supernormal profit attracts entry, shifting each firm's demand left.",
        "Long-run monopolistic competition earns normal profit but has excess capacity.",
        "Oligopoly involves strategic interdependence among a few firms.",
        "Cartels are unstable because firms have incentives to cheat.",
      ],
      slides: [
        "Lecture 10 uses concentration ratios and HHI to discuss market concentration.",
        "The monopolistic competition diagrams show short-run profit and long-run tangency with AC.",
        "The oligopoly section links collusion, cartels and repeated games to prisoner's dilemma logic.",
      ],
      checklist: [
        "Can you calculate a four-firm concentration ratio or HHI?",
        "Can you explain long-run entry in monopolistic competition?",
        "Can you identify the incentive to cheat in a cartel payoff matrix?",
      ],
      errors: [
        "Treating monopolistic competition as perfect competition despite product differentiation.",
        "Forgetting that oligopoly firms consider rivals' reactions.",
      ],
    },
    Externalities: {
      title: "Externalities",
      source: "Lecture 11",
      core: [
        "An externality is a cost or benefit affecting a third party outside the transaction.",
        "Negative production externalities make social cost exceed private cost.",
        "The market overproduces because firms ignore external costs.",
        "Coase bargaining can reach efficiency when property rights are clear and transaction costs are low.",
      ],
      slides: [
        "Lecture 11 uses a textile factory and fish farm to show private cost, external cost and social cost.",
        "The Coase theorem examples show how property rights affect payments but not efficiency under low transaction costs.",
        "Policy solutions internalise externalities through taxes, regulation or property-right approaches.",
      ],
      checklist: [
        "Can you place MSC above MPC on a graph?",
        "Can you identify market quantity and efficient quantity?",
        "Can you explain when Coase bargaining fails?",
      ],
      errors: [
        "Saying the market is efficient while ignoring the external cost.",
        "Drawing efficient output to the right of market output for a negative production externality.",
      ],
    },
    "Public goods": {
      title: "Public Goods and Common Resources",
      source: "Lecture 12",
      core: [
        "Goods are classified by rivalry and excludability.",
        "Public goods are non-rival and non-excludable.",
        "Public good demand is found by vertically summing individual marginal benefits.",
        "Free riding causes private under-provision.",
        "Common resources are rival and non-excludable, creating overuse risk.",
      ],
      slides: [
        "Lecture 12 uses streetlights to show why private provision may be zero even when social benefit is positive.",
        "The free-rider problem explains why people may not reveal their true valuation.",
        "The overfishing section applies common-property logic to the tragedy of the commons.",
      ],
      checklist: [
        "Can you classify goods using rivalry and excludability?",
        "Can you explain why public goods are vertically summed?",
        "Can you distinguish public goods from publicly provided goods?",
      ],
      errors: [
        "Calling every government-provided good a public good.",
        "Confusing public goods with common resources.",
      ],
    },
  };
  const state = {
    current: null,
    offering: null,
    progress: loadProgress(),
    savedQuestionScroll: 0,
  };

  const els = {
    topicFilter: document.getElementById("topicFilter"),
    typeFilter: document.getElementById("typeFilter"),
    modeSelect: document.getElementById("modeSelect"),
    scoreValue: document.getElementById("scoreValue"),
    answeredCount: document.getElementById("answeredCount"),
    streakCount: document.getElementById("streakCount"),
    weakAreas: document.getElementById("weakAreas"),
    questionMeta: document.getElementById("questionMeta"),
    questionTitle: document.getElementById("questionTitle"),
    questionPrompt: document.getElementById("questionPrompt"),
    questionTags: document.getElementById("questionTags"),
    questionBody: document.getElementById("questionBody"),
    studyPanel: document.getElementById("studyPanel"),
    studyMeta: document.getElementById("studyMeta"),
    studyTitle: document.getElementById("studyTitle"),
    studyContent: document.getElementById("studyContent"),
    backToQuestion: document.getElementById("backToQuestion"),
    feedback: document.getElementById("feedback"),
    submitAnswer: document.getElementById("submitAnswer"),
    showAnswer: document.getElementById("showAnswer"),
    nextQuestion: document.getElementById("nextQuestion"),
    resetProgress: document.getElementById("resetProgress"),
    historyList: document.getElementById("historyList"),
  };

  init();

  function init() {
    populateFilters();
    els.topicFilter.addEventListener("change", pickQuestion);
    els.typeFilter.addEventListener("change", pickQuestion);
    els.modeSelect.addEventListener("change", pickQuestion);
    els.nextQuestion.addEventListener("click", pickQuestion);
    els.submitAnswer.addEventListener("click", markCurrent);
    els.showAnswer.addEventListener("click", showAnswer);
    els.resetProgress.addEventListener("click", resetProgress);
    els.backToQuestion.addEventListener("click", closeStudyPage);
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-study-topic]");
      if (!target) return;
      openStudyPage(target.dataset.studyTopic);
    });
    updateStats();
    pickQuestion();
  }

  function populateFilters() {
    const topics = unique(QUESTIONS.map((q) => q.topic));
    const types = unique(QUESTIONS.map((q) => q.type));
    els.topicFilter.innerHTML = optionHtml("all", "All topics") + topics.map((t) => optionHtml(t, t)).join("");
    els.typeFilter.innerHTML = optionHtml("all", "All types") + types.map((t) => optionHtml(t, labelType(t))).join("");
  }

  function optionHtml(value, label) {
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }

  function pickQuestion() {
    const candidates = filteredQuestions();
    if (!candidates.length) return;
    const mode = els.modeSelect.value;
    let pool = candidates.filter((q) => !isMastered(q.id));
    if (!pool.length) pool = candidates;

    if (mode === "unseen") {
      const unseen = pool.filter((q) => !state.progress.byQuestion[q.id]);
      pool = unseen.length ? unseen : pool;
    }

    if (mode === "weak") {
      const weakTopics = getWeakTopics().map((x) => x.topic);
      const weak = pool.filter((q) => weakTopics.includes(q.topic));
      pool = weak.length ? weak : pool;
    }

    const previousId = state.current && state.current.id;
    const noRepeat = pool.length > 1 ? pool.filter((q) => q.id !== previousId) : pool;
    state.current = weightedPick(noRepeat);
    startOffering(state.current);
    renderQuestion(state.current);
  }

  function weightedPick(questions) {
    const weighted = questions.map((question) => ({ question, weight: questionWeight(question.id) }));
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    for (const item of weighted) {
      cursor -= item.weight;
      if (cursor <= 0) return item.question;
    }
    return weighted[weighted.length - 1].question;
  }

  function questionWeight(id) {
    const record = state.progress.byQuestion[id];
    if (!record) return 2.2;
    const lastEffective = record.lastEffective ?? record.last ?? 0;
    const bestEffective = record.bestEffective ?? record.best ?? 0;
    const studyMinutes = (record.lastStudyTimeMs || 0) / 60000;
    const difficulty = Math.max(0, 1 - lastEffective) * 5;
    const dependency = Math.min(3, studyMinutes * 0.6);
    const repeatDifficulty = Math.min(2, Math.max(0, record.attempts - (record.cleanPerfects || 0)) * 0.25);
    const bestRelief = Math.max(0, 1 - bestEffective) * 1.5;
    return 0.25 + difficulty + dependency + repeatDifficulty + bestRelief;
  }

  function startOffering(question) {
    state.offering = {
      id: question.id,
      answered: false,
      studyOpenCount: 0,
      studyTimeMs: 0,
      studyStartedAt: null,
      startedAt: Date.now(),
    };
  }

  function isMastered(id) {
    return (state.progress.byQuestion[id]?.cleanPerfects || 0) >= 3;
  }

  function filteredQuestions() {
    return QUESTIONS.filter((q) => {
      const topicOk = els.topicFilter.value === "all" || q.topic === els.topicFilter.value;
      const typeOk = els.typeFilter.value === "all" || q.type === els.typeFilter.value;
      return topicOk && typeOk;
    });
  }

  function renderQuestion(question) {
    els.feedback.hidden = true;
    els.feedback.className = "feedback";
    els.feedback.innerHTML = "";
    els.questionMeta.textContent = `${labelType(question.type)} - ${question.topic} - ${question.source}`;
    els.questionTitle.textContent = question.title;
    els.questionPrompt.textContent = question.prompt;
    renderQuestionTags(question);
    els.questionBody.innerHTML = "";

    if (question.type === "multiple-choice") renderMultipleChoice(question);
    if (question.type === "short-answer" || question.type === "long-answer") renderWritten(question);
    if (question.type === "graph") renderGraph(question);
    renderPreviousAttemptSummary(question);
    setQuestionLocked(false);
  }

  function renderPreviousAttemptSummary(question) {
    const record = state.progress.byQuestion[question.id];
    if (!record) return;
    const summary = document.createElement("div");
    summary.className = "previous-summary";
    summary.innerHTML = `
      <strong>Previous attempt</strong>
      <span>${Math.round((record.last || 0) * 100)}% accuracy</span>
      <span>${formatDuration(record.lastStudyTimeMs || 0)} study page time</span>
      <span>${record.studyOpenCount || 0} total study opens</span>
    `;
    els.questionBody.prepend(summary);
  }

  function setQuestionLocked(locked) {
    document.querySelectorAll("#questionBody input, #questionBody textarea, #questionBody button").forEach((el) => {
      el.disabled = locked;
    });
    els.submitAnswer.disabled = locked;
    els.showAnswer.disabled = locked;
  }

  function renderQuestionTags(question) {
    const tags = unique([question.topic, ...(question.tags || [])]);
    els.questionTags.innerHTML = tags
      .map((tag) => `<button type="button" class="study-tag" data-study-topic="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
      .join("");
  }

  function renderMultipleChoice(question) {
    const wrap = document.createElement("div");
    wrap.className = "options";
    question.options.forEach((option, index) => {
      const label = document.createElement("label");
      label.className = "option";
      label.innerHTML = `<input type="radio" name="mcq" value="${index}"><span>${escapeHtml(option)}</span>`;
      wrap.appendChild(label);
    });
    els.questionBody.appendChild(wrap);
  }

  function renderWritten(question) {
    const textarea = document.createElement("textarea");
    textarea.id = "writtenAnswer";
    textarea.placeholder = question.type === "short-answer" ? "Write a concise answer..." : "Write a structured answer with explanation...";
    els.questionBody.appendChild(textarea);
  }

  function renderGraph(question) {
    if (question.graphMode === "choice") {
      renderGraphChoice(question);
      return;
    }
    renderGraphCompletion(question);
  }

  function renderGraphChoice(question) {
    const wrap = document.createElement("div");
    wrap.className = "graph-choice-grid";
    question.options.forEach((option, index) => {
      const label = document.createElement("label");
      label.className = "graph-choice";
      label.innerHTML = `
        <input type="radio" name="graphChoice" value="${index}">
        <span class="graph-choice-title">${escapeHtml(option.label)}</span>
        ${graphSvg(option.diagram)}
      `;
      wrap.appendChild(label);
    });
    els.questionBody.appendChild(wrap);
  }

  function renderGraphCompletion(question) {
    const layout = document.createElement("div");
    layout.className = "graph-layout";
    layout.innerHTML = `
      <div class="canvas-wrap"><canvas id="graphCanvas" width="760" height="430" aria-label="Graph completion canvas"></canvas></div>
      <div class="graph-tools">
        <button type="button" id="clearCanvas">Clear additions</button>
        <div class="checklist" id="graphChecks"></div>
      </div>
    `;
    els.questionBody.appendChild(layout);
    const checks = document.getElementById("graphChecks");
    question.checks.forEach((check, index) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" value="${index}"><span>${escapeHtml(check.label)}</span>`;
      checks.appendChild(label);
    });
    setupCanvas(document.getElementById("graphCanvas"), question.template);
    document.getElementById("clearCanvas").addEventListener("click", () => {
      const canvas = document.getElementById("graphCanvas");
      const ctx = canvas.getContext("2d");
      drawTemplate(ctx, canvas, question.template);
    });
  }

  function setupCanvas(canvas, template) {
    const ctx = canvas.getContext("2d");
    let drawing = false;
    drawTemplate(ctx, canvas, template);

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const p = point(event);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#17211c";
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    canvas.addEventListener("pointerup", () => (drawing = false));
    canvas.addEventListener("pointercancel", () => (drawing = false));
  }

  function drawAxes(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#d9dfd8";
    ctx.lineWidth = 1;
    for (let x = 80; x < canvas.width; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, canvas.height - 54);
      ctx.stroke();
    }
    for (let y = 30; y < canvas.height - 54; y += 50) {
      ctx.beginPath();
      ctx.moveTo(62, y);
      ctx.lineTo(canvas.width - 24, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#17211c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(62, 24);
    ctx.lineTo(62, canvas.height - 54);
    ctx.lineTo(canvas.width - 26, canvas.height - 54);
    ctx.stroke();
    ctx.fillStyle = "#617066";
    ctx.font = "16px Segoe UI";
    ctx.fillText("Price / Cost", 18, 24);
    ctx.fillText("Quantity", canvas.width - 98, canvas.height - 20);
  }

  function markCurrent() {
    const question = state.current;
    if (state.offering?.answered) {
      flashMessage("This offering is locked. Use Next to continue; this question can return later randomly.");
      return;
    }
    let result;
    if (question.type === "multiple-choice") result = markMultipleChoice(question);
    if (question.type === "short-answer" || question.type === "long-answer") result = markWritten(question);
    if (question.type === "graph") result = markGraph(question);
    if (!result) return;
    recordAttempt(question, result);
    if (state.offering) state.offering.answered = true;
    renderFeedback(question, result);
    setQuestionLocked(true);
    updateStats();
  }

  function markMultipleChoice(question) {
    const selected = document.querySelector('input[name="mcq"]:checked');
    if (!selected) {
      flashMessage("Choose an option first.");
      return null;
    }
    const selectedIndex = Number(selected.value);
    const correct = selectedIndex === question.answer;
    return {
      score: correct ? 1 : 0,
      max: 1,
      missed: correct ? [] : [`Correct answer: ${question.options[question.answer]}`],
      matched: correct ? ["Selected the correct option."] : [],
      answerText: question.explanation,
    };
  }

  function markWritten(question) {
    const answer = document.getElementById("writtenAnswer").value.trim();
    if (!answer) {
      flashMessage("Write an answer first.");
      return null;
    }
    const normalized = normalize(answer);
    const matched = [];
    const missed = [];
    let score = 0;
    question.rubric.forEach((item) => {
      const ok = rubricItemMatches(normalized, item);
      if (ok) {
        score += item.points;
        matched.push(item.label);
      } else {
        missed.push(item.label);
      }
    });
    return {
      score,
      max: question.rubric.reduce((sum, item) => sum + item.points, 0),
      matched,
      missed,
      answerText: question.modelAnswer,
    };
  }

  function rubricItemMatches(answer, item) {
    if (item.any?.some((phrase) => hasPhrase(answer, phrase))) return true;
    if (item.all?.every((phrase) => hasPhrase(answer, phrase))) return true;
    if (item.concepts?.some((concept) => conceptMatches(answer, concept))) return true;
    return (item.keywords || []).some((group) => group.every((word) => hasPhrase(answer, word)));
  }

  function conceptMatches(answer, concept) {
    const terms = CONCEPT_TERMS[concept] || [];
    return terms.some((term) => {
      if (Array.isArray(term)) return term.every((part) => hasPhrase(answer, part));
      return hasPhrase(answer, term);
    });
  }

  function hasPhrase(answer, phrase) {
    const value = normalize(phrase);
    if (!value) return false;
    return answer.includes(value);
  }

  function markGraph(question) {
    if (question.graphMode === "choice") return markGraphChoice(question);
    const selected = new Set(
      Array.from(document.querySelectorAll("#graphChecks input:checked")).map((input) => Number(input.value))
    );
    const matched = [];
    const missed = [];
    let score = 0;
    question.checks.forEach((check, index) => {
      if (selected.has(index)) {
        score += check.points;
        matched.push(check.label);
      } else {
        missed.push(check.label);
      }
    });
    return {
      score,
      max: question.checks.reduce((sum, item) => sum + item.points, 0),
      matched,
      missed,
      answerText: question.modelAnswer,
    };
  }

  function markGraphChoice(question) {
    const selected = document.querySelector('input[name="graphChoice"]:checked');
    if (!selected) {
      flashMessage("Choose a graph first.");
      return null;
    }
    const selectedIndex = Number(selected.value);
    const correct = selectedIndex === question.answer;
    return {
      score: correct ? 1 : 0,
      max: 1,
      missed: correct ? [] : [`Correct graph: ${question.options[question.answer].label}`],
      matched: correct ? ["Selected the correct graph."] : [],
      answerText: question.modelAnswer,
    };
  }

  function showAnswer() {
    const question = state.current;
    const answerText = question.explanation || question.modelAnswer;
    renderFeedback(question, {
      score: 0,
      max: question.type === "multiple-choice" ? 1 : 0,
      matched: [],
      missed: [],
      answerText,
      revealOnly: true,
    });
  }

  function renderFeedback(question, result) {
    const percent = result.max ? Math.round((result.score / result.max) * 100) : 0;
    const kind = result.revealOnly ? "partial" : percent >= 80 ? "good" : percent >= 45 ? "partial" : "bad";
    els.feedback.hidden = false;
    els.feedback.className = `feedback ${kind}`;
    const title = result.revealOnly ? "Model answer" : `${percent}% - ${scoreLabel(percent)}`;
    els.feedback.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${result.revealOnly ? "" : `<p>You scored ${result.score} out of ${result.max}.</p>`}
      ${result.revealOnly ? "" : `<p class="study-impact">Study page used for ${formatDuration(state.offering?.studyTimeMs || 0)} during this offering. Effective scheduling score: ${Math.round(effectiveScore(result.max ? result.score / result.max : 0, state.offering?.studyTimeMs || 0) * 100)}%.</p>`}
      ${result.matched.length ? `<strong>What you got right</strong><ul>${result.matched.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
      ${result.missed.length ? `<strong>Where the errors were</strong><ul>${result.missed.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
      <strong>Model answer</strong>
      <p>${escapeHtml(result.answerText)}</p>
    `;
  }

  function scoreLabel(percent) {
    if (percent >= 90) return "excellent";
    if (percent >= 75) return "solid";
    if (percent >= 50) return "partial";
    return "needs revision";
  }

  function recordAttempt(question, result) {
    const percent = result.max ? result.score / result.max : 0;
    const studyTimeMs = state.offering?.studyTimeMs || 0;
    const effectivePercent = effectiveScore(percent, studyTimeMs);
    const previous = state.progress.byQuestion[question.id] || {};
    const cleanPerfect = percent === 1 && studyTimeMs <= 30000;
    state.progress.attempts.push({
      id: question.id,
      title: question.title,
      topic: question.topic,
      type: question.type,
      score: result.score,
      max: result.max,
      percent,
      effectivePercent,
      studyTimeMs,
      studyOpenCount: state.offering?.studyOpenCount || 0,
      when: new Date().toISOString(),
    });
    state.progress.byQuestion[question.id] = {
      attempts: (previous.attempts || 0) + 1,
      best: Math.max(previous.best || 0, percent),
      bestEffective: Math.max(previous.bestEffective || 0, effectivePercent),
      last: percent,
      lastEffective: effectivePercent,
      lastStudyTimeMs: studyTimeMs,
      studyOpenCount: (previous.studyOpenCount || 0) + (state.offering?.studyOpenCount || 0),
      totalStudyTimeMs: (previous.totalStudyTimeMs || 0) + studyTimeMs,
      cleanPerfects: (previous.cleanPerfects || 0) + (cleanPerfect ? 1 : 0),
    };
    state.progress.streak = percent >= 0.75 ? state.progress.streak + 1 : 0;
    saveProgress();
  }

  function effectiveScore(percent, studyTimeMs) {
    const minutes = studyTimeMs / 60000;
    const studyPenalty = Math.min(0.65, minutes * 0.08);
    return Math.max(0, percent - studyPenalty);
  }

  function updateStats() {
    const attempts = state.progress.attempts;
    const scored = attempts.filter((a) => a.max > 0);
    const avg = scored.length ? scored.reduce((sum, a) => sum + a.percent, 0) / scored.length : 0;
    els.scoreValue.textContent = `${Math.round(avg * 100)}%`;
    els.answeredCount.textContent = `${attempts.length} answered`;
    els.streakCount.textContent = `${state.progress.streak} streak`;
    renderWeakAreas();
    renderHistory();
  }

  function renderWeakAreas() {
    const weak = getWeakTopics();
    if (!weak.length) {
      els.weakAreas.textContent = "Answer questions to reveal weak areas.";
      return;
    }
    els.weakAreas.innerHTML = weak
      .slice(0, 5)
      .map(
        (item) => `
          <button type="button" class="weak-chip" data-study-topic="${escapeHtml(item.topic)}">
            <span>${escapeHtml(item.topic)}</span>
            <strong>${Math.round(item.avg * 100)}%</strong>
          </button>
        `
      )
      .join("");
  }

  function openStudyPage(topic) {
    const guide = STUDY_GUIDES[topic] || makeFallbackGuide(topic);
    if (state.offering && !state.offering.studyStartedAt) {
      state.offering.studyOpenCount += 1;
      state.offering.studyStartedAt = Date.now();
    }
    const slideExtracts = (window.EXTRACTED_SLIDES && window.EXTRACTED_SLIDES[topic]) || [];
    state.savedQuestionScroll = window.scrollY;
    els.studyMeta.textContent = `${guide.source} - study notes`;
    els.studyTitle.textContent = guide.title;
    els.studyContent.innerHTML = `
      <div class="study-section">
        <h3>Core Ideas</h3>
        <ul>${guide.core.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="study-section">
        <h3>Lecture Explanation</h3>
        ${guide.slides.map((item) => `<blockquote>${escapeHtml(item)}</blockquote>`).join("")}
      </div>
      <div class="study-section">
        <h3>Slide Extracts</h3>
        <div class="slide-extracts">
          ${
            slideExtracts.length
              ? slideExtracts.map((item) => `<article class="slide-extract"><strong>Slide ${item.slide}</strong><p>${escapeHtml(item.text)}</p></article>`).join("")
              : "<p>No slide extracts are available for this topic.</p>"
          }
        </div>
      </div>
      <div class="study-section">
        <h3>Practice Checklist</h3>
        <ul>${guide.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="study-section">
        <h3>Common Errors</h3>
        <ul>${guide.errors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    `;
    document.querySelector(".question-card").hidden = true;
    document.querySelector(".history-panel").hidden = true;
    els.studyPanel.hidden = false;
    els.nextQuestion.disabled = true;
    els.submitAnswer.disabled = true;
    els.showAnswer.disabled = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeStudyPage() {
    if (state.offering?.studyStartedAt) {
      state.offering.studyTimeMs += Date.now() - state.offering.studyStartedAt;
      state.offering.studyStartedAt = null;
    }
    els.studyPanel.hidden = true;
    document.querySelector(".question-card").hidden = false;
    document.querySelector(".history-panel").hidden = false;
    els.nextQuestion.disabled = false;
    els.submitAnswer.disabled = false;
    els.showAnswer.disabled = false;
    window.scrollTo({ top: state.savedQuestionScroll, behavior: "smooth" });
  }

  function makeFallbackGuide(topic) {
    return {
      title: topic,
      source: "EFB228",
      core: ["Review the linked lecture topic and focus on definitions, graph logic, and the decision rule used in the question."],
      slides: ["No custom study snippet has been written for this topic yet."],
      checklist: ["Can you define the key terms?", "Can you explain the graph movement or equilibrium condition?", "Can you state the welfare or behavioural implication?"],
      errors: ["Using memorised labels without explaining the economic mechanism."],
    };
  }

  function getWeakTopics() {
    const byTopic = {};
    state.progress.attempts.forEach((attempt) => {
      if (!byTopic[attempt.topic]) byTopic[attempt.topic] = [];
      byTopic[attempt.topic].push(attempt.percent);
    });
    return Object.entries(byTopic)
      .map(([topic, values]) => ({ topic, avg: values.reduce((a, b) => a + b, 0) / values.length }))
      .filter((item) => item.avg < 0.75)
      .sort((a, b) => a.avg - b.avg);
  }

  function renderHistory() {
    const recent = state.progress.attempts.slice(-6).reverse();
    if (!recent.length) {
      els.historyList.textContent = "No attempts yet.";
      return;
    }
    els.historyList.innerHTML = recent
      .map(
        (item) => `
          <div class="history-item">
            <strong>${escapeHtml(item.title)}</strong>
            <div class="tag-row">
              <span class="tag">${escapeHtml(labelType(item.type))}</span>
              <span class="tag">${escapeHtml(item.topic)}</span>
              <span class="tag">${Math.round(item.percent * 100)}%</span>
            </div>
          </div>
        `
      )
      .join("");
  }

  function resetProgress() {
    if (!confirm("Reset all study progress?")) return;
    state.progress = emptyProgress();
    saveProgress();
    updateStats();
    pickQuestion();
  }

  function flashMessage(message) {
    els.feedback.hidden = false;
    els.feedback.className = "feedback partial";
    els.feedback.innerHTML = `<strong>${escapeHtml(message)}</strong>`;
  }

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyProgress();
    } catch {
      return emptyProgress();
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  }

  function emptyProgress() {
    return { attempts: [], byQuestion: {}, streak: 0 };
  }

  function unique(values) {
    return Array.from(new Set(values)).sort();
  }

  function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  function labelType(type) {
    return {
      "multiple-choice": "Multiple choice",
      "short-answer": "Short answer",
      "long-answer": "Long answer",
      graph: "Graph drawing",
    }[type] || type;
  }

  function normalize(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9.%$=<> -]/g, " ")
      .replace(/\bequals\b/g, "equal")
      .replace(/\bequalled\b/g, "equal")
      .replace(/\bequalling\b/g, "equal")
      .replace(/\bdrops\b/g, "drop")
      .replace(/\bdropped\b/g, "drop")
      .replace(/\bfalls\b/g, "fall")
      .replace(/\bfell\b/g, "fall")
      .replace(/\bdecreases\b/g, "decrease")
      .replace(/\bdecreased\b/g, "decrease")
      .replace(/\sin\s+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function drawTemplate(ctx, canvas, template) {
    drawAxes(ctx, canvas);
    if (template === "demandSupplyBase") {
      drawLine(ctx, 150, 315, 585, 95, "#8b3a2b", "S");
      drawLine(ctx, 150, 95, 585, 315, "#176b87", "D1");
      drawPoint(ctx, 368, 205, "E1");
    }
    if (template === "negativeExternalityBase") {
      drawLine(ctx, 145, 320, 585, 100, "#8b3a2b", "MPC / S");
      drawLine(ctx, 145, 90, 585, 315, "#176b87", "MB / D");
      drawPoint(ctx, 368, 208, "Qm");
    }
  }

  function drawLine(ctx, x1, y1, x2, y2, color, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "700 18px Segoe UI";
    ctx.fillText(label, x2 + 8, y2 + 5);
  }

  function drawPoint(ctx, x, y, label) {
    ctx.fillStyle = "#17211c";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "700 16px Segoe UI";
    ctx.fillText(label, x + 9, y - 8);
  }

  function graphSvg(diagram) {
    const parts = {
      axes: '<path d="M42 20V184H248" class="axis"/><text x="18" y="28">P</text><text x="238" y="205">Q</text>',
      supply: '<path d="M67 165L222 45" class="supply"/><text x="226" y="48">S</text>',
      demand: '<path d="M67 45L222 165" class="demand"/><text x="226" y="166">D</text>',
      demandRight: '<path d="M112 45L252 154" class="new"/><text x="253" y="154">D2</text>',
      demandLeft: '<path d="M38 45L178 154" class="new"/><text x="181" y="154">D2</text>',
      ceilingLow: '<path d="M42 135H248" class="policy"/><text x="53" y="130">Pc</text>',
      ceilingHigh: '<path d="M42 72H248" class="policy"/><text x="53" y="67">Pc</text>',
      floorHigh: '<path d="M42 72H248" class="floor"/><text x="53" y="67">Pf</text>',
      surplus: '<path d="M92 72V145M196 72V92" class="guide"/><text x="116" y="65">surplus</text>',
      shortage: '<path d="M92 135V92M196 135V145" class="guide"/><text x="111" y="154">shortage</text>',
      avc: '<path d="M65 150C100 82 150 82 185 150" class="demand"/><text x="188" y="150">AVC</text>',
      atc: '<path d="M60 126C104 45 166 45 218 126" class="supply"/><text x="222" y="126">ATC</text>',
      mc: '<path d="M90 172C118 142 130 92 214 38" class="mc"/><text x="218" y="40">MC</text>',
      monopolyD: '<path d="M60 52L224 165" class="demand"/><text x="226" y="166">D</text>',
      monopolyMR: '<path d="M68 72L170 176" class="new"/><text x="174" y="179">MR</text>',
      monopolyMC: '<path d="M72 142L226 88" class="supply"/><text x="229" y="90">MC</text>',
      msc: '<path d="M67 128L222 28" class="mc"/><text x="226" y="31">MSC</text>',
      mpc: '<path d="M67 165L222 65" class="supply"/><text x="226" y="68">MPC</text>',
      mb: '<path d="M67 45L222 165" class="demand"/><text x="226" y="166">MB</text>',
      welfare: '<path d="M67 165L222 45" class="supply"/><path d="M67 45L222 165" class="demand"/><path d="M145 105H42" class="policy"/><text x="100" y="88">CS</text><text x="100" y="134">PS</text>',
    };
    const diagrams = {
      demandIncreaseCorrect: [parts.axes, parts.supply, parts.demand, parts.demandRight],
      demandDecreaseWrong: [parts.axes, parts.supply, parts.demand, parts.demandLeft],
      priceCeilingCorrect: [parts.axes, parts.supply, parts.demand, parts.ceilingLow, parts.shortage],
      priceCeilingTooHigh: [parts.axes, parts.supply, parts.demand, parts.ceilingHigh],
      priceFloorWrong: [parts.axes, parts.supply, parts.demand, parts.floorHigh, parts.surplus],
      costCurvesCorrect: [parts.axes, parts.avc, parts.atc, parts.mc],
      costCurvesWrongAtcBelow: [parts.axes, parts.atc.replace("ATC", "AVC"), parts.avc.replace("AVC", "ATC"), parts.mc],
      welfareCorrect: [parts.axes, parts.welfare],
      monopolyCorrect: [parts.axes, parts.monopolyD, parts.monopolyMR, parts.monopolyMC],
      externalityCorrect: [parts.axes, parts.mb, parts.mpc, parts.msc],
    };
    return `
      <svg class="graph-svg" viewBox="0 0 280 220" role="img" aria-label="Graph option">
        <style>
          .axis,.guide{stroke:#66756d;stroke-width:2;fill:none}.supply{stroke:#8b3a2b;stroke-width:4;fill:none}.demand{stroke:#176b87;stroke-width:4;fill:none}.new,.mc{stroke:#0f766e;stroke-width:4;fill:none}.policy{stroke:#b45309;stroke-width:3;fill:none;stroke-dasharray:7 5}.floor{stroke:#7c3aed;stroke-width:3;fill:none;stroke-dasharray:7 5}text{font:700 14px Segoe UI;fill:#17211c}
        </style>
        ${(diagrams[diagram] || diagrams.demandIncreaseCorrect).join("")}
      </svg>
    `;
  }
})();
