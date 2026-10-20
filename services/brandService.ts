import type { Brand, BrandDNA, BrandAsset, BrandMemory } from '../types/brand';

const STORAGE_KEY = 'reelai_brands';

const getBrandsFromStorage = (): Brand[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveBrandsToStorage = (brands: Brand[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brands));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.warn('LocalStorage quota exceeded. Re-sampling brands to save space.');
      // Simple strategy: Clear the oldest brands if we hit the limit
      if (brands.length > 5) {
        saveBrandsToStorage(brands.slice(-5));
      }
    } else {
      console.error('Failed to save to localStorage', e);
    }
  }
};

export const getBrands = (userId: string): Brand[] => {
  return getBrandsFromStorage().filter(b => b.userId === userId);
};

export const getBrand = (brandId: string): Brand | null => {
  return getBrandsFromStorage().find(b => b.id === brandId) || null;
};

export const saveBrand = (brand: Brand): Brand => {
  const brands = getBrandsFromStorage();
  const idx = brands.findIndex(b => b.id === brand.id);
  if (idx >= 0) {
    brands[idx] = { ...brand, updatedAt: new Date().toISOString() };
  } else {
    brands.push(brand);
  }
  saveBrandsToStorage(brands);
  return brand;
};

export const createBrand = (userId: string, name: string, websiteUrl: string, instagramHandle?: string): Brand => {
  const brand: Brand = {
    id: `brand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    userId,
    name,
    websiteUrl: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
    instagramHandle: instagramHandle || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dna: null,
    brandMemory: null,
    assets: [],
    status: 'new',
  };
  return saveBrand(brand);
};

export const updateBrandDNA = (brandId: string, dna: BrandDNA): Brand | null => {
  const brands = getBrandsFromStorage();
  const brand = brands.find(b => b.id === brandId);
  if (!brand) return null;
  brand.dna = dna;
  if (brand.brandMemory) {
    brand.brandMemory = {
      ...brand.brandMemory,
      dna,
      approvedClaims: dna.valuePropositions || brand.brandMemory.approvedClaims,
    };
  }
  brand.status = 'ready';
  brand.updatedAt = new Date().toISOString();
  saveBrandsToStorage(brands);
  return brand;
};

export const updateBrandMemory = (brandId: string, brandMemory: BrandMemory): Brand | null => {
  const brands = getBrandsFromStorage();
  const brand = brands.find(b => b.id === brandId);
  if (!brand) return null;
  brand.brandMemory = brandMemory;
  brand.updatedAt = new Date().toISOString();
  saveBrandsToStorage(brands);
  return brand;
};

export const addBrandAsset = (brandId: string, asset: BrandAsset): Brand | null => {
  const brands = getBrandsFromStorage();
  const brand = brands.find(b => b.id === brandId);
  if (!brand) return null;
  brand.assets.push(asset);
  brand.updatedAt = new Date().toISOString();
  saveBrandsToStorage(brands);
  return brand;
};

/** Patch an existing brand asset in place (e.g. persist hydrated base64). */
export const updateBrandAsset = (brandId: string, asset: BrandAsset): Brand | null => {
  const brands = getBrandsFromStorage();
  const brand = brands.find(b => b.id === brandId);
  if (!brand) return null;
  const idx = brand.assets.findIndex((existing) => existing.id === asset.id);
  if (idx < 0) {
    brand.assets.push(asset);
  } else {
    brand.assets[idx] = { ...brand.assets[idx], ...asset };
  }
  brand.updatedAt = new Date().toISOString();
  saveBrandsToStorage(brands);
  return brand;
};

export const deleteBrand = (brandId: string): void => {
  const brands = getBrandsFromStorage().filter(b => b.id !== brandId);
  saveBrandsToStorage(brands);
};

export const updateBrandStatus = (brandId: string, status: Brand['status']): Brand | null => {
  const brands = getBrandsFromStorage();
  const brand = brands.find(b => b.id === brandId);
  if (!brand) return null;
  brand.status = status;
  brand.updatedAt = new Date().toISOString();
  saveBrandsToStorage(brands);
  return brand;
};
