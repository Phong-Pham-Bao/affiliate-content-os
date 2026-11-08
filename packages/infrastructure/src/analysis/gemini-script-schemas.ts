/**
 * JSON schemas passed to Gemini responseJsonSchema for scriptwriter outputs.
 * Must match domain validation rules exactly with unknown-field rejection.
 */

export const singleVideoScriptJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    video: {
      type: 'object',
      properties: {
        videoNumber: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        title: { type: 'string', minLength: 1, maxLength: 256 },
        objective: { type: 'string', minLength: 1, maxLength: 500 },
        targetDurationSeconds: { type: 'integer', minimum: 15, maximum: 120 },
        hook: {
          type: 'object',
          properties: {
            spokenHook: { type: 'string', minLength: 1, maxLength: 500 },
            visualHook: { type: 'string', minLength: 1, maxLength: 500 },
          },
          required: ['spokenHook', 'visualHook'],
          additionalProperties: false,
        },
        voiceOver: { type: 'string', minLength: 1, maxLength: 4000 },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sceneNumber: { type: 'integer', minimum: 1, maximum: 10 },
              timeRangeSeconds: {
                type: 'object',
                properties: {
                  start: { type: 'number', minimum: 0 },
                  end: { type: 'number', minimum: 0 },
                },
                required: ['start', 'end'],
                additionalProperties: false,
              },
              visualDescription: { type: 'string', minLength: 1, maxLength: 1000 },
              spokenText: { type: 'string', minLength: 1, maxLength: 1000 },
              audioCue: { type: 'string', maxLength: 200 },
            },
            required: ['sceneNumber', 'timeRangeSeconds', 'visualDescription', 'spokenText'],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: 10,
        },
        onScreenOverlays: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 200 },
              timeRangeSeconds: {
                type: 'object',
                properties: {
                  start: { type: 'number', minimum: 0 },
                  end: { type: 'number', minimum: 0 },
                },
                required: ['start', 'end'],
                additionalProperties: false,
              },
              placement: {
                type: 'string',
                enum: ['top', 'middle', 'bottom', 'lower_third', 'sticker'],
              },
            },
            required: ['text', 'timeRangeSeconds', 'placement'],
            additionalProperties: false,
          },
          maxItems: 10,
        },
        callToAction: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 300 },
            visualDirection: { type: 'string', minLength: 1, maxLength: 500 },
          },
          required: ['text', 'visualDirection'],
          additionalProperties: false,
        },
        disclosure: {
          type: 'object',
          properties: {
            placement: { type: 'string', minLength: 1, maxLength: 100 },
            text: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['placement', 'text'],
          additionalProperties: false,
        },
        shotList: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNumber: { type: 'integer', minimum: 1, maximum: 15 },
              durationSeconds: { type: 'number', minimum: 0.5, maximum: 60 },
              description: { type: 'string', minLength: 1, maxLength: 500 },
              cameraAngle: { type: 'string', minLength: 1, maxLength: 100 },
              framing: { type: 'string', minLength: 1, maxLength: 100 },
              movement: { type: 'string', minLength: 1, maxLength: 100 },
              props: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 100 },
                maxItems: 10,
              },
            },
            required: [
              'shotNumber',
              'durationSeconds',
              'description',
              'cameraAngle',
              'framing',
              'movement',
              'props',
            ],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: 15,
        },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variantNumber: { type: 'integer', enum: [1, 2, 3] },
              label: { type: 'string', minLength: 1, maxLength: 100 },
              hook: {
                type: 'object',
                properties: {
                  spokenHook: { type: 'string', minLength: 1, maxLength: 500 },
                  visualHook: { type: 'string', minLength: 1, maxLength: 500 },
                },
                required: ['spokenHook', 'visualHook'],
                additionalProperties: false,
              },
              voiceOver: { type: 'string', minLength: 1, maxLength: 4000 },
              scenes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sceneNumber: { type: 'integer', minimum: 1, maximum: 10 },
                    timeRangeSeconds: {
                      type: 'object',
                      properties: {
                        start: { type: 'number', minimum: 0 },
                        end: { type: 'number', minimum: 0 },
                      },
                      required: ['start', 'end'],
                      additionalProperties: false,
                    },
                    visualDescription: { type: 'string', minLength: 1, maxLength: 1000 },
                    spokenText: { type: 'string', minLength: 1, maxLength: 1000 },
                    audioCue: { type: 'string', maxLength: 200 },
                  },
                  required: ['sceneNumber', 'timeRangeSeconds', 'visualDescription', 'spokenText'],
                  additionalProperties: false,
                },
                minItems: 1,
                maxItems: 10,
              },
              callToAction: {
                type: 'object',
                properties: {
                  text: { type: 'string', minLength: 1, maxLength: 300 },
                  visualDirection: { type: 'string', minLength: 1, maxLength: 500 },
                },
                required: ['text', 'visualDirection'],
                additionalProperties: false,
              },
              creativeHypotheses: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 500 },
                maxItems: 10,
              },
            },
            required: ['variantNumber', 'hook', 'voiceOver', 'scenes', 'callToAction'],
            additionalProperties: false,
          },
          minItems: 1,
          maxItems: 3,
        },
        evidenceReferences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceKind: { type: 'string', enum: ['product_fact', 'analysis'] },
              sourceId: { type: 'string' },
            },
            required: ['sourceKind', 'sourceId'],
            additionalProperties: false,
          },
          maxItems: 50,
        },
        creativeHypotheses: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 500 },
          maxItems: 10,
        },
      },
      required: [
        'videoNumber',
        'title',
        'objective',
        'targetDurationSeconds',
        'hook',
        'voiceOver',
        'scenes',
        'onScreenOverlays',
        'callToAction',
        'disclosure',
        'shotList',
        'variants',
        'evidenceReferences',
        'creativeHypotheses',
      ],
      additionalProperties: false,
    },
  },
  required: ['schemaVersion', 'video'],
  additionalProperties: false,
};
