import React from 'react';
import { CalendarCheck, HeartHandshake, LifeBuoy, ShieldCheck } from 'lucide-react';
import { translate, useLanguage } from './language.js';

const items = [
  { key: 'publicHomeTrustBooking', Icon: CalendarCheck },
  { key: 'publicHomeTrustVendors', Icon: ShieldCheck, statistic: 'activeVendorCount' },
  { key: 'publicHomeTrustSupport', Icon: LifeBuoy },
  { key: 'publicHomeTrustExperience', Icon: HeartHandshake },
];

export default function HomepageTrustStrip({ summary }) {
  const language = useLanguage();
  return <div className="homepage-trust-block">
    <div className="section-header compact-header homepage-trust-block-heading">
      <div>
        <p className="eyebrow">{translate('publicHomeTrustHeading', language)}</p>
        <h2>{translate('publicHomeWhyChoose', language)}</h2>
      </div>
    </div>
    <section className="homepage-trust-strip" aria-label={translate('publicHomeWhyChoose', language)}>
      {items.map(({ key, Icon, statistic }) => {
        const rawValue = statistic ? summary?.[statistic] : null;
        const value = rawValue !== null && rawValue !== undefined && rawValue !== '' && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null;
        return <div className="homepage-trust-item" key={key}>
          <span className="homepage-trust-icon"><Icon size={18} aria-hidden="true"/></span>
          <span>{translate(key, language)}</span>
          {value !== null && <strong>{value.toLocaleString(language === 'am' ? 'am-ET' : 'en-US')}</strong>}
        </div>;
      })}
    </section>
  </div>;
}
