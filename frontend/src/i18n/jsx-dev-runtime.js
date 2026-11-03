import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';
import { localizeProps } from './jsx-runtime.js';

export { Fragment };

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  const localized = localizeProps(props);
  return reactJsxDEV(type, localized, key, isStaticChildren && Array.isArray(localized?.children), source, self);
}