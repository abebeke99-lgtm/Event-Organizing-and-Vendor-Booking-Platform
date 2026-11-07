export const MAX_CHAT_FILE_BYTES = 8 * 1024;
export const MAX_CHAT_PROMPT_LENGTH = 12000;
const ALLOWED_CHAT_FILE_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);
const ALLOWED_CHAT_FILE_EXTENSIONS = /\.(txt|md|markdown|csv|json)$/i;

export function isSupportedChatTextFile(file) {
  return Boolean(file
    && file.size <= MAX_CHAT_FILE_BYTES
    && (file.type === '' || ALLOWED_CHAT_FILE_TYPES.has(file.type))
    && (ALLOWED_CHAT_FILE_TYPES.has(file.type) || ALLOWED_CHAT_FILE_EXTENSIONS.test(file.name || '')));
}

export function buildChatMessageContent(text, attachment) {
  const message = String(text || '').trim();
  if (!attachment) return message;
  const fileText = String(attachment.text || '').trim();
  return `${message}${message ? '\n\n' : ''}[Attached text file: ${attachment.name}]\n${fileText}`.trim();
}

export function parseSseEvent(eventText) {
  const event = eventText.match(/^event:\s*(.+)$/m)?.[1]?.trim();
  const data = eventText.match(/^data:\s*(.+)$/m)?.[1];
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    throw new Error('The AI response could not be read.');
  }
}
