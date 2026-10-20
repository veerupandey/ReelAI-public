/**
 * Producer Barrel Export
 * Re-exports all format-specific producers for clean imports.
 */

export { produceCarousel, type CarouselProducerInput, type CarouselSlide } from './carouselProducer';
export {
  generateVeo3Clip,
  stitchVeo3Clips,
  estimateVeo3Cost,
  type Veo3ProducerInput,
  type Veo3ClipResult,
  type Veo3CostEstimate,
} from './veo3VideoProducer';
export {
  generateWanI2vClip,
  estimateWanI2vCost,
  estimateLiveMotionCostPerClipUsd,
  resolveLiveMotionModelId,
  buildLiveMotionPrompt,
  DEFAULT_LIVE_MOTION_MODEL_ID,
  LIVE_MOTION_I2V_MODELS,
  type WanI2vClipResult,
  type WanI2vCostEstimate,
  type LiveMotionI2vModelOption,
} from './wanI2vProducer';
export {
  timeFitClip,
  resolveTimeFitStrategy,
  buildTimeFitFfmpegArgs,
  type TimeFitStrategy,
} from './timeFitClip';
