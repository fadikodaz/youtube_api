// Renders every page once at startup from lib/content.js and the templates in
// views/. Text is always HTML-escaped; the only markup allowed inside content
// is [text](/internal-path) links.
const fs = require('fs');
const path = require('path');
const { TOOLS, DOCS, GROUPS, BRANDS, FEATURES } = require('./content');

const VIEWS = path.join(__dirname, '..', 'views');

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// Escape, then turn [text](/path) into internal links.
const inline = (s) => esc(s).replace(/\[([^\]]+)\]\((\/[a-z0-9\-/]*)\)/g, '<a href="$2">$1</a>');

const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="/icons.svg#${id}"/></svg>`;

const brandOf = (tool) => tool.brand || GROUPS.find((g) => g.id === tool.group)?.brand || 'youtube';

function sticker(brand, format = '', small = false) {
  const b = BRANDS[brand];
  // Brand colour via a class (brand-*), not a style attribute: the strict
  // CSP blocks inline styles.
  return `<span class="sticker brand-${brand}${small ? ' sm' : ''}" title="${esc(b.name)}">${icon(`b-${brand}`)}${
    format ? `<span class="fmt">${esc(format)}</span>` : ''
  }</span>`;
}

// ----------------------------------------------------------------- header --

function menuItem(tool, current) {
  const cur = tool.path === current ? ' aria-current="page"' : '';
  return `<li><a href="${tool.path}"${cur}>${sticker(brandOf(tool), '', true)}<span><b>${esc(tool.nav)}</b><small>${esc(
    tool.note
  )}</small></span></a></li>`;
}

function header(current) {
  const groups = GROUPS.map((g) => {
    const tools = TOOLS.filter((t) => t.group === g.id);
    const active = tools.some((t) => t.path === current) ? ' active' : '';
    return `<details class="dd${active}">
          <summary>${esc(g.label)}${icon('i-caret-down', 'ic caret')}</summary>
          <div class="dd-panel"><ul>${tools.map((t) => menuItem(t, current)).join('')}</ul></div>
        </details>`;
  }).join('\n        ');

  const drawerGroups = GROUPS.map((g) => {
    const tools = TOOLS.filter((t) => t.group === g.id);
    return `<p class="drawer-label">${esc(g.label === 'More' ? 'More sites' : g.label)}</p><ul>${tools
      .map((t) => menuItem(t, current))
      .join('')}</ul>`;
  }).join('');

  return `<header class="topbar">
      <a class="brand" href="/">
        <span class="logo">${icon('i-download-simple')}</span>
        YTPocket
      </a>
      <nav class="menu" aria-label="Downloaders">
        ${groups}
      </nav>
      <div class="topbar-end">
        <p class="status" id="health" role="status" hidden></p>
        <button class="icon-btn" id="themeBtn" type="button" aria-label="Switch to dark mode" aria-pressed="false">
          <svg class="ic" aria-hidden="true"><use id="themeIcon" href="/icons.svg#i-moon"/></svg>
        </button>
        <button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="drawer">
          ${icon('i-list')}
        </button>
      </div>
    </header>
    <div class="drawer" id="drawer" hidden>
      <div class="drawer-backdrop" data-close></div>
      <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div class="drawer-head">
          <a class="brand" href="/"><span class="logo">${icon('i-download-simple')}</span>YTPocket</a>
          <button class="icon-btn" type="button" data-close aria-label="Close menu">${icon('i-x')}</button>
        </div>
        <nav aria-label="All downloaders">${drawerGroups}</nav>
      </div>
    </div>`;
}

// ------------------------------------------------------------ breadcrumbs --
// Home > [platform page] > this page. Returns { html, items } (items feed
// the BreadcrumbList structured data).

// The YouTube downloader is the home page, so YouTube pages are Home > page;
// TikTok MP3 is Home > TikTok downloader > TikTok to MP3.
function crumbTrail(page) {
  const items = [{ name: 'Home', path: '/' }];
  if (page.group && page.group !== 'more') {
    const main = TOOLS.find((t) => t.group === page.group);
    if (main.path !== '/' && main.path !== page.path) items.push({ name: main.crumb, path: main.path });
  }
  if (page.path !== '/') items.push({ name: page.crumb || page.h1, path: page.path });
  return items;
}

function crumbs(page) {
  const items = crumbTrail(page);
  if (items.length < 2) return { html: '', items };
  const html = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
    .map((i, n) =>
      n === items.length - 1
        ? `<li><span aria-current="page">${esc(i.name)}</span></li>`
        : `<li><a href="${i.path}">${esc(i.name)}</a>${icon('i-caret-right', 'ic sep')}</li>`
    )
    .join('')}</ol></nav>`;
  return { html, items };
}

// ------------------------------------------------------------ sister tabs --

function sisterTabs(page) {
  if (page.group === 'more') return '';
  const tools = TOOLS.filter((t) => t.group === page.group);
  if (tools.length < 2) return '';
  return `<nav class="sisters" aria-label="${esc(GROUPS.find((g) => g.id === page.group).label)} tools"><ul>${tools
    .map((t) => `<li><a href="${t.path}"${t.path === page.path ? ' aria-current="page"' : ''}>${esc(t.short)}</a></li>`)
    .join('')}</ul></nav>`;
}

