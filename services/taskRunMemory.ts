/**
 * In-run task memory — remembers user feedback and agent actions for THIS run only.
 * Injected into feedback interpretation so later gates still honor earlier asks
 * (e.g. "use live motion" at plan → still true at deliver redo).
 */

export type TaskMemoryKind =
  | 'brief'
  | 'user_feedback'
  | 'agent_action'
  | 'decision'
  | 'note';

export interface TaskMemoryEntry {
  id: string;
  ts: number;
  phase: string;
  kind: TaskMemoryKind;
  text: string;
  /** Optional structured tags for quick recall */
  tags?: string[];
}

export class TaskRunMemory {
  private entries: TaskMemoryEntry[] = [];
  private seq = 0;

  /** Standing preferences inferred during the run (survive until overridden). */
  preferences: {
    preferLiveMotion?: boolean;
    voice?: string;
    vibe?: string;
    keepVoiceoverUnlessAsked?: boolean;
  } = {
    keepVoiceoverUnlessAsked: true,
  };

  clear(): void {
    this.entries = [];
    this.seq = 0;
    this.preferences = { keepVoiceoverUnlessAsked: true };
  }

  remember(phase: string, kind: TaskMemoryKind, text: string, tags?: string[]): TaskMemoryEntry {
    const entry: TaskMemoryEntry = {
      id: `tm_${++this.seq}`,
      ts: Date.now(),
      phase,
      kind,
      text: (text || '').trim().slice(0, 500),
      tags,
    };
    if (!entry.text) return entry;
    this.entries.push(entry);
    // Cap to keep prompts small
    if (this.entries.length > 40) {
      this.entries = this.entries.slice(-40);
    }
    this.applyPreferenceHints(entry);
    return entry;
  }

  rememberFeedback(phase: string, feedback: string): void {
    const f = (feedback || '').trim();
    if (!f) return;
    this.remember(phase, 'user_feedback', f, ['feedback']);
  }

  rememberAction(phase: string, action: string, tags?: string[]): void {
    this.remember(phase, 'agent_action', action, tags);
  }

  rememberDecision(phase: string, decision: string, tags?: string[]): void {
    this.remember(phase, 'decision', decision, tags);
  }

  private applyPreferenceHints(entry: TaskMemoryEntry): void {
    const t = entry.text.toLowerCase();
    if (/\b(live\s*motion|wan\s*i2v|animate (?:the )?(?:scenes?|stills?))\b/.test(t)
      && !/\b(no live|ken\s*burns|still only|disable live)\b/.test(t)) {
      this.preferences.preferLiveMotion = true;
    }
    if (/\b(ken\s*burns|still only|no live(?:\s*motion)?|disable live)\b/.test(t)) {
      this.preferences.preferLiveMotion = false;
    }
    if (/\b(keep\s*(the\s*)?(vo|voiceover|audio)|video is fine|audio is fine)\b/.test(t)) {
      this.preferences.keepVoiceoverUnlessAsked = true;
    }
    const voiceMatch = t.match(/\b(?:voice|tts)\s*(?:to|=|:)?\s*([a-z]{3,20})\b/i);
    if (voiceMatch?.[1] && !/over|audio|change|regen/.test(voiceMatch[1])) {
      this.preferences.voice = voiceMatch[1].replace(/^\w/, (c) => c.toUpperCase());
    }
    if (/\bgen\s*z\b|\bhyper\b|\bhype\b/.test(t)) {
      this.preferences.vibe = 'gen_z_bright';
    }
    if (/\bcalm\b|\bpremium\b|\bluxury\b|\basmr\b/.test(t)) {
      this.preferences.vibe = 'premium_calm';
    }
  }

  /** Compact block for LLM prompts (feedback interpretation, director, planning). */
  formatForPrompt(maxEntries = 16): string {
    if (this.entries.length === 0 && !this.preferences.preferLiveMotion && !this.preferences.voice) {
      return '';
    }
    const recent = this.entries.slice(-maxEntries);
    const prefLines: string[] = [];
    if (this.preferences.preferLiveMotion === true) {
      prefLines.push('- Standing preference: USE Live Motion (Wan I2V) unless user cancels it');
    } else if (this.preferences.preferLiveMotion === false) {
      prefLines.push('- Standing preference: Ken Burns stills (no Live Motion)');
    }
    if (this.preferences.voice) {
      prefLines.push(`- Standing preference: voice = ${this.preferences.voice}`);
    }
    if (this.preferences.vibe) {
      prefLines.push(`- Standing preference: vibe = ${this.preferences.vibe}`);
    }
    if (this.preferences.keepVoiceoverUnlessAsked) {
      prefLines.push('- Standing preference: keep existing VO unless user asks to change audio/script/voice');
    }

    const history = recent.map((e, i) => {
      const label = e.kind === 'user_feedback' ? 'USER'
        : e.kind === 'agent_action' ? 'DID'
          : e.kind === 'decision' ? 'DECIDE'
            : e.kind === 'brief' ? 'BRIEF'
              : 'NOTE';
      return `${i + 1}. [${label}/${e.phase}] ${e.text}`;
    }).join('\n');

    return [
      'TASK MEMORY (this run only — honor earlier user asks; do not forget them):',
      prefLines.length ? `Preferences:\n${prefLines.join('\n')}` : '',
      history ? `History:\n${history}` : '',
    ].filter(Boolean).join('\n\n');
  }

  /** Markdown card for the Agent Console. */
  formatMarkdown(): string {
    const body = this.formatForPrompt(20) || '_No task notes yet._';
    return `## Task memory\n\n${body}`;
  }

  toJSON(): { preferences: TaskRunMemory['preferences']; entries: TaskMemoryEntry[] } {
    return { preferences: { ...this.preferences }, entries: [...this.entries] };
  }
}
