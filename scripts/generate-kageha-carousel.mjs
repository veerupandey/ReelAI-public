import { GoogleGenAI } from '@google/genai';
import { loadEnv } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const env = loadEnv('development', process.cwd(), 'VITE_');
const apiKey = env.VITE_API_KEY || env.VITE_GEMINI_API_KEY;
if (!apiKey) throw new Error('Missing VITE_API_KEY in .env.local');

const ai = new GoogleGenAI({ apiKey });
const productImageUrl = 'https://cdn.shopify.com/s/files/1/1003/2994/7458/files/signature-steaming-bowl_b47817ee-f3d5-4a22-b7f3-c0a13d70bad7.jpg?v=1779337149';
const productResponse = await fetch(productImageUrl);
if (!productResponse.ok) throw new Error(`Product image download failed: ${productResponse.status}`);
const productMimeType = productResponse.headers.get('content-type') || 'image/jpeg';
const productBase64 = Buffer.from(await productResponse.arrayBuffer()).toString('base64');

const slides = [
  {
    headline: 'Matcha or Coffee?',
    body: 'Two caffeinated rituals. Two very different experiences.',
    productLocked: true,
    prompt: 'Premium editorial split-screen morning choice. On the left, preserve the exact supplied Kageha Signature Ceremonial matcha tin and finished vivid green matcha bowl. On the right, a simple black coffee in a refined ceramic cup. Quiet Japanese luxury art direction, walnut surface, soft morning window light, balanced comparison composition, generous lower-third negative space, no generated text, no fake logos.',
  },
  {
    headline: 'Know Your Cup',
    body: 'About 70 mg caffeine per 2 g; coffee varies by brew.',
    productLocked: true,
    prompt: 'Evidence-led premium still life showing the exact supplied Kageha tin beside a precise two-gram serving of vivid green matcha, bamboo scoop and a restrained black coffee cup in the background. Sophisticated visual comparison without numbers or generated typography, museum-like composition, soft directional lighting, tactile walnut and ceramic, lower-third text-safe space, square social carousel image.',
  },
  {
    headline: 'Sift. Whisk. Sip.',
    body: 'A two-minute preparation ritual, not a push-button pour.',
    productLocked: false,
    prompt: 'Overhead Japanese tea ritual in progress: fine vivid matcha falling through a small sifter into a handcrafted chawan, bamboo chasen beside it, human hands entering naturally. Contrast the deliberate ritual with a softly defocused coffee machine far in the background. Cinematic natural light, sensory powder texture, calm premium editorial photography, no product package, no text, square composition with lower-third negative space.',
  },
  {
    headline: 'Choose The Experience',
    body: 'Smooth, vivid and clean-finishing, with no bitterness.',
    productLocked: false,
    prompt: 'Extreme sensory macro of vivid green matcha foam in a ceramic bowl, soft micro-bubbles and a bamboo whisk lifting away, contrasted subtly with deep roasted coffee tones at the edge of frame. Communicate smoothness, vivid color and a clean finish only through texture and color. Premium Japanese editorial style, elegant shadow, no packaging, no text, square carousel composition with text-safe lower third.',
  },
  {
    headline: 'Try The Slow Bowl',
    body: 'Discover Signature Ceremonial from Uji, Japan.',
    productLocked: true,
    prompt: 'Final shoppable hero image preserving the exact supplied Kageha Signature Ceremonial tin beside a finished water-only bowl of vivid green matcha and bamboo whisk. Refined walnut tray, filtered morning light, restrained Japanese luxury styling, sharp readable real package identity, generous negative space for CTA, no generated text, square 1:1 commercial photography.',
  },
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve('generated', `kageha-matcha-vs-coffee-${stamp}`);
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'product-reference.jpg'), Buffer.from(productBase64, 'base64'));

for (let index = 0; index < slides.length; index++) {
  const slide = slides[index];
  console.log(`Generating slide ${index + 1}/${slides.length}: ${slide.headline}`);
  const parts = [{ text: `${slide.prompt}\n\nImportant: output photography only. Do not render headline, body copy, letters, labels, UI, borders, or watermarks. The supplied product image is identity reference only.` }];
  if (slide.productLocked) parts.push({ inlineData: { data: productBase64, mimeType: productMimeType } });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: { parts },
    config: { responseModalities: ['Image'], imageConfig: { aspectRatio: '1:1' } },
  });
  const imageData = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!imageData) throw new Error(`No image returned for slide ${index + 1}`);
  await writeFile(path.join(outputDir, `slide-${index + 1}-raw.png`), Buffer.from(imageData, 'base64'));
}

await writeFile(path.join(outputDir, 'carousel.json'), JSON.stringify({ productUrl: 'https://kageha.ca/products/signature-ceremonial-matcha', slides }, null, 2));
console.log(`OUTPUT_DIR=${outputDir}`);
