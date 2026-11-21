const socialPlatforms = [
  { id: 'facebook', labelKey: 'facebook', environmentKey: 'VITE_FACEBOOK_URL', hosts: ['facebook.com'] },
  { id: 'x', labelKey: 'xSocial', environmentKey: 'VITE_X_URL', hosts: ['x.com', 'twitter.com'] },
  { id: 'youtube', labelKey: 'youtube', environmentKey: 'VITE_YOUTUBE_URL', hosts: ['youtube.com'] },
  { id: 'linkedin', labelKey: 'linkedin', environmentKey: 'VITE_LINKEDIN_URL', hosts: ['linkedin.com'] },
  { id: 'instagram', labelKey: 'instagram', environmentKey: 'VITE_INSTAGRAM_URL', hosts: ['instagram.com'] },
  { id: 'telegram', labelKey: 'telegram', environmentKey: 'VITE_TELEGRAM_URL', hosts: ['t.me'] },
  { id: 'whatsapp', labelKey: 'whatsapp', environmentKey: 'VITE_WHATSAPP_URL', hosts: ['wa.me', 'whatsapp.com'] },
];

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : {
  VITE_FACEBOOK_URL: import.meta.env.VITE_FACEBOOK_URL,
  VITE_X_URL: import.meta.env.VITE_X_URL,
  VITE_YOUTUBE_URL: import.meta.env.VITE_YOUTUBE_URL,
  VITE_LINKEDIN_URL: import.meta.env.VITE_LINKEDIN_URL,
  VITE_INSTAGRAM_URL: import.meta.env.VITE_INSTAGRAM_URL,
  VITE_TELEGRAM_URL: import.meta.env.VITE_TELEGRAM_URL,
  VITE_WHATSAPP_URL: import.meta.env.VITE_WHATSAPP_URL,
};

const topBarPlatformIds = ['telegram', 'facebook', 'youtube', 'linkedin', 'whatsapp'];
const topBarFallbackUrls = {
  telegram: 'https://telegram.org',
  facebook: 'https://www.facebook.com',
  youtube: 'https://www.youtube.com',
  linkedin: 'https://www.linkedin.com',
  whatsapp: 'https://wa.me/251986481821',
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
      || candidate.id === 'whatsapp' && label === 'whatsapp'
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
  const configured = new Map();

  if (Array.isArray(settings) && settings.length > 0) {
    for (const social of getSettingsSocialLinks(settings)) {
      if (topBarPlatformIds.includes(social.id)) configured.set(social.id, social);
    }
  }

  const topBarEnvironment = Object.fromEntries(socialPlatforms.map((platform) => {
    const url = environment[platform.environmentKey]?.trim();
    if (!url) return [platform.environmentKey, ''];
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const validUrl = parsedUrl.protocol === 'https:'
        && platform.hosts.includes(host)
        && !parsedUrl.username
        && !parsedUrl.password;
      return [platform.environmentKey, validUrl ? url : ''];
    } catch {
      return [platform.environmentKey, ''];
    }
  }));

  for (const social of getFooterSocialLinks(topBarEnvironment).filter(({ url }) => url)) {
    if (topBarPlatformIds.includes(social.id)) configured.set(social.id, social);
  }

  return topBarPlatformIds.map((id) => {
    const platform = socialPlatforms.find((entry) => entry.id === id);
    return configured.get(id) || {
      id,
      labelKey: platform.labelKey,
      url: topBarFallbackUrls[id],
    };
  });
}
