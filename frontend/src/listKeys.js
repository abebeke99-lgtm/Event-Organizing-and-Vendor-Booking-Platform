export function withStableKeys(items, getIdentity) {
  const occurrences = new Map();
  return items.map((item) => {
    const identity = String(getIdentity(item));
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return { item, key: `${identity}:${occurrence}` };
  });
}
