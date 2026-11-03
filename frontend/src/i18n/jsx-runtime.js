import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';
import { translateText } from '../language.js';

const localizedAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'placeholder',
  'title',
]);

export function localizeProps(props) {
  if (!props) return props;

  let localized = props;
  if (typeof props.children === 'string') {
    localized = { ...localized, children: translateText(props.children) };
  } else if (Array.isArray(props.children)) {
    const containsOnlyText = props.children.every((child) => typeof child === 'string' || typeof child === 'number');
    localized = {
      ...localized,
      children: containsOnlyText
        ? translateText(props.children.join(''))
        : props.children.map((child) => typeof child === 'string' ? translateText(child) : child),
    };
  }

  for (const attribute of localizedAttributes) {
    if (typeof props[attribute] === 'string') {
      localized = localized === props ? { ...localized } : localized;
      localized[attribute] = translateText(props[attribute]);
    }
  }

  return localized;
}

export { Fragment };

export function jsx(type, props, key) {
  return reactJsx(type, localizeProps(props), key);
}

export function jsxs(type, props, key) {
  const localized = localizeProps(props);
  return Array.isArray(localized?.children)
    ? reactJsxs(type, localized, key)
    : reactJsx(type, localized, key);
}