// Downloader pages: one per platform, all using the same app (views/page.html).
// Each page has its own title, headline, how-to and FAQ so it can rank for
// its own searches ("tiktok downloader", "facebook video downloader"...).
// Any supported link works on any page.
//
// To add a page: add an entry here (and the site to SITES in lib/ytdlp.js).
const fs = require('fs');
const path = require('path');

const COMMON_FAQ = {
  free: {
    q: 'Is it free?',
    a: 'Yes. There is no sign-up, no app to install and no limit on how many videos you save.',
  },
  where: {
    q: 'Where do the files go?',
    a: "To your browser's Downloads folder. On Android that's the Files app (Downloads); on iPhone it's Files, then Downloads.",
  },
  privacy: {
    q: 'Do you keep my videos or links?',
    a: "No. Files are prepared on our server only to send them to you and are deleted after 15 minutes. There's no account and no history.",
  },
  legal: {
    q: 'Is it legal?',
    a: 'Download only videos you made yourself, that are free to use, or that you have permission to save. Respect the creator and the site’s terms.',
  },
};

const PAGES = [
  {
    path: '/',
    platform: 'YouTube',
    nav: 'YouTube downloader',
    title: 'YouTube Video & MP3 Downloader | YTPocket',
    description:
      'Download YouTube videos as MP4 (up to 4K) or MP3. Free, no sign-up, works on phone and computer. Paste a link and save the file to your device.',
    h1: 'Download YouTube videos and MP3',
    lead: 'Free. No sign-up. MP4 up to 4K or MP3.',
    pasteHint: 'or share from the YouTube app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', 'Shorts', '4K'],
    howtoTitle: 'How to download a YouTube video',
    howto: [
      'In YouTube, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick MP4 or MP3 and a quality. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Can I download YouTube Shorts and 4K videos?',
        a: 'Yes. Paste a Shorts link like any other video. You can choose every quality the video has, up to 4K and 60 fps.',
      },
      {
        q: 'How do I save a YouTube video as MP3?',
        a: 'Paste the link, tap Get video, open the Audio MP3 tab and pick 128 or 192 kbps (320 kbps when the video’s sound is good enough).',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
  {
    path: '/tiktok-downloader',
    platform: 'TikTok',
    nav: 'TikTok downloader',
    title: 'TikTok Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download TikTok videos as MP4 or save the sound as MP3. Free, no sign-up, works on phone and computer. Paste a TikTok link to start.',
    h1: 'Download TikTok videos and MP3',
    lead: 'Save public TikTok videos to your phone. Free, no sign-up.',
    pasteHint: 'or share from the TikTok app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', 'HD'],
    howtoTitle: 'How to download a TikTok video',
    howto: [
      'In TikTok, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick MP4 for the video or MP3 for the sound. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Can I save just the sound of a TikTok?',
        a: 'Yes. After pasting the link, open the Audio MP3 tab and pick a quality.',
      },
      {
        q: 'Can I download private TikTok videos?',
        a: 'No. Only public videos can be saved. Private videos and videos from private accounts are not available.',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
  {
    path: '/facebook-video-downloader',
    platform: 'Facebook',
    nav: 'Facebook video downloader',
    title: 'Facebook Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download public Facebook videos and reels as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Facebook video link to start.',
    h1: 'Download Facebook videos',
    lead: 'Public Facebook videos and reels as MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Facebook app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', 'Reels'],
    howtoTitle: 'How to download a Facebook video',
    howto: [
      'On Facebook, open the video, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick MP4 or MP3. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Why does a Facebook video not work?',
        a: 'Only public videos can be saved. Videos shared with friends only, or in private groups, need a login and are not available.',
      },
      {
        q: 'Does it work with Facebook Reels?',
        a: 'Yes. Copy the reel’s link and paste it here like any other video.',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
  {
    path: '/pinterest-video-downloader',
    platform: 'Pinterest',
    nav: 'Pinterest video downloader',
    title: 'Pinterest Video Downloader (MP4) | YTPocket',
    description:
      'Download Pinterest video pins as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Pinterest or pin.it link to start.',
    h1: 'Download Pinterest videos',
    lead: 'Save video pins as MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Pinterest app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', 'pin.it links'],
    howtoTitle: 'How to download a Pinterest video',
    howto: [
      'In Pinterest, open the video pin, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick a quality. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Do short pin.it links work?',
        a: 'Yes. Links from the Share button (pin.it/...) and full pinterest.com links both work.',
      },
      {
        q: 'Can I download Pinterest images?',
        a: 'This page is for video pins. For a picture, use “Save thumbnail” after loading a video, or save it in the Pinterest app.',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
  {
    path: '/dailymotion-downloader',
    platform: 'Dailymotion',
    nav: 'Dailymotion downloader',
    title: 'Dailymotion Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download Dailymotion videos as MP4 up to 1080p or as MP3. Free, no sign-up, works on phone and computer. Paste a Dailymotion link to start.',
    h1: 'Download Dailymotion videos',
    lead: 'MP4 up to 1080p or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Dailymotion app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', '1080p'],
    howtoTitle: 'How to download a Dailymotion video',
    howto: [
      'On Dailymotion, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick MP4 or MP3 and a quality. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Which qualities can I choose?',
        a: 'Every quality the video offers, usually up to 1080p.',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
  {
    path: '/twitch-clip-downloader',
    platform: 'Twitch',
    nav: 'Twitch clip downloader',
    title: 'Twitch Clip Downloader (MP4) | YTPocket',
    description:
      'Download Twitch clips and past broadcasts as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Twitch clip link to start.',
    h1: 'Download Twitch clips',
    lead: 'Save Twitch clips and past broadcasts as MP4 or MP3.',
    pasteHint: 'or share from the Twitch app',
    placeholder: 'Paste link here',
    chips: ['MP4', 'MP3', 'Clips'],
    howtoTitle: 'How to download a Twitch clip',
    howto: [
      'On Twitch, open the clip, tap Share, then Copy link.',
      'Paste the link here and tap Get video.',
      'Pick a quality. The file saves to your device.',
    ],
    faq: [
      COMMON_FAQ.free,
      {
        q: 'Can I download a whole stream?',
        a: 'Past broadcasts (VODs) up to 3 hours long can be saved. Live streams can’t be saved while they are live.',
      },
      COMMON_FAQ.where,
      COMMON_FAQ.privacy,
      COMMON_FAQ.legal,
    ],
  },
];

const NOT_FOUND = {
  path: '/404',
  platform: 'YouTube',
  nav: '',
  noindex: true,
  title: 'Page not found | YTPocket',
  description: 'This page does not exist.',
  h1: 'This page doesn’t exist',
  lead: 'But the downloader works right here: paste a video link below.',
  pasteHint: 'or share from the YouTube app',
  placeholder: 'Paste link here',
  chips: [],
  howtoTitle: 'How to download a video',
  howto: ['Copy the video link (Share, then Copy link).', 'Paste it here and tap Get video.', 'Pick MP4 or MP3.'],
  faq: [COMMON_FAQ.free, COMMON_FAQ.where],
};

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function renderPage(template, page) {
  const nav = PAGES.map((p) =>
    p.path === page.path
      ? `<li><a href="${p.path}" aria-current="page">${esc(p.nav)}</a></li>`
      : `<li><a href="${p.path}">${esc(p.nav)}</a></li>`
  ).join('\n          ');
  const faq = page.faq
    .map((f) => `<details>\n          <summary>${esc(f.q)}</summary>\n          <p>${esc(f.a)}</p>\n        </details>`)
    .join('\n        ');
  // Structured data so search engines can show the FAQ. A JSON data block,
  // not a script that runs (allowed by the strict CSP). "<" is escaped so the
  // text can never close the tag.
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }).replace(/</g, '\\u003c');

  const values = {
    lang: 'en',
    path: page.path === '/404' ? '/' : page.path,
    title: page.title,
    description: page.description,
    platform: page.platform,
    h1: page.h1,
    lead: page.lead,
    pasteHint: page.pasteHint,
    placeholder: page.placeholder,
    howtoTitle: page.howtoTitle,
  };
  const blocks = {
    robots: page.noindex ? '<meta name="robots" content="noindex" />' : '',
    chips: page.chips.map((c) => `<li>${esc(c)}</li>`).join('\n        '),
    howto: page.howto.map((s) => `<li>${esc(s)}</li>`).join('\n          '),
    faq,
    nav,
    jsonld: page.noindex ? '' : `<script type="application/ld+json">${jsonld}</script>`,
  };
  return template
    .replace(/<!--[\s\S]*?-->\n/, '') // drop the template's own comment
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => blocks[k] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k === 'origin' ? m : k in values ? esc(values[k]) : ''));
}

// Render every page once at startup. {{origin}} stays a placeholder and is
// filled per request (it depends on the domain the site is served from).
function buildPages(templatePath = path.join(__dirname, '..', 'views', 'page.html')) {
  const template = fs.readFileSync(templatePath, 'utf8');
  const map = new Map();
  for (const p of PAGES) map.set(p.path, renderPage(template, p));
  return { pages: map, notFound: renderPage(template, NOT_FOUND), list: PAGES };
}

module.exports = { buildPages, PAGES };
