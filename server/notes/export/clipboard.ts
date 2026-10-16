/**
 * Clipboard export: Word-safe CRLF plain text. The browser copies this
 * verbatim; Word and Epic's note editor both accept it without
 * auto-formatting (escaped dashes, no markdown, straight quotes).
 */
export function toClipboardText(noteText: string): string {
  return noteText.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}
