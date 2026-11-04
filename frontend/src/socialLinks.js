const socialPlatforms = [
  { id: 'telegram', labelKey: 'telegram', environmentKey: 'VITE_TELEGRAM_URL', hosts: ['t.me'] },
  { id: 'youtube', labelKey: 'youtube', environmentKey: 'VITE_YOUTUBE_URL', hosts: ['youtube.com'] },
  { id: 'facebook', labelKey: 'facebook', environmentKey: 'VITE_FACEBOOK_URL', hosts: ['facebook.com'] },
  { id: 'linkedin', labelKey: 'linkedin', environmentKey: 'VITE_LINKEDIN_URL', hosts: ['linkedin.com'] },
];

const viteEnvironment = typeof import.meta.env === 'undefined' ? {} : {
  VITE_TELEGRAM_URL: import.meta.env.VITE_TELEGRAM_URL,
  VITE_YOUTUBE_URL: import.meta.env.VITE_YOUTUBE_URL,
  VITE_FACEBOOK_URL: import.meta.env.VITE_FACEBOOK_URL,
  VITE_LINKEDIN_URL: import.meta.env.VITE_LINKEDIN_URL,
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

export function getTopBarSocialLinks(environment = viteEnvironment) {
  const topBarEnvironment = Object.fromEntries(socialPlatforms.map((platform) => {
    const url = environment[platform.environmentKey]?.trim();
    if (!url) return [platform.environmentKey, ''];

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return [platform.environmentKey, ''];
    }

    const validUrl = parsedUrl.protocol === 'https:'
      && platform.hosts.includes(parsedUrl.hostname.toLowerCase())
      && !parsedUrl.username
      && !parsedUrl.password;

    return [platform.environmentKey, validUrl ? url : ''];
  }));

  return getFooterSocialLinks(topBarEnvironment).filter(({ url }) => url);
}
