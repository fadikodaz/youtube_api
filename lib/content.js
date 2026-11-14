// Site content: every tool page and legal page, as data.
// lib/pages.js turns this into HTML. Text only lives here, so wording can be
// edited (and later translated) without touching code.
//
// Inline links in text: [link text](/path) (internal paths only).
// Tool page fields:
//   path, group, nav (menu label), note (menu sub-line), crumb (breadcrumb
//   label), tab ('video' | 'audio' | 'thumbnail': which tab/mode opens),
//   cta (button label), title, description, h1, lead, placeholder, pasteHint,
//   intro[], steps { app, brand, link, final, texts[3] }, features (set
//   name), faq[], card { label, note, format }

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@ytpocket.com';

// Brand colours (from Simple Icons) for the sticker badges and step pictures.
const BRANDS = {
  youtube: { name: 'YouTube', color: '#FF0000' },
  tiktok: { name: 'TikTok', color: '#000000' },
  facebook: { name: 'Facebook', color: '#0866FF' },
  pinterest: { name: 'Pinterest', color: '#BD081C' },
  dailymotion: { name: 'Dailymotion', color: '#0A0A0A' },
  twitch: { name: 'Twitch', color: '#9146FF' },
};

// Menu groups, in header order.
const GROUPS = [
  { id: 'youtube', label: 'YouTube', brand: 'youtube' },
  { id: 'tiktok', label: 'TikTok', brand: 'tiktok' },
  { id: 'facebook', label: 'Facebook', brand: 'facebook' },
  { id: 'more', label: 'More', brand: null },
];

// "What you get" sets: [icon, tile colour, title, text]
const FEATURES = {
  // Keep titles to ~2 words and texts to ~25 characters: they sit in five
  // narrow columns on desktop.
  video: [
    ['film-strip', 'pop', 'Every quality', '144p up to 4K, 60 fps'],
    ['music-notes', 'mint', 'MP3 too', 'Just open the Audio tab'],
    ['devices', 'sun', 'Any device', 'Phone, tablet or computer'],
    ['infinity', 'pop', 'Free, no limits', 'No sign-up, no app'],
    ['shield-check', 'mint', 'Private', 'Files deleted in 15 min'],
  ],
  audio: [
    ['music-notes', 'pop', 'Title and cover', 'Looks right in music apps'],
    ['sliders-horizontal', 'mint', 'Your quality', '128, 192 or 320 kbps'],
    ['devices', 'sun', 'Any device', 'Phone, tablet or computer'],
    ['infinity', 'pop', 'Free, no limits', 'No sign-up, no app'],
    ['shield-check', 'mint', 'Private', 'Files deleted in 15 min'],
  ],
  thumbnail: [
    ['image', 'pop', 'Biggest size', 'Often HD, 1280×720'],
    ['lightning', 'mint', 'Instant', 'No converting needed'],
    ['devices', 'sun', 'Any device', 'Phone, tablet or computer'],
    ['infinity', 'pop', 'Free, no limits', 'No sign-up, no app'],
    ['shield-check', 'mint', 'Private', 'Nothing stored about you'],
  ],
  short: [
    ['device-mobile', 'pop', 'Stays vertical', 'Saved just as it was posted'],
    ['music-notes', 'mint', 'Sound as MP3', 'Just open the Audio tab'],
    ['devices', 'sun', 'Any device', 'Phone, tablet or computer'],
    ['infinity', 'pop', 'Free, no limits', 'No sign-up, no app'],
    ['shield-check', 'mint', 'Private', 'Files deleted in 15 min'],
  ],
};

