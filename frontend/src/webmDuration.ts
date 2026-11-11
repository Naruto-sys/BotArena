interface Element { id: number; start: number; body: number; end: number }

function element(bytes: Uint8Array, start: number): Element | undefined {
  let idLength = 1;
  while (idLength <= 4 && !(bytes[start] & (0x80 >> (idLength - 1)))) idLength++;
  if (idLength > 4 || start + idLength >= bytes.length) return;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[start + i];
  const sizeAt = start + idLength;
  let length = 1;
  while (length <= 8 && !(bytes[sizeAt] & (0x80 >> (length - 1)))) length++;
  if (length > 8 || sizeAt + length > bytes.length) return;
  const mask = 0xff >> length;
  let size = bytes[sizeAt] & mask;
  let unknown = size === mask;
  for (let i = 1; i < length; i++) {
    size = size * 256 + bytes[sizeAt + i];
    unknown = unknown && bytes[sizeAt + i] === 255;
  }
  const body = sizeAt + length;
  return { id, start, body, end: unknown ? bytes.length : body + size };
}

/** Native WebM recorders often omit Duration. Reuse optional WritingApp space
 * rather than inserting bytes, preserving all existing cluster/index offsets. */
export async function withWebMDuration(blob: Blob, milliseconds: number): Promise<Blob> {
  if (!blob.type.includes('webm') || !(milliseconds > 0)) return blob;
  const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  let segment: Element | undefined;
  for (let at = 0; at < bytes.length;) {
    const item = element(bytes, at);
    if (!item || item.end <= at) return blob;
    if (item.id === 0x18538067) { segment = item; break; }
    at = item.end;
  }
  if (!segment) return blob;
  let info: Element | undefined;
  for (let at = segment.body; at < Math.min(segment.end, bytes.length);) {
    const item = element(bytes, at);
    if (!item || item.end <= at) return blob;
    if (item.id === 0x1549a966) { info = item; break; }
    at = item.end;
  }
  if (!info || info.end > bytes.length) return blob;
  let scale = 1_000_000;
  let duration: Element | undefined;
  let writingApp: Element | undefined;
  for (let at = info.body; at < info.end;) {
    const item = element(bytes, at);
    if (!item || item.end > info.end || item.end <= at) return blob;
    if (item.id === 0x4489) duration = item;
    if (item.id === 0x5741) writingApp = item;
    if (item.id === 0x2ad7b1) {
      scale = 0;
      for (let i = item.body; i < item.end; i++) scale = scale * 256 + bytes[i];
    }
    at = item.end;
  }
  if (!(scale > 0)) return blob;
  const value = milliseconds * 1_000_000 / scale;
  const view = new DataView(bytes.buffer);
  if (duration) {
    const size = duration.end - duration.body;
    if (size === 8) view.setFloat64(duration.body, value, false);
    else if (size === 4) view.setFloat32(duration.body, value, false);
    else return blob;
  } else {
    if (!writingApp) return blob;
    const size = writingApp.end - writingApp.start;
    const payload = size >= 11 && size !== 12 ? 8 : 4;
    const remaining = size - payload - 3;
    if (remaining < 0 || remaining === 1) return blob;
    let at = writingApp.start;
    bytes.set([0x44, 0x89, 0x80 | payload], at);
    if (payload === 8) view.setFloat64(at + 3, value, false);
    else view.setFloat32(at + 3, value, false);
    at += payload + 3;
    while (at < writingApp.end) {
      let count = Math.min(128, writingApp.end - at);
      if (writingApp.end - at - count === 1) count--;
      bytes[at] = 0xec; bytes[at + 1] = 0x80 | (count - 2);
      bytes.fill(0, at + 2, at + count); at += count;
    }
  }
  return new Blob([bytes, blob.slice(bytes.length)], { type: blob.type });
}