// ------------------------------------------------------- step "pictures" --
// Small copies of the real interface (decorative: aria-hidden; the step text
// says the same thing).

function stagePhone(brand) {
  return `<div class="stage" aria-hidden="true">
            <div class="m-phone">
              <div class="m-video brand-${brand}">${icon(`b-${brand}`)}</div>
              <div class="m-share">
                <div class="hit"><i>${icon('i-link-simple')}</i>Copy link${icon('i-hand-pointing', 'ic hand')}</div>
                <div><i>${icon('i-share-network')}</i>Share</div>
                <div><i>${icon('i-dots-three')}</i>More</div>
              </div>
            </div>
          </div>`;
}

function stagePaste(link, cta) {
  return `<div class="stage" aria-hidden="true">
            <span class="m-pasted">${icon('i-clipboard-text')}Pasted</span>
            <div class="m-intake"><div class="m-field">${icon('i-link-simple')}<span>${esc(link)}</span></div><div class="m-cta">${esc(
              cta
            )}</div></div>
            ${icon('i-hand-pointing', 'ic hand hand-cta')}
          </div>`;
}

function stageFinal(kind, brand) {
  if (kind === 'thumbnail') {
    return `<div class="stage" aria-hidden="true">
            <div class="m-thumb">
              <div class="m-thumb-img brand-${brand}">${icon(`b-${brand}`)}<span>1280×720</span></div>
              <span class="m-pill">${icon('i-image')}Save thumbnail</span>
            </div>
            ${icon('i-hand-pointing', 'ic hand hand-pill')}
          </div>`;
  }
  const audio = kind === 'audio';
  const rows = audio
    ? `<div class="m-row busy"><div class="t">MP3 192 kbps<small>Preparing, 64%</small></div><div class="c">64%</div></div>
               <div class="m-row"><div class="t">MP3 128 kbps<small>About 9.7 MB</small></div><div class="c">${icon(
                 'i-download-simple'
               )}</div></div>`
    : `<div class="m-row"><div class="t">1080p HD<small>Saved</small></div><div class="c done">${icon('i-check')}</div></div>
               <div class="m-row"><div class="t">720p HD<small>About 42 MB</small></div><div class="c">${icon(
                 'i-download-simple'
               )}</div></div>`;
  return `<div class="stage" aria-hidden="true">
            <div class="m-sheet">
              <div class="m-tabs"><span${audio ? '' : ' class="on"'}>Video MP4</span><span${audio ? ' class="on"' : ''}>Audio MP3</span></div>
              ${rows}
            </div>
          </div>`;
}

function steps(page) {
  const s = page.steps;
  const titles = ['Copy the link', 'Paste it here', s.final === 'thumbnail' ? 'Save it' : 'Pick a quality'];
  const stages = [stagePhone(s.brand), stagePaste(s.link, page.cta), stageFinal(s.final, s.brand)];
  return `<section class="box sec" aria-labelledby="stepsTitle">
        <h2 id="stepsTitle">${esc(page.stepsTitle)}</h2>
        <ol class="steps">${stages
          .map(
            (stage, i) => `<li class="step">
          ${stage}
          <div class="step-text"><h3><span class="num">${i + 1}</span>${esc(titles[i])}</h3><p>${esc(s.texts[i])}</p></div>
        </li>`
          )
          .join('')}</ol>
      </section>`;
}

// -------------------------------------------------------------- sections --

function intro(page) {
  return `<section class="box sec prose" aria-labelledby="introTitle">
        <h2 id="introTitle">${esc(page.introTitle)}</h2>
        ${page.intro.map((p) => `<p>${inline(p)}</p>`).join('\n        ')}
      </section>`;
}

function features(page) {
  return `<section class="box sec" aria-labelledby="featTitle">
        <h2 id="featTitle">What you get</h2>
        <ul class="feats">${FEATURES[page.features]
          .map(
            ([ic, tone, t, d]) =>
              `<li class="feat"><span class="tile tone-${tone}">${icon(`d-${ic}`)}</span><span class="feat-text"><b>${esc(
                t
              )}</b><span class="feat-desc">${esc(d)}</span></span></li>`
          )
          .join('')}</ul>
      </section>`;
}

function faq(page) {
  return `<section class="box sec faq" aria-labelledby="faqTitle">
        <h2 id="faqTitle">Questions and answers</h2>
        ${page.faq
          .map(
            (f) => `<details>
          <summary><span>${esc(f.q)}</span><span class="faq-icon">${icon('i-plus', 'ic plus')}${icon('i-minus', 'ic minus')}</span></summary>
          <p>${inline(f.a)}</p>
        </details>`
          )
          .join('\n        ')}
      </section>`;
}

