/// <reference types="vite/client" />

declare namespace NodeJS {
    interface ProcessEnv {
        GEMINI_API_KEY?: string;
        VITE_API_KEY?: string;
        GEMINI_IMAGE_MODEL?: string;
        VITE_GEMINI_IMAGE_MODEL?: string;
        SILICONFLOW_API_KEY?: string;
        SILICONFLOW_BASE_URL?: string;
        ZAI_API_KEY?: string;
        ZAI_BASE_URL?: string;
        OPENAI_API_KEY?: string;
        OPENAI_BASE_URL?: string;
        GOOGLE_TTS_SERVICE_ACCOUNT_JSON?: string;
    }
}

interface ImportMetaEnv {
    readonly VITE_API_KEY?: string;
    readonly GEMINI_API_KEY?: string;
    readonly VITE_GEMINI_IMAGE_MODEL?: string;
    readonly GEMINI_IMAGE_MODEL?: string;
    readonly VITE_GOOGLE_TTS_ENABLED?: string;
    readonly VITE_GOOGLE_TTS_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
