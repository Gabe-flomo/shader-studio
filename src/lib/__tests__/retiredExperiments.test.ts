/** The retired explanation model's leftovers: its settings keys and its downloaded files, and nothing else. */
import { describe, expect, it } from 'vitest';
import { isRetiredModelFile, retiredExplainKeys } from '../retiredExperiments';

describe('retired explanation model data', () => {
  it('finds its settings keys only', () => {
    const keys = [
      'shader-studio:settings:useExplainModel', 'shader-studio:settings:explainModelDownloaded',
      'shader-studio:settings:explainModelDownloaded:qwen3-4b', 'shader-studio:settings:explainModelActive',
      'shader-studio:settings:useImageModel', 'shader-studio:settings:imageModelDownloaded', 'shader-studio:settings:explainModelActiveX',
    ];
    const store = { length: keys.length, key: (i: number) => keys[i] ?? null };
    expect(retiredExplainKeys(store)).toEqual(keys.slice(0, 4));
  });

  it('matches the language models’ cached files, not the image or depth models’', () => {
    expect(isRetiredModelFile('https://huggingface.co/onnx-community/Qwen2.5-Coder-1.5B-Instruct/resolve/main/onnx/model_q4f16.onnx')).toBe(true);
    expect(isRetiredModelFile('https://huggingface.co/onnx-community/Qwen3-4B-ONNX/resolve/main/tokenizer.json')).toBe(true);
    expect(isRetiredModelFile('https://huggingface.co/onnx-community/Olmo-3-7B-Instruct-ONNX/resolve/main/config.json')).toBe(true);
    expect(isRetiredModelFile('https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx')).toBe(false);
    expect(isRetiredModelFile('https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model.onnx')).toBe(false);
  });
});
