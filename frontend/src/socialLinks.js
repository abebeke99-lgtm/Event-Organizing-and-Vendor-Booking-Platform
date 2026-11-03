const socialPlatforms = [
  { id: 'telegram', labelKey: 'telegram', environmentKey: 'VITE_EVENTHUB_TELEGRAM_URL', hosts: ['t.me', 'telegram.me'] },
  { id: 'youtube', labelKey: 'youtube', environmentKey: 'VITE_EVENTHUB_YOUTUBE_URL', hosts: ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'] },
  { id: 'facebook', labelKey: 'facebook', environmentKey: 'VITE_EVENTHUB_FACEBOOK_URL', hosts: ['facebook.com', 'www.facebook.com'] },
  { id: 'linkedin', labelKey: 'linkedin', environmentKey: 'VITE_EVENTHUB_LINKEDIN_URL', hosts: ['linkedin.com', 'www.linkedin.com'] },
];

export function getFooterSocialLinks(environment = import.meta.env ?? {}) {
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
