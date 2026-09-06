import {
  defaults,
  analyse,
  METRICS,
  ringLabel,
  validateQuery,
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
let snapshot,
  catalogue,
  query = defaults(),
  result,
  page = 0,
  discoveryLimit = 9;

function renderForm() {
  $("competition").value = query.type;
  $("mode").value = query.mode;
  $("measure").value = query.measure;
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
  $("mode-note").textContent = pooled
    ? total
      ? "Add the statistic across every selected game in the age bracket."
      : "Total statistics ÷ total appearances across all selected games in the age bracket."
    : "Qualify in at least one season, using only the games played inside the age bracket. Conditions may be met in different seasons.";
}

function readForm() {
  return {
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
  history.replaceState(
    null,
    "",
    "#q=" + encodeURIComponent(JSON.stringify(query)),
  );
  if (scroll) $("explorer").scrollIntoView({ behavior: "smooth" });
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
    `${count === 1 ? "The only player matching" : count ? "These players match" : "No recorded player matches"} ${active.length === 1 ? "this condition" : `all ${active.length} conditions`} in the selected ${query.type === 1 ? "playoff" : "regular-season"} data. ${query.mode === "season" ? "At least one qualifying season per condition." : "All selected games pooled within each age bracket."}`;
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
              const g = result.rings[r.index].best.get(p);
              return `<td class="value-cell ${g?.qualifies ? "qualified" : ""}">${g ? fmt(g.value) : "—"}<small>${g ? `${g.games} game${g.games === 1 ? "" : "s"} · ${g.season || "pooled"}` : "No known eligible value"}</small></td>`;
            })
            .join("")}<td>${active
            .filter((r) => result.masks.get(p) & (1 << r.index))
            .map((r) => letters[r.index])
            .join(" · ")}</td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="${active.length + 2}">No matching players for this view. Try another region or adjust the conditions.</td></tr>`;
  const unknown = result.rings.reduce((n, r) => n + r.unknownGroups, 0);
  $("table-summary").textContent =
    `${fmt(players.length)} player${players.length === 1 ? "" : "s"} · Values shown are the highest eligible season value, or the pooled value. ${unknown ? `${fmt(unknown)} condition-groups have unknown statistics and cannot qualify.` : ""} Display rounded to 2 decimals; qualification uses unrounded totals.`;
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
        const g = result.rings[i].best.get(p);
        return `<div class="detail-stat">${letters[i]} · ${esc(ringLabel(r, query.measure))}<strong>${g ? fmt(g.value) : "—"}</strong><span>${g ? `${fmt(g.total)} ${esc(METRICS[r.metric].label.toLowerCase())}${query.measure === "average" ? ` ÷ ${g.games} appearances` : ` across ${g.games} appearances`}` : "No known eligible value"}</span><span>${g ? `${g.season || `${Math.min(...g.seasons)}–${Math.max(...g.seasons)}`} · age ${g.minAge}${g.minAge !== g.maxAge ? `–${g.maxAge}` : ""}` : ""}</span></div>`;
      })
      .join("")}</div>${query.rings
      .map((r, i) => {
        if (!r.enabled) return "";
        const evidence = result.rings[i].members.get(p) || [];
        return `<details><summary>${letters[i]} · All qualifying evidence (${evidence.length} ${query.mode === "season" ? "seasons" : "pooled groups"})</summary>${evidence.length ? `<div class="table-scroll"><table><thead><tr><th>Season(s) ending</th><th>Ages</th><th>Games</th><th>Total</th><th>${query.measure === "average" ? "Per game" : "Value"}</th></tr></thead><tbody>${evidence.map((g) => `<tr><td>${g.season || esc(g.seasons.join(", "))}</td><td>${g.minAge}–${g.maxAge}</td><td>${g.games}</td><td>${fmt(g.total)}</td><td>${fmt(g.value)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">This player does not qualify for this condition.</p>'}</details>`;
      })
      .join("")}</section>`;
}

function renderDiscoveries() {
  const filter = $("discovery-filter").value;
  const list = catalogue.findings.filter(
    (f) =>
      filter === "all" ||
      (filter === "unique" && f.count === 1) ||
      (filter === "playoffs" && f.query.type === 1) ||
      (filter === "regular" && f.query.type === 0) ||
      (filter === "pooled" && f.query.mode === "pooled"),
  );
  $("discovery-summary").textContent =
    `${fmt(catalogue.evaluated)} combinations checked offline · ${fmt(catalogue.findings.length)} distinct findings · ${fmt(list.length)} in this view`;
  $("discovery-grid").innerHTML =
    list
      .slice(0, discoveryLimit)
      .map(
        (f, i) =>
          `<article class="discovery"><div class="discovery-top"><span>${f.query.type ? "PLAYOFFS" : "REGULAR SEASON"}</span><strong>${f.count === 1 ? "ONE OF ONE" : `${f.count}-PLAYER CLUB`}</strong></div><h3>${esc(f.players.map((p) => snapshot.players[p][1]).join(" · "))}</h3><p>${f.labels.map(esc).join("<br>")}</p><small>${f.query.mode === "season" ? "At least one season per condition" : "All bracket games pooled"}<br>Smallest qualifying sample: ${f.smallestSample} game${f.smallestSample === 1 ? "" : "s"}</small><button class="text-button" data-finding="${i}">Inspect this overlap ↗</button></article>`,
      )
      .join("") || '<p class="muted">No discoveries in this category.</p>';
  $("discovery-grid")
    .querySelectorAll("[data-finding]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        setQuery(structuredClone(list[Number(b.dataset.finding)].query), true),
      ),
    );
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
      const groups =
        result.rings[i].members.get(p) ||
        [result.rings[i].best.get(p)].filter(Boolean);
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
    setQuery(readForm());
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
  if (snapshot) setQuery(defaults());
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
  discoveryLimit = 9;
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
  [snapshot, catalogue] = await Promise.all([
    getJson("snapshot.json"),
    getJson("discoveries.json"),
  ]);
  if (
    snapshot.version !== 1 ||
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
  setQuery(query);
  renderDiscoveries();
  renderMethod();
  $("query-form").removeAttribute("inert");
  $("status").textContent =
    `SNAPSHOT READY · ${fmt(snapshot.audit.appearances)} appearances · ${fmt(snapshot.players.length)} players · Historical coverage varies: “unique” means unique in this dataset.`;
} catch (error) {
  $("status").textContent = error.message;
  $("status").classList.add("error");
}
