import {
  defaults,
  analyse,
  METRICS,
  ringLabel,
  validateQuery,
  registerMetrics,
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const letters = ["A", "B", "C"];
const ageLabel = (g) =>
  g.minAge == null
    ? "Unknown"
    : g.minAge === g.maxAge
      ? String(g.minAge)
      : `${g.minAge}–${g.maxAge}`;
let snapshot,
  catalogue,
  query = defaults(),
  result,
  page = 0,
  discoveryLimit = 12;
let topic = "all",
  selectedFinding = null,
  saved = new Set();
try {
  saved = new Set(JSON.parse(localStorage.getItem("rare-air:saved") || "[]"));
} catch {}

function renderForm() {
  $("competition").value = query.type;
  $("mode").value = query.mode;
  $("measure").value = query.measure;
  $("relationship-scope").value = query.scope || "career";
  for (const id of ["first", "last"]) {
    $(id).innerHTML = Array.from(
      { length: snapshot.lastSeason - snapshot.firstSeason + 1 },
      (_, i) => snapshot.firstSeason + i,
    )
      .map((y) => `<option value="${y}">${y}</option>`)
      .join("");
    $(id).value = query[id];
  }
  $("conditions").innerHTML = query.rings
    .map(
      (r, i) =>
        `<fieldset class="condition ${r.enabled ? "" : "inactive"}" data-index="${i}"><legend class="sr-only">Condition ${letters[i]}</legend><div class="condition-title"><span class="condition-letter">${letters[i]}</span><label><input type="checkbox" data-field="enabled" ${r.enabled ? "checked" : ""}>Condition ${letters[i]}</label></div><div class="two-fields"><label>Statistic<select data-field="metric">${Object.entries(
          METRICS,
        )
          .map(
            ([key, m]) =>
              `<option value="${key}" ${r.metric === key ? "selected" : ""}>${m.label}</option>`,
          )
          .join(
            "",
          )}</select></label><label>At least<input data-field="threshold" type="number" min="0" max="100000" step="any" value="${r.threshold}" required></label></div><div class="two-fields"><label>Age from<input data-field="minAge" type="number" min="15" max="60" value="${r.minAge}" required></label><label>Through age<input data-field="maxAge" type="number" min="15" max="60" value="${r.maxAge}" required></label></div></fieldset>`,
    )
    .join("");
  updateModeNote();
}

function updateModeNote() {
  const pooled = $("mode").value === "pooled";
  const total = $("measure").value === "total";
  if (pooled) $("relationship-scope").value = "career";
  $("mode-note").textContent = pooled
    ? total
      ? "Add the statistic across every selected game in the age bracket."
      : "Total statistics ÷ total appearances across all selected games in the age bracket."
    : $("relationship-scope").value === "same-season"
      ? "Every condition must qualify in the same season, using only games inside each age bracket."
      : "Qualify in at least one season, using only the games played inside the age bracket. Conditions may be met in different seasons.";
}

function readForm() {
  return {
    scope:
      $("mode").value === "pooled" ? "career" : $("relationship-scope").value,
    type: Number($("competition").value),
    mode: $("mode").value,
    measure: $("measure").value,
    first: Number($("first").value),
    last: Number($("last").value),
    rings: [...document.querySelectorAll(".condition")].map((node) => {
      const r = {};
      node.querySelectorAll("[data-field]").forEach((input) => {
        r[input.dataset.field] =
          input.type === "checkbox"
            ? input.checked
            : input.tagName === "SELECT"
              ? input.value
              : input.value.trim() === ""
                ? NaN
                : Number(input.value);
      });
      return r;
    }),
  };
}

function setQuery(next, scroll = false) {
  while (next.rings.length < 3)
    next.rings.push({ ...defaults().rings[next.rings.length], enabled: false });
  validateQuery(next, snapshot);
  query = structuredClone(next);
  result = analyse(snapshot, query);
  page = 0;
  $("form-error").textContent = "";
  $("player-filter").value = "";
  $("player-detail").innerHTML = "";
  renderForm();
  renderResult();
  $("save-detail").disabled = !selectedFinding;
  history.replaceState(
    null,
    "",
    "#q=" + encodeURIComponent(JSON.stringify(query)),
  );
  if (scroll) {
    $("explorer").hidden = false;
    $("detail-bar").hidden = false;
    $("detail-bar").scrollIntoView({ behavior: "smooth" });
  }
}

function renderResult() {
  const count = result.intersection.length;
  $("result-title").textContent =
    count === 1
      ? snapshot.players[result.intersection[0]][1]
      : count
        ? `${fmt(count)} players. Shared rarities.`
        : "An empty intersection.";
  $("result-tag").textContent =
    count === 1
      ? "ONE OF ONE · IN THIS DATASET"
      : count
        ? "THE INTERSECTION"
        : "NO MATCHES IN THIS DATASET";
  const active = query.rings.filter((r) => r.enabled);
  $("result-description").textContent =
    `${count === 1 ? "The only player matching" : count ? "These players match" : "No recorded player matches"} ${active.length === 1 ? "this condition" : `all ${active.length} conditions`} in the selected ${query.type === 1 ? "playoff" : "regular-season"} data. ${query.scope === "same-season" ? "Every condition qualifies in the same season." : query.mode === "season" ? "Conditions may qualify in different seasons." : "All selected games pooled within each age bracket."}`;
  const colors = ["#d6ef83", "#87b9be", "#dda685"];
  const centers = [
    [195, 158],
    [365, 158],
    [280, 295],
  ];
  const positions = {
    1: [137, 139],
    2: [423, 139],
    3: [280, 112],
    4: [280, 355],
    5: [213, 250],
    6: [347, 250],
    7: [280, 209],
  };
  const regionNames = (mask) =>
    letters.filter((_, i) => mask & (1 << i)).join(" + ");
  const enabled = query.rings.map((r) => r.enabled);
  $("diagram").innerHTML =
    `<svg id="venn" viewBox="0 0 560 450" role="group" aria-label="Venn diagram showing exclusive player counts"><title>Player overlap for the selected conditions</title>${centers.map(([x, y], i) => `<circle class="venn-circle" cx="${x}" cy="${y}" r="132" fill="${colors[i]}" stroke="${colors[i]}" opacity="${enabled[i] ? 1 : 0.12}"/>`).join("")}<text x="70" y="24" class="venn-label">A</text><text x="486" y="24" class="venn-label">B</text><text x="278" y="449" class="venn-label">C</text>${Object.entries(
      positions,
    )
      .filter(([m]) => (Number(m) & result.maskAll) === Number(m))
      .map(
        ([m, [x, y]]) =>
          `<g class="region-button" data-mask="${m}" role="button" tabindex="0" aria-label="${esc(regionNames(Number(m)))} only: ${result.regions[m].length} players" aria-pressed="${Number(m) === result.maskAll}"><circle cx="${x}" cy="${y - 8}" r="28"/><text class="venn-count" x="${x}" y="${y}" text-anchor="middle">${result.regions[m].length}</text></g>`,
      )
      .join("")}</svg>`;
  $("diagram")
    .querySelectorAll("[data-mask]")
    .forEach((g) => {
      const choose = () => {
        $("region").value = g.dataset.mask;
        page = 0;
        renderTable();
      };
      g.addEventListener("click", choose);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
    });
  $("set-legend").innerHTML = query.rings
    .map(
      (r, i) =>
        `<div class="legend-item"><strong>${letters[i]} · ${r.enabled ? esc(ringLabel(r, query.measure)) : "Disabled"}</strong>${r.enabled ? `${fmt(result.rings[i].members.size)} players in this set` : "Enable to add a condition"}</div>`,
    )
    .join("");
  $("universe-count").textContent =
    `${fmt(result.union.length)} players in the union · seasons ending ${query.first}–${query.last}`;
  $("region").innerHTML =
    '<option value="intersection">All enabled conditions</option><option value="union">Any enabled condition</option>' +
    Object.entries(positions)
      .filter(([m]) => (Number(m) & result.maskAll) === Number(m))
      .map(
        ([m]) =>
          `<option value="${m}">${regionNames(Number(m))} only (${result.regions[m].length})</option>`,
      )
      .join("");
  if (query.scope === "same-season") {
    $("diagram").innerHTML =
      `<div class="funnel">${active.map((r, i) => `<div class="funnel-row"><span>${esc(ringLabel(r, query.measure))}</span><strong>${fmt(result.rings[query.rings.indexOf(r)].members.size)}</strong></div>`).join("")}<div class="funnel-final"><span>All conditions in the same season</span><strong>${fmt(count)} ${count === 1 ? "player" : "players"}</strong></div></div>`;
    document.querySelector(".diagram-note").textContent =
      "Individual sets may be achieved in different years. The combined count requires every condition in the same season.";
    $("region").innerHTML =
      '<option value="intersection">All conditions in the same season</option><option value="union">Any individual condition</option>';
    $("result-description").textContent =
      `${count === 1 ? "The only player" : fmt(count) + " players"} meeting all enabled conditions in at least one shared ${query.type ? "playoff run" : "regular season"}, during seasons ending ${query.first}–${query.last}.`;
  } else {
    document.querySelector(".diagram-note").textContent =
      "Numbers count players in each exclusive region. Select a number to inspect it. Circle sizes are illustrative.";
  }
  renderTable();
  if (count === 1) renderPlayer(result.intersection[0]);
}

function visiblePlayers() {
  const region = $("region").value;
  const players =
    region === "intersection"
      ? result.intersection
      : region === "union"
        ? result.union
        : result.regions[Number(region)] || [];
  const filter = $("player-filter").value.trim().toLocaleLowerCase();
  return players
    .filter((p) => snapshot.players[p][1].toLocaleLowerCase().includes(filter))
    .sort((a, b) =>
      snapshot.players[a][1].localeCompare(snapshot.players[b][1]),
    );
}

function renderTable() {
  const players = visiblePlayers(),
    active = query.rings
      .map((r, i) => ({ ...r, index: i }))
      .filter((r) => r.enabled);
  const maxPage = Math.max(0, Math.ceil(players.length / 15) - 1);
  page = Math.min(page, maxPage);
  $("table-head").innerHTML =
    `<tr><th>Player</th>${active.map((r) => `<th>${letters[r.index]} · ${esc(query.measure === "average" ? METRICS[r.metric].short : METRICS[r.metric].label)}</th>`).join("")}<th>Matches</th></tr>`;
  $("table-body").innerHTML =
    players
      .slice(page * 15, page * 15 + 15)
      .map(
        (p) =>
          `<tr><td><button class="player-button" data-player="${p}">${esc(snapshot.players[p][1])} ↗</button></td>${active
            .map((r) => {
              const g = evidenceBest(r.index, p);
              return `<td class="value-cell ${g?.qualifies ? "qualified" : ""}">${g ? fmt(g.value) : "—"}<small>${g ? `${g.games} game${g.games === 1 ? "" : "s"} · ${g.season || "pooled"}` : "No known eligible value"}</small></td>`;
            })
            .join("")}<td>${active
            .filter((r) => result.masks.get(p) & (1 << r.index))
            .map((r) => letters[r.index])
            .join(
              " · ",
            )}${query.scope === "same-season" && !result.commonSeasons.has(p) ? "<small>No shared qualifying season</small>" : ""}</td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="${active.length + 2}">No matching players for this view. Try another region or adjust the conditions.</td></tr>`;
  const unknown = result.rings.reduce((n, r) => n + r.unknownGroups, 0);
  $("table-summary").textContent =
    `${query.scope === "same-season" ? "Matching players show their best value from a season satisfying every condition. " : ""}${fmt(players.length)} player${players.length === 1 ? "" : "s"} · Values shown are the highest eligible season value, or the pooled value. ${unknown ? `${fmt(unknown)} condition-groups have unknown statistics and cannot qualify.` : ""} Display rounded to 2 decimals; qualification uses unrounded totals.`;
  $("page-label").textContent = `${page + 1} / ${maxPage + 1}`;
  $("previous").disabled = page === 0;
  $("next").disabled = page >= maxPage;
  $("table-body")
    .querySelectorAll("[data-player]")
    .forEach((b) =>
      b.addEventListener("click", () => renderPlayer(Number(b.dataset.player))),
    );
  const selected =
    $("region").value === "intersection"
      ? result.maskAll
      : Number($("region").value);
  $("diagram")
    .querySelectorAll("[data-mask]")
    .forEach((g) =>
      g.setAttribute(
        "aria-pressed",
        Number(g.dataset.mask) === selected ? "true" : "false",
      ),
    );
}

function renderPlayer(p) {
  const player = snapshot.players[p];
  $("player-detail").innerHTML =
    `<section class="detail"><h3>${esc(player[1])}</h3><p class="muted">Born ${esc(player[2] || "date unavailable")} · <a href="https://www.nba.com/stats/player/${encodeURIComponent(player[0])}" target="_blank" rel="noopener noreferrer">NBA player profile ↗</a></p><div class="detail-grid">${query.rings
      .map((r, i) => {
        if (!r.enabled) return "";
        const g = evidenceBest(i, p);
        return `<div class="detail-stat">${letters[i]} · ${esc(ringLabel(r, query.measure))}<strong>${g ? fmt(g.value) : "—"}</strong><span>${g ? `${fmt(g.total)} ${esc(METRICS[r.metric].label.toLowerCase())}${query.measure === "average" ? ` ÷ ${g.games} appearances` : ` across ${g.games} appearances`}` : "No known eligible value"}</span><span>${g ? `${g.season || `${Math.min(...g.seasons)}–${Math.max(...g.seasons)}`} · age ${ageLabel(g)}` : ""}</span></div>`;
      })
      .join("")}</div>${query.rings
      .map((r, i) => {
        if (!r.enabled) return "";
        const evidence = evidenceGroups(i, p);
        return `<details><summary>${letters[i]} · All qualifying evidence (${evidence.length} ${query.mode === "season" ? "seasons" : "pooled groups"})</summary>${evidence.length ? `<div class="table-scroll"><table><thead><tr><th>Season(s) ending</th><th>Ages</th><th>Games</th><th>Total</th><th>${query.measure === "average" ? "Per game" : "Value"}</th></tr></thead><tbody>${evidence.map((g) => `<tr><td>${g.season || esc(g.seasons.join(", "))}</td><td>${ageLabel(g)}</td><td>${g.games}</td><td>${fmt(g.total)}</td><td>${fmt(g.value)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">This player does not qualify for this condition.</p>'}</details>`;
      })
      .join("")}</section>`;
}

function evidenceGroups(i, p) {
  const groups = result.rings[i].members.get(p) || [];
  const years = result.commonSeasons.get(p);
  return query.scope === "same-season" && years
    ? groups.filter((g) => years.includes(g.season))
    : groups;
}
function evidenceBest(i, p) {
  const years = result.commonSeasons.get(p);
  return query.scope === "same-season" && years
    ? evidenceGroups(i, p).reduce(
        (best, g) => (!best || g.value > best.value ? g : best),
        null,
      )
    : result.rings[i].best.get(p);
}
function save(id) {
  if (!id) return;
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  try {
    localStorage.setItem("rare-air:saved", JSON.stringify([...saved]));
  } catch {}
  renderDiscoveries();
  $("save-detail").textContent = saved.has(selectedFinding?.id)
    ? "Saved ★"
    : "Save story ☆";
}
function openFinding(f) {
  selectedFinding = f;
  $("manual-controls").hidden = true;
  $("explorer").classList.remove("customizing");
  setQuery(structuredClone(f.query), true);
  $("save-detail").textContent = saved.has(f.id) ? "Saved ★" : "Save story ☆";
}
function filteredFindings() {
  const filter = $("discovery-filter").value,
    metric = $("metric-filter").value,
    search = $("story-search").value.trim().toLowerCase();
  const list = catalogue.findings.filter(
    (f) =>
      (topic === "all" || f.family === topic) &&
      (metric === "all" || f.metrics.includes(metric)) &&
      (filter === "all" ||
        (filter === "unique" && f.count === 1) ||
        (filter === "playoffs" && f.query.type === 1) ||
        (filter === "regular" && f.query.type === 0) ||
        (filter === "saved" && saved.has(f.id))) &&
      (!search ||
        [
          ...f.players.map((p) => snapshot.players[p][1]),
          ...f.labels,
          ...f.metrics.map((m) => METRICS[m].label),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search)),
  );
  if ($("story-sort").value === "newest")
    list.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
  if ($("story-sort").value === "rarest")
    list.sort((a, b) => a.count - b.count || b.reduction - a.reduction);
  return list;
}
function renderDiscoveries() {
  if (!catalogue) return;
  const list = filteredFindings();
  $("discovery-summary").textContent =
    `${fmt(list.length)} stories to browse · ${fmt(catalogue.totalDiscovered)} discoveries in the server archive · ${fmt(catalogue.evaluated)} combinations checked this run`;
  $("discovery-count").textContent = fmt(catalogue.totalDiscovered);
  $("discovery-topics").innerHTML = [
    ["all", "Everything"],
    ...Object.entries(catalogue.familyLabels),
  ]
    .map(
      ([id, label]) =>
        `<button class="topic-chip ${topic === id ? "active" : ""}" data-topic="${id}" aria-pressed="${topic === id}">${esc(label)}</button>`,
    )
    .join("");
  $("discovery-topics")
    .querySelectorAll("[data-topic]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        topic = b.dataset.topic;
        discoveryLimit = 12;
        renderDiscoveries();
      }),
    );
  const overdue =
    Date.now() - Date.parse(catalogue.analysedAt) > 48 * 60 * 60 * 1000;
  $("automation-status").textContent =
    `${overdue ? "Search update overdue · " : "● "}Last search: ${new Date(catalogue.analysedAt).toLocaleString("en-AU")} · Daily at 2:20 pm Brisbane · Next decade: ${catalogue.nextEra.join("–")} · Fixed source through 2025`;
  $("discovery-grid").innerHTML =
    list
      .slice(0, discoveryLimit)
      .map(
        (f, i) => `<article class="discovery">
    <div class="discovery-top"><span>${esc(catalogue.familyLabels[f.family])}</span><button class="bookmark" aria-label="${saved.has(f.id) ? "Unsave" : "Save"} ${esc(snapshot.players[f.players[0]][1])} story" data-save="${f.id}">${saved.has(f.id) ? "★" : "☆"}</button></div>
    <div class="story-rare">${f.count === 1 ? "ONE OF ONE" : f.count + "-PLAYER CLUB"} <span>IN THIS DATASET</span></div>
    <h3>${esc(f.players.map((p) => snapshot.players[p][1]).join(" · "))}</h3>
    <div class="story-conditions">${f.labels.map((label, j) => `<div><span>${letters[j]}</span>${esc(label)}</div>`).join("")}</div>
    <p class="story-scope">${f.query.type ? "Playoffs" : "Regular season"} · ${f.query.first}–${f.query.last}<br>${esc(f.scopeLabel)}</p>
    <small>${f.query.rings.length > 1 ? `${f.parentCounts.join(" / ")} players in the individual sets → ${f.count} together<br>` : ""}Smallest qualifying sample: ${f.smallestSample} game${f.smallestSample === 1 ? "" : "s"}</small>
    <button class="text-button" data-finding="${i}">Read the evidence ↗</button></article>`,
      )
      .join("") ||
    '<div class="empty-stories"><h3>No stories in this view.</h3><p>Try another theme, statistic or player. Save stories with the star on each card.</p></div>';
  $("discovery-grid")
    .querySelectorAll("[data-finding]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        openFinding(list[Number(b.dataset.finding)]),
      ),
    );
  $("discovery-grid")
    .querySelectorAll("[data-save]")
    .forEach((b) => b.addEventListener("click", () => save(b.dataset.save)));
  $("more-discoveries").hidden = discoveryLimit >= list.length;
}

function renderMethod() {
  $("coverage-summary").textContent =
    `SEASONS ENDING ${snapshot.firstSeason}–${snapshot.lastSeason} · ${fmt(snapshot.players.length)} PLAYERS`;
  $("source-line").innerHTML =
    `Source: <a href="${esc(snapshot.source.url)}" target="_blank" rel="noopener noreferrer">${esc(snapshot.source.name)}</a>. Derived from NBA.com records through a community-maintained archive.`;
  $("snapshot-date").textContent =
    `Snapshot built ${new Date(snapshot.generatedAt).toLocaleDateString("en-AU", { dateStyle: "long" })} · latest included game ${snapshot.lastGameDate}. Coverage is limited to the included archive.`;
  $("limitations").innerHTML =
    `<p>${esc(snapshot.scope)}</p><ul>${snapshot.limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p>“Games” below means games with player records / games listed in this archive. Both can be incomplete. “Score agreement” counts games where player points equal the two team scores.</p>`;
  $("audit").textContent =
    `${fmt(snapshot.audit.appearances)} recorded appearances · ${fmt(snapshot.audit.appearancesMissingAge)} with unknown age (excluded from age filters) · ${fmt(snapshot.audit.nonAppearancesOrAmbiguousZeroMinutes)} DNP or ambiguous zero-minute entries excluded · ${fmt(snapshot.audit.duplicateRowsSkipped)} duplicate rows skipped.`;
  $("coverage-table").innerHTML = Array.from(
    { length: snapshot.lastSeason - snapshot.firstSeason + 1 },
    (_, i) => snapshot.lastSeason - i,
  )
    .map((year) => {
      const r = snapshot.coverage.find(
          (c) => c.season === year && c.type === 0,
        ),
        p = snapshot.coverage.find((c) => c.season === year && c.type === 1);
      return `<tr><td>${year}</td><td>${p.games} / ${p.listedGames}</td><td>${p.scoreMatchedGames} / ${p.listedGames}</td><td>${r.games} / ${r.listedGames}</td><td>${r.scoreMatchedGames} / ${r.listedGames}</td></tr>`;
    })
    .join("");
  $("discovery-method").textContent = catalogue.note;
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const rows = [
    [
      "Player",
      "NBA ID",
      "Condition",
      "Statistic",
      "Threshold",
      "Age from",
      "Age through",
      "Mode",
      "Relationship scope",
      "Matches all conditions",
      "Shared qualifying seasons",
      "Measure",
      "Competition",
      "Season from",
      "Season through",
      "Evidence seasons",
      "Games",
      "Stat total",
      "Value",
      "Qualifies",
      "Snapshot date",
      "Source SHA256",
    ],
  ];
  for (const p of visiblePlayers())
    query.rings.forEach((r, i) => {
      if (!r.enabled) return;
      const groups = evidenceGroups(i, p).length
        ? evidenceGroups(i, p)
        : [evidenceBest(i, p)].filter(Boolean);
      for (const g of groups)
        rows.push([
          snapshot.players[p][1],
          snapshot.players[p][0],
          letters[i],
          r.metric,
          r.threshold,
          r.minAge,
          r.maxAge,
          query.mode,
          query.scope || "career",
          result.intersection.includes(p),
          (result.commonSeasons.get(p) || []).join(";"),
          query.measure,
          query.type ? "Playoffs" : "Regular season",
          query.first,
          query.last,
          g.seasons.join(";"),
          g.games,
          g.total,
          g.value,
          g.qualifies,
          snapshot.generatedAt,
          snapshot.source.sha256,
        ]);
    });
  const csv = rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(v)
              .replace(/^[=+@-]/, "'$&")
              .replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
  download("rare-air-evidence.csv", csv, "text/csv;charset=utf-8");
}

$("query-form").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    selectedFinding = null;
    setQuery(readForm(), true);
  } catch (error) {
    $("form-error").textContent = error.message;
  }
});
$("conditions").addEventListener("change", (e) => {
  if (e.target.type === "checkbox")
    e.target
      .closest(".condition")
      .classList.toggle("inactive", !e.target.checked);
});
$("mode").addEventListener("change", updateModeNote);
$("measure").addEventListener("change", updateModeNote);
$("reset").addEventListener("click", () => {
  if (snapshot) {
    selectedFinding = null;
    setQuery(defaults());
  }
});
$("region").addEventListener("change", () => {
  page = 0;
  renderTable();
});
$("player-filter").addEventListener("input", () => {
  page = 0;
  renderTable();
});
$("previous").addEventListener("click", () => {
  page--;
  renderTable();
});
$("next").addEventListener("click", () => {
  page++;
  renderTable();
});
$("discovery-filter").addEventListener("change", () => {
  discoveryLimit = 12;
  renderDiscoveries();
});
$("more-discoveries").addEventListener("click", () => {
  discoveryLimit += 12;
  renderDiscoveries();
});
$("export-csv").addEventListener("click", () => {
  if (result) exportCsv();
});
$("copy-link").addEventListener("click", async () => {
  try {
    const share = new URL(location.href);
    share.hash = "q=" + encodeURIComponent(JSON.stringify(query));
    await navigator.clipboard.writeText(share.href);
    $("copy-link").textContent = "Link copied ✓";
    setTimeout(() => ($("copy-link").textContent = "Copy this view ↗"), 2000);
  } catch {
    $("status").textContent =
      "Copy the URL from your address bar to save this view.";
  }
});

async function getJson(file) {
  const response = await fetch("/backend/nba/" + file);
  if (response.status === 401) {
    location.assign("/login.html?next=" + encodeURIComponent("/backend/nba/"));
    throw new Error("Please sign in to Cartdotcom.");
  }
  if (!response.ok)
    throw new Error(
      `Snapshot unavailable (${response.status}). Please reload to retry.`,
    );
  return response.json();
}

try {
  const bundle = await getJson("bundle.json");
  snapshot = bundle.snapshot;
  catalogue = bundle.catalogue;
  registerMetrics(snapshot);
  $("metric-filter").innerHTML =
    '<option value="all">All statistics</option>' +
    Object.entries(METRICS)
      .map(([id, m]) => `<option value="${id}">${esc(m.label)}</option>`)
      .join("");
  if (
    snapshot.version !== 1 ||
    catalogue.version !== 2 ||
    catalogue.snapshotSha256 !== snapshot.source.sha256 ||
    catalogue.generatedAt !== snapshot.generatedAt
  )
    throw new Error("Snapshot versions do not match. Please reload.");
  if (location.hash.startsWith("#q=")) {
    try {
      query = validateQuery(
        JSON.parse(decodeURIComponent(location.hash.slice(3))),
        snapshot,
      );
    } catch {
      query = defaults();
      $("form-error").textContent =
        "Saved filters were invalid; showing the default view.";
    }
  }
  const hasQuery = location.hash.startsWith("#q=");
  setQuery(query, hasQuery);
  if (!hasQuery) history.replaceState(null, "", location.pathname);
  renderDiscoveries();
  renderMethod();
  $("query-form").removeAttribute("inert");
  $("status").textContent =
    `SNAPSHOT READY · ${fmt(snapshot.audit.appearances)} appearances · ${fmt(snapshot.players.length)} players · Historical coverage varies: “unique” means unique in this dataset.`;
} catch (error) {
  $("status").textContent = error.message;
  $("status").classList.add("error");
}

$("story-search").addEventListener("input", () => {
  discoveryLimit = 12;
  renderDiscoveries();
});
for (const id of ["metric-filter", "story-sort"])
  $(id).addEventListener("change", () => {
    discoveryLimit = 12;
    renderDiscoveries();
  });
$("saved-nav").addEventListener("click", () => {
  $("discovery-filter").value = "saved";
  $("metric-filter").value = "all";
  $("story-search").value = "";
  discoveryLimit = 12;
  topic = "all";
  renderDiscoveries();
});
$("surprise").addEventListener("click", () => {
  const list = filteredFindings();
  if (list.length) openFinding(list[Math.floor(Math.random() * list.length)]);
});
$("close-detail").addEventListener("click", () => {
  $("explorer").hidden = true;
  $("detail-bar").hidden = true;
  history.replaceState(null, "", "#discoveries");
  $("discoveries").scrollIntoView({ behavior: "smooth" });
});
$("customize").addEventListener("click", () => {
  $("manual-controls").hidden = !$("manual-controls").hidden;
  $("explorer").classList.toggle("customizing", !$("manual-controls").hidden);
});
$("save-detail").addEventListener("click", () => save(selectedFinding?.id));
$("relationship-scope").addEventListener("change", () => {
  if ($("relationship-scope").value === "same-season")
    $("mode").value = "season";
  updateModeNote();
});
