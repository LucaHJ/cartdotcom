(() => {
    const dataset = document.body.dataset.dataset;
    const configurations = {
        investment: [['runs', 'Research runs'], ['decisions', 'Decisions'], ['executions', 'Executions']],
        market: [['articles', 'Articles'], ['observations', 'Price observations']],
        research: [['resources', 'Resources']]
    };
    if (!configurations[dataset]) return;
    const $ = (id) => document.getElementById(id);
    const state = { data: null, view: configurations[dataset][0][0], loading: false, failed: false };
    const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
    const numeric = (value, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}` : 'Not available';
    const timestamp = (r) => r.created_at || r.executed_at || r.scheduled_for || r.discovered_at || r.updated_at;
    const label = (r) => r.name || r.symbol || r.title || r.status || '';
    const category = (r) => r.kind || r.source || r.action || r.status || r.side || 'Uncategorised';
    const node = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    };
    function link(text, value) {
        try {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
            const a = node('a', text);
            a.href = url.href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            return a;
        } catch { return node('span', text); }
    }
    function status() {
        if (!state.data) {
            $('snapshot-status').textContent = state.failed ? 'Production data is unavailable. Try refreshing shortly.' : 'Loading production records...';
            return;
        }
        const stale = Date.now() - Date.parse(state.data.generated_at) > 300_000;
        $('snapshot-status').textContent = `${state.failed ? 'Refresh failed. Last available snapshot: ' : stale ? 'Delayed snapshot: ' : 'Updated: '}${date(state.data.generated_at)}${stale ? ' / More than five minutes old.' : ''}`;
    }
    function table(columns, rows) {
        const wrap = node('div', undefined, 'data-table-wrap');
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'Record table');
        const table = node('table', undefined, 'data-table');
        const head = node('thead');
        const tr = node('tr');
        columns.forEach(([title]) => { const th = node('th', title); th.scope = 'col'; tr.append(th); });
        head.append(tr);
        const body = node('tbody');
        rows.forEach(r => {
            const row = node('tr');
            columns.forEach(([, value]) => { const td = node('td'); const cell = value(r); td.append(cell instanceof Node ? cell : document.createTextNode(cell)); row.append(td); });
            body.append(row);
        });
        table.append(head, body); wrap.append(table);
        return wrap;
    }
    function render() {
        const expanded = new Set([...$('records').querySelectorAll('details[open]')].map(el => el.dataset.key));
        const all = state.data?.[state.view] || [];
        const search = $('record-search').value.toLowerCase().trim();
        const filter = $('kind-filter').value;
        const sort = $('record-sort').value;
        const rows = all.filter(r => (!search || [r.name, r.symbol, r.title, r.source, r.summary, r.why_useful, r.status, r.action].some(v => String(v || '').toLowerCase().includes(search))) && (!filter || category(r) === filter));
        rows.sort((a, b) => sort === 'alphabetical' ? label(a).localeCompare(label(b)) : ((Date.parse(timestamp(a)) || 0) - (Date.parse(timestamp(b)) || 0)) * (sort === 'oldest' ? 1 : -1));
        $('record-count').textContent = state.data ? `${rows.length} of ${all.length} records in this recent production window` : '';
        $('records').replaceChildren();
        if (!rows.length) {
            $('records').append(node('p', state.data ? (all.length ? 'No records match these filters.' : 'No records in this production window.') : state.failed ? 'No snapshot loaded.' : 'Loading...'));
            return;
        }
        if (state.view === 'resources') {
            rows.forEach(r => {
                const details = node('details', undefined, 'resource-record');
                details.dataset.key = `${r.name}|${r.created_at}`;
                details.open = expanded.has(details.dataset.key);
                details.append(node('summary', r.name), node('p', `${r.kind || 'Resource'} / ${date(r.created_at)}`, 'resource-meta'), node('p', r.summary || 'No summary recorded.'));
                if (r.why_useful) details.append(node('p', r.why_useful));
                const links = node('div', undefined, 'resource-links');
                if (r.url) links.append(link('Resource source', r.url));
                if (r.source_url) links.append(link('Original post', r.source_url));
                details.append(links); $('records').append(details);
            });
            return;
        }
        const schemas = {
            runs: [['Scheduled', r => date(r.scheduled_for)], ['State', r => r.status], ['Finished', r => date(r.finished_at)]],
            decisions: [['Recorded', r => date(r.created_at)], ['Symbol', r => r.symbol], ['Action', r => r.action], ['Target weight', r => numeric(r.target_weight_pct, '%')], ['Validation', r => r.validation_status]],
            executions: [['Executed', r => date(r.executed_at)], ['Symbol', r => r.symbol], ['Side', r => r.side], ['Fill price', r => numeric(r.price)]],
            articles: [['Article', r => link(r.title, r.url)], ['Source', r => r.source], ['Published', r => date(r.published_at)], ['Collected', r => date(r.discovered_at)]],
            observations: [['Article', r => link(r.title, r.url)], ['Ticker', r => r.symbol], ['Baseline', r => numeric(r.baseline_price)], ['Baseline at', r => date(r.baseline_at)], [`Change (${$('horizon').value})`, r => numeric(r.intervals?.[$('horizon').value]?.change_pct, '%')], ['Observed at', r => typeof r.intervals?.[$('horizon').value]?.change_pct === 'number' ? date(r.intervals[$('horizon').value].at) : 'Not available']]
        };
        $('records').append(table(schemas[state.view], rows));
    }
    function syncFilters() {
        const previous = $('kind-filter').value;
        $('kind-filter').replaceChildren(new Option('All', ''));
        [...new Set((state.data?.[state.view] || []).map(category))].sort().forEach(value => $('kind-filter').add(new Option(value, value)));
        if ([...$('kind-filter').options].some(o => o.value === previous)) $('kind-filter').value = previous;
        $('horizon-label').hidden = state.view !== 'observations';
    }
    configurations[dataset].forEach(([id, title], index) => {
        const button = node('button', title);
        button.type = 'button'; button.id = `tab-${id}`;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'records');
        function select() {
            state.view = id;
            $('view-tabs').querySelectorAll('button').forEach(b => { const active = b === button; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
            $('records').setAttribute('aria-labelledby', button.id);
            $('kind-filter').value = ''; syncFilters(); render();
        }
        button.addEventListener('click', select);
        button.addEventListener('keydown', event => {
            const tabs = [...$('view-tabs').children];
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
        });
        $('view-tabs').append(button);
        if (index === 0) select();
    });
    async function refresh() {
        if (state.loading) return;
        state.loading = true; $('refresh').disabled = true; $('records').setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(`https://cartdotcom-portfolio-public.lucajeannin.workers.dev/${dataset}.json`, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error('Unavailable');
            const data = await response.json();
            if (data.schema_version !== 1 || data.dataset !== dataset || !Number.isFinite(Date.parse(data.generated_at)) || configurations[dataset].some(([key]) => !Array.isArray(data[key]))) throw new Error('Invalid snapshot');
            state.data = data; state.failed = false; syncFilters(); render();
        } catch { state.failed = true; if (!state.data) render(); }
        finally { state.loading = false; $('refresh').disabled = false; $('records').setAttribute('aria-busy', 'false'); status(); }
    }
    ['record-search', 'kind-filter', 'horizon', 'record-sort'].forEach(id => $(id).addEventListener(id === 'record-search' ? 'input' : 'change', render));
    $('refresh').addEventListener('click', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { status(); if (!document.hidden) refresh(); }, 60000);
    refresh();
})();
