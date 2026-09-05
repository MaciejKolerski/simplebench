export function* inputChunks(text: string, size = 16_384): Generator<string> {
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + size, text.length);
    // JSON strings cannot contain the unpaired surrogate from a split emoji.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    if (end === offset) end = Math.min(offset + 2, text.length);
    yield text.slice(offset, end);
    offset = end;
  }
}