// Questions shared by many pages.
const Q = {
  free: {
    q: 'Is it free?',
    a: 'Yes. There’s no sign-up, no app to install and no limit on how many videos you save.',
  },
  where: {
    q: 'Where do the files go?',
    a: 'To your browser’s Downloads folder. On Android that’s the Files app (Downloads); on iPhone it’s the Files app, then Downloads.',
  },
  iphone: {
    q: 'Does it work on iPhone?',
    a: 'Yes. Open YTPocket in Safari, paste the link and tap a format. Safari asks where to save; the file then appears in the Files app.',
  },
  privacy: {
    q: 'Do you keep my videos or links?',
    a: 'No. Files are prepared on our server only to send them to you and are deleted after 15 minutes. There’s no account and no history.',
  },
  legal: {
    q: 'Is it legal?',
    a: 'Download only videos you made yourself, that are free to use, or that you have permission to save. Respect creators and each site’s terms.',
  },
  slow: {
    q: 'Why does a download take a while?',
    a: 'Our server first fetches the video and, for MP3 or high qualities, converts or joins it. Long videos take longer. You can leave the page open in the background; the file saves when it’s ready.',
  },
};

const TOOLS = [
  // ---------------------------------------------------------------- YouTube
  {
    path: '/',
    short: 'Video',
    introTitle: 'Save any YouTube video',
    stepsTitle: 'How to download a YouTube video',
    group: 'youtube',
    nav: 'Video downloader',
    note: 'MP4 up to 4K',
    crumb: 'YouTube downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'YouTube Video & MP3 Downloader | YTPocket',
    description:
      'Download YouTube videos as MP4 (up to 4K) or MP3. Free, no sign-up, works on phone and computer. Paste a link and save the file to your device.',
    h1: 'Download YouTube videos and MP3',
    lead: 'Free. No sign-up. MP4 up to 4K or MP3.',
    pasteHint: 'or share from the YouTube app',
    intro: [
      'Paste a YouTube link and choose how to save it: as an MP4 video in any quality the video has, up to 4K and 60 fps, or as an MP3. Files get the video’s title and picture built in, so they look right on your phone.',
      'Want only the sound? Use [YouTube to MP3](/youtube-to-mp3). Saving a Short? The [Shorts downloader](/youtube-shorts-downloader) keeps it vertical. Need the cover image? Try the [thumbnail downloader](/youtube-thumbnail-downloader).',
    ],
    steps: {
      brand: 'youtube',
      link: 'youtu.be/aqz-KE-bpKQ',
      final: 'video',
      texts: [
        'In YouTube, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick a quality. The video saves to your device by itself.',
      ],
    },
    features: 'video',
    faq: [
      Q.free,
      {
        q: 'Which quality should I pick?',
        a: '1080p looks sharp on phones and laptops. 4K is for big screens and makes much bigger files. 720p is a good choice when space or data is limited.',
      },
      {
        q: 'Some qualities say “Plays in browsers and VLC”. What does that mean?',
        a: 'Above 1080p, YouTube only offers newer video formats. They play in Chrome, Firefox and VLC, but some older phones and TVs can’t open them. 1080p and below play everywhere.',
      },
      Q.iphone,
      Q.slow,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'YouTube video', note: 'MP4 up to 4K' },
  },
  {
    path: '/youtube-to-mp3',
    short: 'To MP3',
    introTitle: 'Turn YouTube videos into MP3',
    stepsTitle: 'How to convert YouTube to MP3',
    group: 'youtube',
    nav: 'YouTube to MP3',
    note: 'Just the sound',
    crumb: 'YouTube to MP3',
    tab: 'audio',
    cta: 'Get MP3',
    title: 'YouTube to MP3 Converter (128, 192, 320 kbps) | YTPocket',
    description:
      'Convert YouTube videos to MP3 at 128, 192 or 320 kbps, with title and cover art. Free, no sign-up, works on phone and computer.',
    h1: 'YouTube to MP3 converter',
    lead: 'Save the sound of any YouTube video as MP3. Free, no sign-up.',
    pasteHint: 'or share from the YouTube app',
    intro: [
      'Paste a YouTube link and get an MP3 at 128 or 192 kbps, or 320 kbps when the video’s sound is good enough. The file includes the title, the channel and the cover picture, so it looks right in your music app.',
      'Need the picture too? Use the [YouTube video downloader](/) or [YouTube to MP4](/youtube-to-mp4). Saving a TikTok sound? Try [TikTok to MP3](/tiktok-to-mp3).',
    ],
    steps: {
      brand: 'youtube',
      link: 'youtu.be/aqz-KE-bpKQ',
      final: 'audio',
      texts: [
        'In YouTube, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get MP3.',
        'Tap 192 or 128 kbps. The MP3 saves to your device by itself.',
      ],
    },
    features: 'audio',
    faq: [
      {
        q: 'Which MP3 quality should I choose?',
        a: '192 kbps sounds as good as the YouTube original for almost everyone. 128 kbps makes smaller files. 320 kbps is only offered when the video’s own sound is good enough to benefit from it.',
      },
      {
        q: 'Can I convert long videos and mixes?',
        a: 'Yes, up to 3 hours long. Longer videos take a little longer to prepare; the progress bar shows how far along it is.',
      },
      {
        q: 'What is “M4A original”?',
        a: 'It’s YouTube’s own sound track, saved without converting. It has the best possible quality and plays on iPhones, Macs and most Android phones.',
      },
      Q.free,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'YouTube to MP3', note: 'Just the sound', format: 'MP3' },
  },
  {
    path: '/youtube-to-mp4',
    short: 'To MP4',
    introTitle: 'MP4 in the quality you want',
    stepsTitle: 'How to convert YouTube to MP4',
    group: 'youtube',
    nav: 'YouTube to MP4',
    note: 'Pick a quality',
    crumb: 'YouTube to MP4',
    tab: 'video',
    cta: 'Get MP4',
    title: 'YouTube to MP4 Converter (1080p, 4K) | YTPocket',
    description:
      'Convert YouTube videos to MP4 in any quality: 360p, 720p, 1080p or 4K. Free, no sign-up, works on phone and computer.',
    h1: 'YouTube to MP4 converter',
    lead: 'Every quality the video has, from 144p to 4K. Free, no sign-up.',
    pasteHint: 'or share from the YouTube app',
    intro: [
      'MP4 is the video format that plays on every phone, computer and TV. Paste a YouTube link and choose the exact quality you want; video and sound are joined into one MP4 file with the title and cover picture built in.',
      'Only need the sound? Use [YouTube to MP3](/youtube-to-mp3). For vertical videos, the [Shorts downloader](/youtube-shorts-downloader) is the quickest way.',
    ],
    steps: {
      brand: 'youtube',
      link: 'youtube.com/watch?v=aqz…',
      final: 'video',
      texts: [
        'In YouTube, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get MP4.',
        'Pick 1080p, 720p or any other quality. The MP4 saves by itself.',
      ],
    },
    features: 'video',
    faq: [
      {
        q: 'Which MP4 quality plays everywhere?',
        a: '1080p and below use H.264, which plays on every phone, computer and TV. Higher qualities use newer formats that play in browsers and VLC.',
      },
      {
        q: 'How big will the file be?',
        a: 'Each quality shows an estimated size before you download. As a guide, a 10-minute video is about 30 MB at 480p, 150 MB at 1080p and over 1 GB in 4K.',
      },
      Q.free,
      Q.slow,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'YouTube to MP4', note: 'Pick a quality', format: 'MP4' },
  },
  {
    path: '/youtube-shorts-downloader',
    short: 'Shorts',
    introTitle: 'Keep your favourite Shorts',
    stepsTitle: 'How to download a YouTube Short',
    group: 'youtube',
    nav: 'Shorts downloader',
    note: 'Vertical videos',
    crumb: 'Shorts downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'YouTube Shorts Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download YouTube Shorts as vertical MP4 videos or save the sound as MP3. Free, no sign-up, works on phone and computer.',
    h1: 'Download YouTube Shorts',
    lead: 'Save Shorts as vertical MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the YouTube app',
    intro: [
      'Shorts are saved exactly as they were posted: vertical, in the best quality available, with the sound. Paste the Short’s link, pick a quality and the MP4 lands in your Downloads.',
      'Want the music from a Short? Switch to Audio MP3 or use [YouTube to MP3](/youtube-to-mp3). Saving a TikTok instead? Use the [TikTok downloader](/tiktok-downloader).',
    ],
    steps: {
      brand: 'youtube',
      link: 'youtube.com/shorts/aqz…',
      final: 'video',
      texts: [
        'On the Short, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick a quality. The Short saves to your device by itself.',
      ],
    },
    features: 'short',
    faq: [
      {
        q: 'Do Shorts stay vertical?',
        a: 'Yes. The video is saved exactly as it was posted, without black bars or cropping.',
      },
      {
        q: 'Which links work?',
        a: 'Links that contain /shorts/, and the youtu.be links from the Share button, both work.',
      },
      Q.free,
      Q.iphone,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Shorts downloader', note: 'Vertical videos' },
  },
  {
    path: '/youtube-thumbnail-downloader',
    short: 'Thumbnail',
    introTitle: 'Get any video’s cover image',
    stepsTitle: 'How to save a YouTube thumbnail',
    group: 'youtube',
    nav: 'Thumbnail downloader',
    note: 'HD cover image',
    crumb: 'Thumbnail downloader',
    tab: 'thumbnail',
    cta: 'Get thumbnail',
    title: 'YouTube Thumbnail Downloader (HD) | YTPocket',
    description:
      'Download the thumbnail of any YouTube video in the biggest size available, often HD 1280×720. Free, no sign-up.',
    h1: 'YouTube thumbnail downloader',
    lead: 'Save the cover image of any video in HD. Free, no sign-up.',
    pasteHint: 'or share from the YouTube app',
    intro: [
      'Paste a YouTube link to see the video’s thumbnail and save it in the biggest size YouTube has, usually HD (1280×720). Handy for presentations, reviews or your own video planning.',
      'Want the video itself? Use the [YouTube video downloader](/). Just the sound? Try [YouTube to MP3](/youtube-to-mp3).',
    ],
    steps: {
      brand: 'youtube',
      link: 'youtu.be/aqz-KE-bpKQ',
      final: 'thumbnail',
      texts: [
        'In YouTube, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get thumbnail.',
        'Tap Save thumbnail. The image saves to your device.',
      ],
    },
    features: 'thumbnail',
    faq: [
      {
        q: 'What size is the thumbnail?',
        a: 'The biggest one the video has. For most videos that’s HD (1280×720); older or smaller videos may only have 640×480 or 480×360.',
      },
      {
        q: 'Can I use the thumbnail anywhere?',
        a: 'Thumbnails belong to the video’s creator. Using one for a review, a comment or your own reference is usually fine; publishing it as your own work is not.',
      },
      Q.free,
      Q.where,
      Q.privacy,
    ],
    card: { label: 'Thumbnail downloader', note: 'HD cover image', format: 'JPG' },
  },

  // ----------------------------------------------------------------- TikTok
  {
    path: '/tiktok-downloader',
    short: 'Video',
    introTitle: 'Save TikToks to your phone',
    stepsTitle: 'How to download a TikTok video',
    group: 'tiktok',
    nav: 'TikTok downloader',
    note: 'Videos as MP4',
    crumb: 'TikTok downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'TikTok Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download TikTok videos as MP4 or save the sound as MP3. Free, no sign-up, works on phone and computer. Paste a TikTok link to start.',
    h1: 'Download TikTok videos',
    lead: 'Save public TikTok videos to your phone. Free, no sign-up.',
    pasteHint: 'or share from the TikTok app',
    intro: [
      'Paste the link of a public TikTok and save it as an MP4 in the best quality available. It works with links from the app’s Share button and with tiktok.com links.',
      'Only want the sound? Use [TikTok to MP3](/tiktok-to-mp3). Saving YouTube Shorts too? Try the [Shorts downloader](/youtube-shorts-downloader).',
    ],
    steps: {
      brand: 'tiktok',
      link: 'vm.tiktok.com/ZM…',
      final: 'video',
      texts: [
        'In TikTok, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick a quality. Done: it’s in your Downloads.',
      ],
    },
    features: 'short',
    faq: [
      {
        q: 'Can I download private TikTok videos?',
        a: 'No. Only public videos can be saved. Videos from private accounts, or shared with friends only, are not available.',
      },
      {
        q: 'Why does a TikTok link say it isn’t available?',
        a: 'TikTok sometimes blocks a video in some countries or networks, or the video was deleted. Try again later or try another video.',
      },
      Q.free,
      Q.iphone,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'TikTok downloader', note: 'Videos as MP4' },
  },
  {
    path: '/tiktok-to-mp3',
    short: 'To MP3',
    introTitle: 'Keep the sounds you love',
    stepsTitle: 'How to save a TikTok sound as MP3',
    group: 'tiktok',
    nav: 'TikTok to MP3',
    note: 'Just the sound',
    crumb: 'TikTok to MP3',
    tab: 'audio',
    cta: 'Get MP3',
    title: 'TikTok to MP3: Save TikTok Sounds | YTPocket',
    description:
      'Save the sound or song of any public TikTok as an MP3. Free, no sign-up, works on phone and computer. Paste a TikTok link to start.',
    h1: 'TikTok to MP3',
    lead: 'Save the sound of any public TikTok as MP3. Free, no sign-up.',
    pasteHint: 'or share from the TikTok app',
    intro: [
      'Found a sound you love? Paste the TikTok link and save its audio as an MP3, ready for your music app, a ringtone or your own edits.',
      'Want the whole video? Use the [TikTok downloader](/tiktok-downloader). Saving music from YouTube? Try [YouTube to MP3](/youtube-to-mp3).',
    ],
    steps: {
      brand: 'tiktok',
      link: 'vm.tiktok.com/ZM…',
      final: 'audio',
      texts: [
        'In TikTok, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get MP3.',
        'Tap a quality. The MP3 saves to your device by itself.',
      ],
    },
    features: 'audio',
    faq: [
      {
        q: 'Do I get the original song or the video’s sound?',
        a: 'You get the sound exactly as it plays in that TikTok, including any voice-over or effects.',
      },
      {
        q: 'Can I use it as a ringtone?',
        a: 'Yes. On Android, move the MP3 to the Ringtones folder or pick it in Settings, Sound. On iPhone, ringtones need GarageBand or a computer.',
      },
      Q.free,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'TikTok to MP3', note: 'Just the sound', format: 'MP3' },
  },

  // --------------------------------------------------------------- Facebook
  {
    path: '/facebook-video-downloader',
    short: 'Videos',
    introTitle: 'Save public Facebook videos',
    stepsTitle: 'How to download a Facebook video',
    group: 'facebook',
    nav: 'Video downloader',
    note: 'Public videos',
    crumb: 'Facebook video downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'Facebook Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download public Facebook videos as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Facebook video link to start.',
    h1: 'Download Facebook videos',
    lead: 'Public Facebook videos as MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Facebook app',
    intro: [
      'Paste the link of a public Facebook video and save it as an MP4, or save just the sound as an MP3. Links from the Share button and fb.watch links both work.',
      'Saving a reel? Use the [Facebook Reels downloader](/facebook-reels-downloader). Have a YouTube link? Use the [YouTube downloader](/).',
    ],
    steps: {
      brand: 'facebook',
      link: 'fb.watch/abc123…',
      final: 'video',
      texts: [
        'On Facebook, open the video, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick MP4 or MP3. The file saves to your device.',
      ],
    },
    features: 'video',
    faq: [
      {
        q: 'Why does a Facebook video not work?',
        a: 'Only public videos can be saved. Videos shared with friends only, or posted in private groups, need a login and are not available.',
      },
      {
        q: 'Which links work?',
        a: 'Links from the Share button (facebook.com/…/videos/…, fb.watch/…) and links from the address bar of a video page.',
      },
      Q.free,
      Q.iphone,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Facebook video', note: 'Public videos' },
  },
  {
    path: '/facebook-reels-downloader',
    short: 'Reels',
    introTitle: 'Save Facebook Reels',
    stepsTitle: 'How to download a Facebook reel',
    group: 'facebook',
    nav: 'Reels downloader',
    note: 'Short videos',
    crumb: 'Facebook Reels',
    tab: 'video',
    cta: 'Get reel',
    title: 'Facebook Reels Downloader (MP4) | YTPocket',
    description:
      'Download public Facebook Reels as MP4 or save the sound as MP3. Free, no sign-up, works on phone and computer.',
    h1: 'Download Facebook Reels',
    lead: 'Save public reels as MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Facebook app',
    intro: [
      'Paste the link of a public Facebook reel and save it as a vertical MP4, or save its sound as an MP3. Reels are saved as they were posted, with the sound.',
      'Saving a regular video? Use the [Facebook video downloader](/facebook-video-downloader). Short videos from TikTok? Try the [TikTok downloader](/tiktok-downloader).',
    ],
    steps: {
      brand: 'facebook',
      link: 'facebook.com/reel/123…',
      final: 'video',
      texts: [
        'On the reel, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get reel.',
        'Pick a quality. The reel saves to your device.',
      ],
    },
    features: 'short',
    faq: [
      {
        q: 'Can I download any reel?',
        a: 'Public reels, yes. Reels shared with friends only need a login and are not available.',
      },
      Q.free,
      Q.iphone,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Facebook Reels', note: 'Short videos' },
  },

  // ------------------------------------------------------------------- More
  {
    path: '/pinterest-video-downloader',
    short: 'Pinterest',
    introTitle: 'Save video pins',
    stepsTitle: 'How to download a Pinterest video',
    group: 'more',
    brand: 'pinterest',
    nav: 'Pinterest',
    note: 'Video pins',
    crumb: 'Pinterest video downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'Pinterest Video Downloader (MP4) | YTPocket',
    description:
      'Download Pinterest video pins as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Pinterest or pin.it link to start.',
    h1: 'Download Pinterest videos',
    lead: 'Save video pins as MP4 or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Pinterest app',
    intro: [
      'Paste the link of a Pinterest video pin and save it as an MP4 in the best quality available. Short pin.it links from the app’s Share button work too.',
      'Want the cover picture? After loading the video, use Save thumbnail. Other sites: [TikTok](/tiktok-downloader), [Facebook](/facebook-video-downloader).',
    ],
    steps: {
      brand: 'pinterest',
      link: 'pin.it/4bc12…',
      final: 'video',
      texts: [
        'In Pinterest, open the video pin, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick a quality. The video saves to your device.',
      ],
    },
    features: 'video',
    faq: [
      {
        q: 'Do short pin.it links work?',
        a: 'Yes. Links from the Share button (pin.it/…) and full pinterest.com links both work.',
      },
      {
        q: 'Can I download Pinterest images?',
        a: 'This tool is for video pins. For a picture, use Save thumbnail after loading a video pin, or save it in the Pinterest app.',
      },
      Q.free,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Pinterest video', note: 'Video pins' },
  },
  {
    path: '/dailymotion-downloader',
    short: 'Dailymotion',
    introTitle: 'Dailymotion videos, any quality',
    stepsTitle: 'How to download a Dailymotion video',
    group: 'more',
    brand: 'dailymotion',
    nav: 'Dailymotion',
    note: 'Up to 1080p',
    crumb: 'Dailymotion downloader',
    tab: 'video',
    cta: 'Get video',
    title: 'Dailymotion Video Downloader (MP4 & MP3) | YTPocket',
    description:
      'Download Dailymotion videos as MP4 up to 1080p or as MP3. Free, no sign-up, works on phone and computer. Paste a Dailymotion link to start.',
    h1: 'Download Dailymotion videos',
    lead: 'MP4 up to 1080p or MP3. Free, no sign-up.',
    pasteHint: 'or share from the Dailymotion app',
    intro: [
      'Paste a Dailymotion link and choose any quality the video has, usually up to 1080p, or save the sound as an MP3. Short dai.ly links work too.',
      'Have a YouTube link? Use the [YouTube downloader](/). Twitch clip? Try the [Twitch clip downloader](/twitch-clip-downloader).',
    ],
    steps: {
      brand: 'dailymotion',
      link: 'dai.ly/x5kesuj',
      final: 'video',
      texts: [
        'On Dailymotion, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get video.',
        'Pick MP4 or MP3 and a quality. The file saves to your device.',
      ],
    },
    features: 'video',
    faq: [
      {
        q: 'Which qualities can I choose?',
        a: 'Every quality the video offers, usually from 240p up to 1080p.',
      },
      Q.free,
      Q.iphone,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Dailymotion', note: 'Up to 1080p' },
  },
  {
    path: '/twitch-clip-downloader',
    short: 'Twitch',
    introTitle: 'Keep your best Twitch moments',
    stepsTitle: 'How to download a Twitch clip',
    group: 'more',
    brand: 'twitch',
    nav: 'Twitch clips',
    note: 'Clips and VODs',
    crumb: 'Twitch clip downloader',
    tab: 'video',
    cta: 'Get clip',
    title: 'Twitch Clip Downloader (MP4) | YTPocket',
    description:
      'Download Twitch clips and past broadcasts as MP4 or MP3. Free, no sign-up, works on phone and computer. Paste a Twitch clip link to start.',
    h1: 'Download Twitch clips',
    lead: 'Save Twitch clips and past broadcasts as MP4 or MP3.',
    pasteHint: 'or share from the Twitch app',
    intro: [
      'Paste a Twitch clip link to save it as an MP4 in the best quality available. Past broadcasts (VODs) up to 3 hours long work too.',
      'Gaming videos on YouTube? Use the [YouTube downloader](/). Short videos? Try the [TikTok downloader](/tiktok-downloader).',
    ],
    steps: {
      brand: 'twitch',
      link: 'clips.twitch.tv/Faint…',
      final: 'video',
      texts: [
        'On Twitch, open the clip, tap Share, then Copy link.',
        'Paste the link in the box above and tap Get clip.',
        'Tap Best quality. The clip saves to your device.',
      ],
    },
    features: 'video',
    faq: [
      {
        q: 'Can I download a whole stream?',
        a: 'Past broadcasts (VODs) up to 3 hours long can be saved. Live streams can’t be saved while they are live.',
      },
      Q.free,
      Q.where,
      Q.privacy,
      Q.legal,
    ],
    card: { label: 'Twitch clips', note: 'Clips and VODs' },
  },
];

// ------------------------------------------------------------ legal pages --
// Plain-language templates. Have them checked by a lawyer for your country
// before launch; they are not legal advice.
const UPDATED = '14 November 2026';

const DOCS = [
  {
    path: '/terms',
    nav: 'Terms',
    title: 'Terms of Use | YTPocket',
    description: 'The rules for using YTPocket.',
    h1: 'Terms of Use',
    sections: [
      [null, [`Last updated: ${UPDATED}. By using YTPocket you agree to these terms.`]],
      [
        'What YTPocket does',
        [
          'YTPocket is a free tool that saves videos, audio and thumbnails from links you paste, from supported sites (currently YouTube, TikTok, Facebook, Pinterest, Dailymotion and Twitch). The file is prepared on our server and sent to you.',
          'YTPocket is not affiliated with, endorsed by or connected to any of those sites.',
        ],
      ],
      [
        'Your responsibility',
        [
          'Only download content that you own, that is in the public domain or under a licence that allows downloading, or that you have the rights holder’s permission to save.',
          'You are responsible for how you use downloaded files and for following the terms of the site the content comes from and the copyright law of your country.',
        ],
      ],
      [
        'What you may not do',
        [
          'Use YTPocket to infringe copyright or other rights, to download content you have no right to, or for anything illegal.',
          'Overload, scrape or automate the service, try to get around its limits or security, or resell it.',
        ],
      ],
      [
        'The service',
        [
          'YTPocket is provided free and “as is”, without guarantees. Sites change often, so some links or formats may stop working. We may limit, change or stop the service at any time.',
          'To the extent allowed by law, we are not liable for any loss or damage from using YTPocket or from files you download.',
        ],
      ],
      [
        'Copyright complaints',
        ['If you believe YTPocket is used to infringe your rights, see our [Copyright policy](/copyright).'],
      ],
      [
        'Changes',
        [
          'We may update these terms. The date at the top shows the latest version. Continuing to use YTPocket means you accept the update.',
        ],
      ],
      ['Contact', [`Questions: ${CONTACT_EMAIL}`]],
    ],
  },
  {
    path: '/privacy',
    nav: 'Privacy',
    title: 'Privacy Policy | YTPocket',
    description: 'What YTPocket collects (very little) and why.',
    h1: 'Privacy Policy',
    sections: [
      [
        null,
        [
          `Last updated: ${UPDATED}. Short version: no account, no tracking, no history. Files are deleted after 15 minutes.`,
        ],
      ],
      [
        'What we don’t collect',
        [
          'No account, no name, no email. No analytics or advertising trackers and no tracking cookies. We don’t keep a history of the videos you download.',
        ],
      ],
      [
        'What our server handles',
        [
          'The link you paste, to fetch the video from the site it comes from.',
          'The prepared file, kept on our server for up to 15 minutes so you can download it, then deleted.',
          'Your IP address, kept in memory only to enforce fair-use limits (for example, how many downloads run at once), and written to our server logs with the time and the page or feature used. Logs are used to keep the service secure and working, and are deleted after 14 days.',
        ],
      ],
      [
        'Stored on your device',
        [
          'If you choose dark mode, that choice is saved in your browser (local storage). While a download is running, its progress is kept in this browser tab (session storage) so a reload doesn’t lose it; it disappears when you close the tab. You can clear both in your browser settings at any time.',
        ],
      ],
      [
        'Other sites',
        [
          'To prepare a file, our server contacts the site the video comes from (for example YouTube). YouTube thumbnails are loaded by your browser directly from YouTube’s image servers; thumbnails from other sites are loaded through our server. Those sites have their own privacy policies.',
        ],
      ],
      ['Children', ['YTPocket is not directed at children under 13 and does not knowingly collect their data.']],
      [
        'Your rights',
        [
          `Because we keep almost nothing, there is usually nothing to access or delete. For any privacy question: ${CONTACT_EMAIL}`,
        ],
      ],
    ],
  },
  {
    path: '/copyright',
    nav: 'Copyright (DMCA)',
    title: 'Copyright Policy (DMCA) | YTPocket',
    description: 'How to report copyright infringement to YTPocket.',
    h1: 'Copyright policy',
    sections: [
      [
        null,
        [
          `Last updated: ${UPDATED}. YTPocket respects creators’ rights. We don’t host videos: files are prepared on request from links users paste and deleted after 15 minutes.`,
        ],
      ],
      [
        'Reporting infringement',
        [
          `If you own the rights to content and believe YTPocket is being used to infringe them, email ${CONTACT_EMAIL} with:`,
          '1. Your name and contact details, and that you are the rights owner or authorised to act for them.',
          '2. The content concerned (for example the video’s link on YouTube).',
          '3. A statement that you believe in good faith the use is not authorised, and that the information in your notice is accurate.',
          '4. Your physical or electronic signature.',
        ],
      ],
      [
        'What we do',
        [
          'We review every complete notice and, where appropriate, block the content concerned from being processed by YTPocket. Repeat abuse of the service leads to blocking.',
        ],
      ],
    ],
  },
  {
    path: '/contact',
    nav: 'Contact',
    title: 'Contact | YTPocket',
    description: 'How to reach the YTPocket team.',
    h1: 'Contact',
    sections: [
      [null, [`Email: ${CONTACT_EMAIL}`]],
      [
        'Before you write',
        [
          'Most problems are explained on the page itself: if a video won’t load, the message under the link box says why. Private videos, and videos that need a login, can’t be saved.',
          'For copyright notices, please follow our [Copyright policy](/copyright) so we can act quickly.',
        ],
      ],
    ],
  },
];

module.exports = { TOOLS, DOCS, GROUPS, BRANDS, FEATURES, CONTACT_EMAIL };
