// Client-side persona discovery over VIBE.md content: markdown heading
// sections become persona candidates (heading → name, section body → prompt).
// Sections whose heading or body mention persona-ish vocabulary are ranked
// "likely"; everything else is still offered, just unranked — the user picks.

export interface PersonaCandidate {
  name: string;
  prompt: string;
  likely: boolean;
}

const PERSONA_HINTS = /\b(persona|personality|voice|tone|character|identity|role|style|assistant)\b/i;

/**
 * Split markdown into `##`/`###` heading sections. The preamble before the
 * first heading is offered as a "VIBE preamble" candidate when non-trivial —
 * many VIBE.md files are one continuous personality block with no headings.
 */
export function discoverPersonaCandidates(markdown: string): PersonaCandidate[] {
  const text = markdown.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const sections: Array<{ name: string; body: string[] }> = [];
  let current: { name: string; body: string[] } = { name: "", body: [] };

  for (const line of lines) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      sections.push(current);
      current = { name: heading[1], body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  const candidates: PersonaCandidate[] = [];
  const seenNames = new Map<string, number>();
  for (const section of sections) {
    const body = section.body.join("\n").trim();
    if (!body) continue;
    // Skip trivially short bodies — a one-liner is not a persona prompt.
    if (body.length < 40) continue;
    let name = section.name || "VIBE preamble";
    // Duplicate headings get a numeric suffix so names (used as keys and
    // persona names) stay unique.
    const seen = seenNames.get(name.toLowerCase()) ?? 0;
    seenNames.set(name.toLowerCase(), seen + 1);
    if (seen > 0) name = `${name} (${seen + 1})`;
    candidates.push({
      name,
      prompt: body,
      likely: PERSONA_HINTS.test(section.name) || PERSONA_HINTS.test(body.slice(0, 400)),
    });
  }

  // Likely candidates first, original order otherwise (stable sort).
  return candidates.sort((a, b) => Number(b.likely) - Number(a.likely));
}
