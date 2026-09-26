import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './project-case-studies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const titles = (html) => projects.reduce((text, p) => text.replaceAll(`>${p.old}<`, `>${p.title}<`).replace(`<title>${p.old} |`, `<title>${p.title} |`), html);
const section = ([title, paragraphs], index) => `        <section class="project-section" id="section-${index}"><h2>${escape(title)}</h2><div>${paragraphs.map(p => `<p>${escape(p)}</p>`).join('\n')}</div></section>`;
const capture = ([id, title, kind, caption]) => `        <figure class="project-figure capture-figure" id="capture-${id}"><div class="capture-placeholder" role="img" aria-label="${escape(title)}: media pending"><span>${escape(kind)}</span><strong>${escape(title)}</strong></div><figcaption>${escape(caption)}</figcaption></figure>`;
for (const p of projects) {
  const file = `${root}project-${p.slug}.html`;
  let html = titles(readFileSync(file, 'utf8'));
  const content = `    <main id="project-content" class="project-content">
        <header class="project-heading">
            <p class="project-category">${escape(p.category)}</p>
            <h1>${escape(p.title)}</h1>
            <p class="project-lead">${escape(p.lead)}</p>
            <p class="project-stack">${escape(p.stack)}</p>
            ${p.captures ? '<p class="draft-note">Draft case study / Screenshots and recordings pending.</p>' : ''}
        </header>
        ${p.publicView ? `<section class="public-entry"><h2>Live Production View</h2><p>${escape(p.features)}</p><a href="public-${p.publicView}.html" target="_blank" rel="noopener noreferrer">${escape(p.publicLabel)} <span aria-hidden="true">&#8599;</span></a></section>` : capture(p.captures[0])}
        <ol class="project-flow" aria-label="Processing sequence">${p.flow.map(step => `<li>${escape(step)}</li>`).join('')}</ol>
        <nav class="article-contents" aria-label="On this page">${p.sections.map(([name], i) => `<a href="#section-${i}">${escape(name)}</a>`).join('')}</nav>
${p.sections.map((s, i) => section(s, i) + (p.captures && i === 2 ? '\n' + capture(p.captures[1]) : '') + (p.captures && i === 4 ? '\n' + capture(p.captures[2]) : '')).join('\n')}
    </main>`;
  html = html.replace(/    <main id="project-content"[\s\S]*?<\/main>/, content.replace(/[ \t]+$/gm, ''));
  html = html.replace(/(<meta name="description" content=")[^"]*/, `$1${escape(p.lead)}`);
  html = html.replace(/project-pages.css\?v=[^"]+/, 'project-pages.css?v=case-studies-20260926');
  writeFileSync(file, html);
}
const home = `${root}home.html`;
let html = titles(readFileSync(home, 'utf8'));
html = html.replace('A local image-library toolkit that grew from organising chapter downloads into a responsive, right-to-left desktop reader.', 'A responsive local library reader with right-to-left spreads, black-and-white/colour edition switching and carefully scheduled image loading.');
writeFileSync(home, html);

for (const p of projects.filter(p => p.publicView)) {
  let page = readFileSync(`${root}project-${p.slug}.html`, 'utf8');
  page = page.replace(`<title>${p.title} |`, `<title>Public View: ${p.title} |`);
  page = page.replace('</head>', '    <link rel="stylesheet" href="public-projects.css?v=20260926">\n    <script src="public-projects.js?v=20260926" defer></script>\n</head>');
  page = page.replace('<body class="project-page">', `<body class="project-page public-page" data-dataset="${p.publicView}">`);
  page = page.replace(/    <main id="project-content"[\s\S]*?<\/main>/, `    <main id="project-content" class="project-content">
        <header class="project-heading">
            <p class="project-category">Live production / Read only${p.publicView === 'investment' ? ' / Paper trading' : ''}</p>
            <h1>${escape(p.title)}</h1>
            <a class="case-study-link" href="project-${p.slug}.html" target="_blank" rel="noopener noreferrer">Project breakdown &#8599;</a>
        </header>
        <div class="snapshot-line"><p id="snapshot-status" role="status">Loading production records...</p><button id="refresh" class="refresh-button" type="button" aria-label="Refresh data" title="Refresh data"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5"/></svg></button></div>
        <div id="view-tabs" class="view-tabs" role="tablist" aria-label="Records"></div>
        <div class="data-filters">
            <label>Search<input id="record-search" type="search" autocomplete="off" placeholder="Search records"></label>
            <label id="kind-filter-label">Filter<select id="kind-filter"><option value="">All</option></select></label>
            <label id="horizon-label" hidden>Horizon<select id="horizon"><option>24h</option><option>1h</option><option>6h</option><option>12h</option><option>1d</option><option>48h</option><option>1w</option><option>2w</option><option>1m</option><option>3m</option><option>6m</option><option>1y</option><option>2y</option><option>3y</option><option>4y</option></select></label>
            <label>Sort<select id="record-sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="alphabetical">A to Z</option></select></label>
        </div>
        <p id="record-count" class="record-count" aria-live="polite"></p>
        <section id="records" role="tabpanel" tabindex="0" aria-label="Production records" aria-busy="true"></section>
        <noscript><p>JavaScript is required to load current production records.</p></noscript>
        <p class="data-footnote">${p.publicView === 'investment' ? 'Paper-account records, not live-money trading. Target allocations are research outputs, not confirmed holdings. Account identifiers, balances and trading controls are excluded.' : p.publicView === 'market' ? 'Observed price changes do not establish that an article caused a move. An unavailable horizon is not a zero return. Article text remains with the linked publisher.' : 'Derived research summaries with source references. Private messages, sender identities, personal instructions and processing controls are excluded.'}</p>
    </main>`);
  writeFileSync(`${root}public-${p.publicView}.html`, page);
}
