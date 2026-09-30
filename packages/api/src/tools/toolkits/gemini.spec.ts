import { tool } from '@librechat/agents/langchain/tools';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { GeminiToolkit } from './gemini';

const ENV_KEYS = ['GEMINI_IMAGE_ASPECT_RATIOS', 'GEMINI_IMAGE_SIZES'] as const;

type ToolkitEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;

/** The schema is built at import time, so each env variant loads a fresh module copy */
function loadToolkit(env: ToolkitEnv = {}): GeminiToolkit {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  const apply = (key: string, value?: string) => {
    if (value == null) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };

  ENV_KEYS.forEach((key) => apply(key, env[key]));
  try {
    let loaded: typeof import('./gemini') | undefined;
    jest.isolateModules(() => {
      loaded = jest.requireActual<typeof import('./gemini')>('./gemini');
    });
    if (!loaded) {
      throw new Error('gemini toolkit failed to load');
    }
    return loaded.geminiToolkit;
  } finally {
    previous.forEach(([key, value]) => apply(key, value));
  }
}

const createTool = (toolkit: GeminiToolkit): StructuredToolInterface => {
  const { name, description, schema } = toolkit.gemini_image_gen;
  return tool(async ({ aspectRatio }: { aspectRatio?: string }) => aspectRatio ?? 'unset', {
    name,
    description,
    schema,
  });
};

describe('Gemini image toolkit aspect ratios and sizes', () => {
  it('keeps the standard ratios, sizes and descriptions by default', () => {
    const { aspectRatio, imageSize } = loadToolkit().gemini_image_gen.schema.properties ?? {};

    expect(aspectRatio).toEqual({
      type: 'string',
      enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
      description:
        'The aspect ratio of the generated image. Use 16:9 or 3:2 for landscape, 9:16 or 2:3 for portrait, 21:9 for ultra-wide/cinematic, 1:1 for square. Defaults to 1:1 if not specified.',
    });
    expect(imageSize).toEqual({
      type: 'string',
      enum: ['1K', '2K', '4K'],
      description:
        'The resolution of the generated image. Use 1K for standard, 2K for high, 4K for maximum quality. Defaults to 1K if not specified.',
    });
  });

  it('builds the enums and hints from the configured lists', () => {
    const toolkit = loadToolkit({
      GEMINI_IMAGE_ASPECT_RATIOS: ' 1:1, 16:9,8:1,, 1:8,16:9',
      GEMINI_IMAGE_SIZES: '512,1k,2K',
    });
    const { aspectRatio, imageSize } = toolkit.gemini_image_gen.schema.properties ?? {};

    expect(aspectRatio?.enum).toEqual(['1:1', '16:9', '8:1', '1:8']);
    expect(aspectRatio?.description).toBe(
      'The aspect ratio of the generated image. Use 16:9 for landscape, 8:1 for banners/panoramas, 1:8 for tall vertical strips, 1:1 for square. Defaults to 1:1 if not specified.',
    );
    expect(imageSize?.enum).toEqual(['512', '1K', '2K']);
    expect(imageSize?.description).toBe(
      'The resolution of the generated image. Use 512 for quick drafts, 1K for standard, 2K for high. Defaults to 1K if not specified.',
    );
  });

  it('falls back to the defaults when a list is blank', () => {
    const toolkit = loadToolkit({ GEMINI_IMAGE_ASPECT_RATIOS: ' , ', GEMINI_IMAGE_SIZES: '' });
    const { aspectRatio, imageSize } = toolkit.gemini_image_gen.schema.properties ?? {};

    expect(aspectRatio?.enum).toHaveLength(10);
    expect(imageSize?.enum).toEqual(['1K', '2K', '4K']);
  });

  it('lets tool-call validation accept a configured ratio it rejects by default', async () => {
    const call = { prompt: 'a panoramic skyline', aspectRatio: '8:1' };
    const defaultTool = createTool(loadToolkit());
    const extendedTool = createTool(
      loadToolkit({ GEMINI_IMAGE_ASPECT_RATIOS: '1:1,16:9,21:9,4:1,8:1' }),
    );

    await expect(defaultTool.invoke(call)).rejects.toThrow(
      'Received tool input did not match expected schema',
    );
    await expect(extendedTool.invoke(call)).resolves.toBe('8:1');
  });
});
