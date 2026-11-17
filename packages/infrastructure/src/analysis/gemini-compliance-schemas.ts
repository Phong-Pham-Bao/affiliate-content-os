export const complianceAdvisoryJsonSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Tóm tắt nhận xét và đánh giá tuân thủ cố vấn cho gói kịch bản.',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'Mã phát hiện cố vấn (e.g. ADVISORY_TONE_CONSISTENCY, ADVISORY_DISCLOSURE_CLARITY, ADVISORY_CLAIM_SUBTLETY, ADVISORY_EVIDENCE_RELEVANCE).',
          },
          severity: {
            type: 'string',
            enum: ['info', 'warning'],
            description:
              'Mức độ nghiêm trọng của phát hiện cố vấn. Chỉ cho phép info hoặc warning.',
          },
          videoNumber: {
            type: ['integer', 'null'],
            minimum: 1,
            maximum: 5,
            description:
              'Số thứ tự video liên quan (1..5) hoặc null nếu áp dụng cho toàn bộ gói kịch bản.',
          },
          fieldPath: {
            type: 'string',
            description: 'Đường dẫn trường dữ liệu liên quan (e.g. videos[0].hook, callToAction).',
          },
          message: {
            type: 'string',
            description: 'Nội dung nhận xét hoặc khuyến nghị cải thiện an toàn.',
          },
          evidenceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Danh sách ID bằng chứng liên quan nếu có.',
          },
        },
        required: ['code', 'severity', 'fieldPath', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'findings'],
  additionalProperties: false,
} as const;
