const socialPlatforms = [
  { id: 'facebook', labelKey: 'facebook', environmentKey: 'VITE_FACEBOOK_URL', hosts: ['facebook.com'] },
  { id: 'x', labelKey: 'xSocial', environmentKey: 'VITE_X_URL', hosts: ['x.com', 'twitter.com'] },
  { id: 'youtube', labelKey: 'youtube', environmentKey: 'VITE_YOUTUBE_URL', hosts: ['youtube.com'] },
  { id: 'linkedin', labelKey: 'linkedin', environmentKey: 'VITE_LINKEDIN_URL', hosts: ['linkedin.com'] },
  { id: 'instagram', labelKey: 'instagram', environmentKey: 'VITE_INSTAGRAM_URL', hosts: ['instagram.com'] },
  { id: 'telegram', labelKey: 'telegram', environmentKey: 'VITE_TELEGRAM_URL', hosts: ['t.me'] },
];

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : {
  VITE_FACEBOOK_URL: import.meta.env.VITE_FACEBOOK_URL,
  VITE_X_URL: import.meta.env.VITE_X_URL,
  VITE_YOUTUBE_URL: import.meta.env.VITE_YOUTUBE_URL,
  VITE_LINKEDIN_URL: import.meta.env.VITE_LINKEDIN_URL,
  VITE_INSTAGRAM_URL: import.meta.env.VITE_INSTAGRAM_URL,
  VITE_TELEGRAM_URL: import.meta.env.VITE_TELEGRAM_URL,
};

export function getFooterSocialLinks(environment = viteEnvironment) {
  return socialPlatforms.map((platform) => {
    const url = environment[platform.environmentKey]?.trim();
    if (!url) return { id: platform.id, labelKey: platform.labelKey, url: null };

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`${platform.environmentKey} must be a valid HTTPS URL.`);
    }

    if (parsedUrl.protocol !== 'https:'
      || !platform.hosts.includes(parsedUrl.hostname.toLowerCase())
      || parsedUrl.username
      || parsedUrl.password) {
      throw new Error(`${platform.environmentKey} must be a valid HTTPS URL.`);
    }

    if (parsedUrl.pathname === '/') {
      return { id: platform.id, labelKey: platform.labelKey, url: null };
    }

    return {
      id: platform.id,
      labelKey: platform.labelKey,
      url: parsedUrl.toString(),
    };
  });
}

function getSettingsSocialLinks(settings) {
  const configured = new Map();
  for (const social of settings) {
    if (!social || typeof social.label !== 'string' || typeof social.url !== 'string') continue;
    let parsedUrl;
    try {
      parsedUrl = new URL(social.url);
    } catch {
      continue;
    }
    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    const label = social.label.trim().toLowerCase();
    const platform = socialPlatforms.find((candidate) => (
      candidate.hosts.includes(host)
      || (candidate.id === 'x' && ['x', 'twitter'].includes(label))
      || candidate.id === 'instagram' && label === 'instagram'
      || candidate.id === 'facebook' && label === 'facebook'
      || candidate.id === 'youtube' && label === 'youtube'
      || candidate.id === 'linkedin' && label === 'linkedin'
      || candidate.id === 'telegram' && label === 'telegram'
    ));
    if (!platform || parsedUrl.protocol !== 'https:' || platform.hosts.every((allowedHost) => host !== allowedHost)
      || parsedUrl.username || parsedUrl.password || parsedUrl.pathname === '/') continue;
    configured.set(platform.id, {
      id: platform.id,
      labelKey: platform.labelKey,
      url: parsedUrl.toString(),
    });
  }
  return socialPlatforms.flatMap(({ id }) => configured.has(id) ? [configured.get(id)] : []);
}

export function getTopBarSocialLinks(environment = viteEnvironment, settings = []) {
  if (Array.isArray(settings) && settings.length > 0) return getSettingsSocialLinks(settings);

  const topBarEnvironment = Object.fromEntries(socialPlatforms.map((platform) => {
    const url = environment[platform.environmentKey]?.trim();
    if (!url) return [platform.environmentKey, ''];

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return [platform.environmentKey, ''];
    }

    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    const validUrl = parsedUrl.protocol === 'https:'
      && platform.hosts.includes(host)
      && !parsedUrl.username
      && !parsedUrl.password;

    return [platform.environmentKey, validUrl ? url : ''];
  }));

  return getFooterSocialLinks(topBarEnvironment).filter(({ url }) => url);
}
