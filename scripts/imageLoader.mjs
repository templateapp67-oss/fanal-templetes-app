export async function load(url, context, nextLoad) {
  if (/\.(png|jpe?g|svg|webp|gif|ico|avif)$/i.test(url)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)};`,
    };
  }
  return nextLoad(url, context);
}
