export const VIDEO_PROMPT_MAX_CHARS = 3800;
export const RICH_VIDEO_PROMPT_MAX_CHARS = 30000;

const PRIORITY_PATTERNS = [
  /same character/i,
  /same product/i,
  /visual bible/i,
  /character identity/i,
  /product identity/i,
  /active character/i,
  /brand:/i,
  /camera|lens|lighting|shot/i,
  /lip-sync|spoken line/i,
  /negative prompt/i,
  /no black frames/i,
  /continuous/i,
];

export function compactVideoPrompt(prompt: string, maxChars = VIDEO_PROMPT_MAX_CHARS) {
  const normalized = prompt
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const compacted = normalized.join("\n");
  if (compacted.length <= maxChars) return compacted;

  const priority = normalized.filter((line) => PRIORITY_PATTERNS.some((pattern) => pattern.test(line)));
  const regular = normalized.filter((line) => !priority.includes(line));
  const ordered = [...priority, ...regular];
  const selected: string[] = [];

  for (const line of ordered) {
    const candidate = [...selected, line].join("\n");
    if (candidate.length <= maxChars) {
      selected.push(line);
      continue;
    }
    const remaining = maxChars - selected.join("\n").length - 1;
    if (remaining > 120) {
      selected.push(`${line.slice(0, remaining - 3).trim()}...`);
    }
    break;
  }

  const result = selected.join("\n").slice(0, maxChars).trim();
  return result.length >= 3 ? result : compacted.slice(0, maxChars).trim();
}
