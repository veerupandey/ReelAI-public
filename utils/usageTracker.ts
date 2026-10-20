interface UsageRecord {
    operation: string;
    inputTokens: number;
    outputTokens: number;
    imageCount: number;
    ttsCharacters: number;
    timestamp: number;
}

interface UsageStats {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalImages: number;
    totalTTSCharacters: number;
    totalCost: number;
    records: UsageRecord[];
    sessionStart: number;
}

// Pricing constants (Gemini Flash-class, 2026 — estimates for UI only)
const PRICING = {
    inputTokenPer1M: 0.15,
    outputTokenPer1M: 0.60,
    /** Cached input tokens are billed at a steep discount (implicit KV-cache hits). */
    cachedInputTokenPer1M: 0.0375,
    imageGeneration: 0.04,
    ttsInputPer1M: 0.50,
    ttsOutputPer1M: 10.00,
};

const STORAGE_KEY = 'reelai_usage_stats';

class UsageTracker {
    private stats: UsageStats;

    constructor() {
        this.stats = this.loadFromStorage() || this.createEmptyStats();
    }

    private ensureNumber(value: any, fallback = 0): number {
        return typeof value === 'number' && !isNaN(value) ? value : fallback;
    }

    private normalizeRecord(record: any): UsageRecord {
        return {
            operation: typeof record?.operation === 'string' ? record.operation : 'Unknown Operation',
            inputTokens: this.ensureNumber(record?.inputTokens),
            outputTokens: this.ensureNumber(record?.outputTokens),
            imageCount: this.ensureNumber(record?.imageCount),
            ttsCharacters: this.ensureNumber(record?.ttsCharacters),
            timestamp: typeof record?.timestamp === 'number' ? record.timestamp : Date.now()
        };
    }

    private normalizeStats(raw: any): UsageStats {
        const base = this.createEmptyStats();
        const records = Array.isArray(raw?.records)
            ? raw.records.map((record: any) => this.normalizeRecord(record)).slice(-100)
            : base.records;

        return {
            totalInputTokens: this.ensureNumber(raw?.totalInputTokens, base.totalInputTokens),
            totalOutputTokens: this.ensureNumber(raw?.totalOutputTokens, base.totalOutputTokens),
            totalImages: this.ensureNumber(raw?.totalImages, base.totalImages),
            totalTTSCharacters: this.ensureNumber(raw?.totalTTSCharacters, base.totalTTSCharacters),
            totalCost: this.ensureNumber(raw?.totalCost, base.totalCost),
            records,
            sessionStart: typeof raw?.sessionStart === 'number' ? raw.sessionStart : base.sessionStart
        };
    }

    private createEmptyStats(): UsageStats {
        return {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalImages: 0,
            totalTTSCharacters: 0,
            totalCost: 0,
            records: [],
            sessionStart: Date.now()
        };
    }

    private loadFromStorage(): UsageStats | null {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? this.normalizeStats(JSON.parse(stored)) : null;
        } catch (e) {
            console.error('Failed to load usage stats from localStorage', e);
            return null;
        }
    }

    private save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
        } catch (e) {
            console.error('Failed to save usage stats to localStorage', e);
        }
    }

    trackTokens(operation: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
        // Update totals
        this.stats.totalInputTokens += inputTokens;
        this.stats.totalOutputTokens += outputTokens;

        // Cached prefix tokens (Gemini implicit KV-cache) are much cheaper.
        const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
        const uncachedInput = Math.max(0, inputTokens - cached);
        const inputCost =
            (uncachedInput / 1_000_000) * PRICING.inputTokenPer1M +
            (cached / 1_000_000) * PRICING.cachedInputTokenPer1M;
        const outputCost = (outputTokens / 1_000_000) * PRICING.outputTokenPer1M;
        this.stats.totalCost += inputCost + outputCost;

        // Add record
        this.stats.records.push({
            operation,
            inputTokens,
            outputTokens,
            imageCount: 0,
            ttsCharacters: 0,
            timestamp: Date.now()
        });

        // Keep only last 100 records
        if (this.stats.records.length > 100) {
            this.stats.records = this.stats.records.slice(-100);
        }

        this.save();
    }

    trackImage(operation: string) {
        // Update totals
        this.stats.totalImages += 1;
        this.stats.totalCost += PRICING.imageGeneration;

        // Add record
        this.stats.records.push({
            operation,
            inputTokens: 0,
            outputTokens: 0,
            imageCount: 1,
            ttsCharacters: 0,
            timestamp: Date.now()
        });

        // Keep only last 100 records
        if (this.stats.records.length > 100) {
            this.stats.records = this.stats.records.slice(-100);
        }

        this.save();
    }

    trackTTS(operation: string, textLength: number) {
        // TTS pricing is per character (approx 1 char = 1 token)
        this.stats.totalTTSCharacters += textLength;

        // Calculate cost (input + output audio)
        const inputCost = (textLength / 1_000_000) * PRICING.ttsInputPer1M;
        const outputCost = (textLength / 1_000_000) * PRICING.ttsOutputPer1M;
        this.stats.totalCost += inputCost + outputCost;

        // Add record
        this.stats.records.push({
            operation,
            inputTokens: 0,
            outputTokens: 0,
            imageCount: 0,
            ttsCharacters: textLength,
            timestamp: Date.now()
        });

        // Keep only last 100 records
        if (this.stats.records.length > 100) {
            this.stats.records = this.stats.records.slice(-100);
        }

        this.save();
    }

    getStats(): UsageStats {
        return { ...this.stats };
    }

    getSessionDuration(): number {
        return Date.now() - this.stats.sessionStart;
    }

    reset() {
        this.stats = this.createEmptyStats();
        this.save();
    }

    // Calculate breakdown
    getCostBreakdown() {
        const inputCost = (this.stats.totalInputTokens / 1_000_000) * PRICING.inputTokenPer1M;
        const outputCost = (this.stats.totalOutputTokens / 1_000_000) * PRICING.outputTokenPer1M;
        const imageCost = this.stats.totalImages * PRICING.imageGeneration;
        const ttsInputCost = (this.stats.totalTTSCharacters / 1_000_000) * PRICING.ttsInputPer1M;
        const ttsOutputCost = (this.stats.totalTTSCharacters / 1_000_000) * PRICING.ttsOutputPer1M;
        const ttsCost = ttsInputCost + ttsOutputCost;

        return {
            inputCost,
            outputCost,
            imageCost,
            ttsCost,
            totalCost: inputCost + outputCost + imageCost + ttsCost
        };
    }
}

// Singleton instance
export const usageTracker = new UsageTracker();
export type { UsageStats, UsageRecord };
