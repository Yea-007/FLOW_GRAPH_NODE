/** Markdown encodes Unicode and spaces in image URLs; native filesystem reads need decoded paths. */
export function resolveImagePath(src: string, notesDir?: string): string {
  if (!src || /^(https?:|data:)/i.test(src)) return src;
  let local = src;
  if (/^file:/i.test(local)) {
    try { const url = new URL(local); local = url.host ? `//${url.host}${url.pathname}` : url.pathname.replace(/^\/([A-Za-z]:)/, "$1"); }
    catch { return ""; }
  }
  try { local = decodeURIComponent(local); } catch { /* A literal or malformed percent must not crash preview. */ }
  local = local.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(local) || local.startsWith("/")) return local;
  return notesDir ? notesDir.replace(/\\/g, "/").replace(/\/$/, "") + "/" + local : local;
}
