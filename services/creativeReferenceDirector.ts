import { GoogleGenAI } from '@google/genai';

export type CreativeReferenceRole =
  | 'product_identity'
  | 'brand_identity'
  | 'style_reference'
  | 'composition_reference'
  | 'lifestyle_reference'
  | 'avoid_reference';

export interface CreativeReference {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
  previewUrl?: string;
  note: string;
  role: CreativeReferenceRole;
  description: string;
  preserve: string[];
  avoid: string[];
  confidence: number;
}

export interface CreativeReferenceUpload {
  id: string;
  name: string;
  base64: string;
  mimeType: string;
  previewUrl?: string;
  note: string;
}

export interface ReferenceSceneInput {
  index: number;
  role: string;
  imagePrompt: string;
  useProductAsReference: boolean;
  visualMode?: SceneVisualMode;
}

export type SceneVisualMode = 'product_locked' | 'product_composite' | 'generated_fresh';

export const resolveSceneVisualMode = (scene: ReferenceSceneInput): SceneVisualMode => {
  if (scene.visualMode) return scene.visualMode;
  if (!scene.useProductAsReference) return 'generated_fresh';
  return /\b(hero|packshot|product[- ]only|exact product|packaging|cta)\b/i.test(`${scene.role} ${scene.imagePrompt}`)
    ? 'product_locked'
    : 'product_composite';
};

export interface SceneReferenceAssignment {
  sceneIndex: number;
  references: CreativeReference[];
  avoidConstraints: string[];
  rationale: string;
}

export const classifyCreativeReferenceFallback = (name: string, note = ''): Pick<CreativeReference, 'role' | 'description' | 'preserve' | 'avoid' | 'confidence'> => {
  const text = `${name} ${note}`.toLowerCase();
  if (/\b(avoid|don't|do not|dislike|not this|bad example)\b/.test(text)) {
    return { role: 'avoid_reference', description: note || name, preserve: [], avoid: [note || name], confidence: .95 };
  }
  if (/\b(product|packaging|label|bottle|box|tin|jar)\b/.test(text)) {
    return { role: 'product_identity', description: note || name, preserve: ['exact product identity', 'packaging', 'label'], avoid: [], confidence: .8 };
  }
  if (/\b(composition|layout|angle|framing|overhead|camera|shot)\b/.test(text)) {
    return { role: 'composition_reference', description: note || name, preserve: ['composition', 'camera angle'], avoid: [], confidence: .8 };
  }
  if (/\b(person|creator|customer|lifestyle|ritual|usage|use case)\b/.test(text)) {
    return { role: 'lifestyle_reference', description: note || name, preserve: ['lifestyle context'], avoid: [], confidence: .75 };
  }
  if (/\b(logo|typography|brand|palette|colors?)\b/.test(text)) {
    return { role: 'brand_identity', description: note || name, preserve: ['brand visual language'], avoid: [], confidence: .75 };
  }
  return { role: 'style_reference', description: note || name, preserve: ['lighting', 'mood', 'texture'], avoid: [], confidence: .6 };
};

export const analyzeCreativeReferences = async (uploads: CreativeReferenceUpload[]): Promise<CreativeReference[]> => {
  if (!uploads.length) return [];
  const apiKey = import.meta.env.VITE_API_KEY || '';
  if (!apiKey) return uploads.map((upload) => ({ ...upload, ...classifyCreativeReferenceFallback(upload.name, upload.note) }));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [];
    uploads.forEach((upload, index) => {
      parts.push({ text: `IMAGE ${index + 1}: filename=${upload.name}; user note=${upload.note || 'none'}` });
      parts.push({ inlineData: { mimeType: upload.mimeType, data: upload.base64 } });
    });
    parts.push({ text: `Analyze each image as creative direction for an advertising agent. Return ONLY a JSON array in image order with: role (product_identity, brand_identity, style_reference, composition_reference, lifestyle_reference, avoid_reference), description, preserve (string array), avoid (string array), confidence (0-1). Product identity means exact packaging; avoid_reference means a direction not to follow.` });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ parts }],
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(response.text || '[]');
    return uploads.map((upload, index) => ({
      ...upload,
      ...classifyCreativeReferenceFallback(upload.name, upload.note),
      ...(parsed[index] || {}),
    }));
  } catch {
    return uploads.map((upload) => ({ ...upload, ...classifyCreativeReferenceFallback(upload.name, upload.note) }));
  }
};

const ROLE_SCORE: Record<string, Partial<Record<CreativeReferenceRole, number>>> = {
  hook: { product_identity: 10, composition_reference: 8, style_reference: 7, brand_identity: 6 },
  ritual: { lifestyle_reference: 10, composition_reference: 9, style_reference: 7, brand_identity: 5 },
  ingredients: { product_identity: 10, composition_reference: 9, style_reference: 7 },
  result: { lifestyle_reference: 10, style_reference: 9, composition_reference: 7 },
  cta: { product_identity: 10, brand_identity: 9, style_reference: 7, composition_reference: 6 },
};

export const assignCreativeReferences = (
  scenes: ReferenceSceneInput[],
  references: CreativeReference[],
): SceneReferenceAssignment[] => {
  const avoidConstraints = references.filter((reference) => reference.role === 'avoid_reference').flatMap((reference) => reference.avoid.length ? reference.avoid : [reference.description]);
  const usable = references.filter((reference) => reference.role !== 'avoid_reference');

  return scenes.map((scene) => {
    const visualMode = resolveSceneVisualMode(scene);
    const sceneText = `${scene.role} ${scene.imagePrompt}`.toLowerCase();
    const eligible = usable.filter((reference) =>
      visualMode !== 'generated_fresh' || reference.role !== 'product_identity'
    );
    const selected = eligible
      .map((reference, order) => {
        const roleScore = ROLE_SCORE[scene.role]?.[reference.role] || 0;
        const noteWords = reference.description.toLowerCase().split(/\W+/).filter((word) => word.length > 4);
        const textScore = noteWords.filter((word) => sceneText.includes(word)).length * 3;
        return { reference, score: roleScore + textScore + reference.confidence, order };
      })
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 2)
      .map(({ reference }) => reference);

    return {
      sceneIndex: scene.index,
      references: selected,
      avoidConstraints,
      rationale: selected.length
        ? selected.map((reference) => `${reference.name}: ${reference.description}`).join(' | ')
        : 'No uploaded reference strongly matched this scene.',
    };
  });
};
