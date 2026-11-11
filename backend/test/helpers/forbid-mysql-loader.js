export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'mysql2/promise' || specifier.startsWith('mysql2/')) {
    throw new Error('MySQL driver import attempted in PostgreSQL mode.');
  }
  return nextResolve(specifier, context);
}