function related(current) {
  return `<section class="related" aria-labelledby="moreTitle">
        <h2 id="moreTitle">More tools</h2>
        <ul class="tools">${TOOLS.filter((t) => t.path !== current)
          .map(
            (t) =>
              `<li><a class="tool" href="${t.path}">${sticker(brandOf(t), t.card.format)}<span class="tool-text"><b>${esc(
                t.card.label
              )}</b><span>${esc(t.card.note)}</span></span><span class="go">${icon('i-arrow-up-right')}</span></a></li>`
          )
          .join('')}</ul>
      </section>`;
}

// ----------------------------------------------------------------- footer --

function footer() {
  const col = (title, brand, links) =>
    `<div class="fcol"><p class="fhead">${brand ? icon(`b-${brand}`) : icon('i-download-simple')}${esc(title)}</p><ul>${links
      .map(([p, l]) => `<li><a href="${p}">${esc(l)}</a></li>`)
      .join('')}</ul></div>`;
  const cols = GROUPS.map((g) =>
    col(
      g.label,
      g.brand,
      TOOLS.filter((t) => t.group === g.id).map((t) => [t.path, g.id === 'more' ? t.nav : t.nav])
    )
  ).join('');
  return `<footer class="site-foot">
      <div class="foot-inner">
        <div class="fcols">
          <div class="fcol about">
            <a class="brand" href="/"><span class="logo">${icon('i-download-simple')}</span>YTPocket</a>
            <p>Free downloader for videos, MP3 and thumbnails. No sign-up, no app.</p>
          </div>
          ${cols}
          ${col(
            'YTPocket',
            null,
            DOCS.map((d) => [d.path, d.nav])
          )}
        </div>
        <p class="fine">© 2026 YTPocket. Not affiliated with YouTube, TikTok, Meta, Pinterest, Dailymotion or Twitch. Only download videos you have the right to.</p>
      </div>
    </footer>`;
}

// --------------------------------------------------------- structured data --

function jsonld(page, trail) {
  const graph = [];
  if (trail.length > 1) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((i, n) => ({
        '@type': 'ListItem',
        position: n + 1,
        name: i.name,
        item: `{{origin}}${i.path}`,
      })),
    });
  }
  if (page.faq) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') },
      })),
    });
  }
  if (!graph.length) return '';
  // A data block, not a script that runs (allowed by the strict CSP). "<" is
  // escaped so text can never close the tag.
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// ----------------------------------------------------------------- render --

function fill(template, values, blocks) {
  return template
    .replace(/<!--[\s\S]*?-->\n/, '') // the template's own comment
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => blocks[k] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k === 'origin' ? m : k in values ? esc(values[k]) : ''));
}

function renderTool(template, page) {
  const { html: crumbHtml, items } = crumbs(page);
  return fill(
    template,
    {
      lang: 'en',
      path: page.path,
      title: page.title,
      description: page.description,
      h1: page.h1,
      lead: page.lead,
      pasteHint: page.pasteHint,
      cta: page.cta,
      tab: page.tab,
    },
    {
      robots: page.noindex ? '<meta name="robots" content="noindex" />' : '',
      header: header(page.path),
      crumbs: crumbHtml,
      tabs: sisterTabs(page),
      terms: 'By using YTPocket you accept the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.',
      content: [intro(page), steps(page), features(page), faq(page)].join('\n      '),
      related: related(page.path),
      footer: footer(),
      jsonld: page.noindex ? '' : jsonld(page, items),
    }
  );
}

function renderDoc(template, doc) {
  const { html: crumbHtml, items } = crumbs({ path: doc.path, crumb: doc.h1 });
  const body = doc.sections
    .map(([h, paras]) => `${h ? `<h2>${esc(h)}</h2>` : ''}${paras.map((p) => `<p>${inline(p)}</p>`).join('')}`)
    .join('\n        ');
  return fill(
    template,
    { lang: 'en', path: doc.path, title: doc.title, description: doc.description, h1: doc.h1 },
    { header: header(doc.path), crumbs: crumbHtml, body, footer: footer(), jsonld: jsonld({}, items) }
  );
}

const NOT_FOUND = {
  ...TOOLS[0],
  path: '/404',
  noindex: true,
  title: 'Page not found | YTPocket',
  description: 'This page does not exist.',
  h1: 'This page doesn’t exist',
  lead: 'But the downloader works right here: paste a video link below.',
};

function buildPages() {
  const toolTpl = fs.readFileSync(path.join(VIEWS, 'page.html'), 'utf8');
  const docTpl = fs.readFileSync(path.join(VIEWS, 'doc.html'), 'utf8');
  const pages = new Map();
  for (const t of TOOLS) pages.set(t.path, renderTool(toolTpl, t));
  for (const d of DOCS) pages.set(d.path, renderDoc(docTpl, d));
  return {
    pages,
    notFound: renderTool(toolTpl, NOT_FOUND).replace(`href="{{origin}}/404"`, 'href="{{origin}}/"'),
    list: [...TOOLS, ...DOCS].map((p) => ({ path: p.path })),
  };
}

module.exports = { buildPages, TOOLS, DOCS };
