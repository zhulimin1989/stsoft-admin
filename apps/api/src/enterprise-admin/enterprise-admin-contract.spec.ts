import {
  enterpriseAdminCreationSchema,
  enterpriseAdminCheckSchema,
  enterpriseAdminListSchema,
  enterpriseAdminOwnerLookupSchema,
  enterpriseAdminHistorySchema,
} from '@ruidong/shared';

const input = {
  enterpriseName: '示例有限公司',
  uscc: '91110000AAAAAAAAAA',
  ownerUserId: 'registered-user',
  ownerPhone: '13800138000',
  uploadSessionId: 'upload-session',
  licenseUploadId: 'license-upload',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
};

describe('enterprise admin creation contract v1', () => {
  it('bounds audit history, requires paired cursors and exact UUID operation filters',()=>{
    expect(enterpriseAdminHistorySchema.parse({})).toEqual({limit:20});expect(enterpriseAdminHistorySchema.safeParse({limit:101}).success).toBe(false);
    expect(enterpriseAdminHistorySchema.safeParse({beforeId:input.idempotencyKey}).success).toBe(false);expect(enterpriseAdminHistorySchema.safeParse({operationId:'bad'}).success).toBe(false);
    expect(enterpriseAdminHistorySchema.parse({beforeId:input.idempotencyKey,beforeAt:'2026-10-08T00:00:00.000Z',operationId:input.idempotencyKey})).toMatchObject({limit:20});
  });
  it('accepts a registered user without personal verification, payment or external consent fields', () => {
    expect(enterpriseAdminCreationSchema.parse(input)).toEqual(input);
  });
  it('normalizes equivalent phone representations and trims enterprise fields', () => {
    expect(enterpriseAdminCreationSchema.parse({
      ...input, enterpriseName: ' 示例有限公司 ', uscc: ' 91110000AAAAAAAAAA ',
      ownerPhone: '+86 138-0013-8000',
    })).toEqual(input);
    expect(enterpriseAdminOwnerLookupSchema.parse({ phone: '138 0013 8000' }))
      .toEqual({ phone: '13800138000' });
  });
  it.each(['91110000AAAAIAAAAA', '91110000AAAAOAAAAA', '91110000aaaaaaaaaa', '123'])(
    'rejects invalid USCC %s using the existing enterprise rule', (uscc) => {
      expect(enterpriseAdminCreationSchema.safeParse({ ...input, uscc }).success).toBe(false);
    },
  );
  it.each(['', 'x', 'x'.repeat(129)])('rejects an invalid enterprise name', (enterpriseName) => {
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, enterpriseName }).success).toBe(false);
  });
  it.each(['', 'not-a-phone', '12800138000', '1380013800'])('rejects invalid owner phone', (ownerPhone) => {
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, ownerPhone }).success).toBe(false);
  });
  it('rejects a client-supplied operator identity and missing required references', () => {
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, operatorId: 'forged' }).success).toBe(false);
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, licenseUploadId: '' }).success).toBe(false);
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, ownerUserId: undefined }).success).toBe(false);
    expect(enterpriseAdminCreationSchema.safeParse({ ...input, idempotencyKey: 'new-click' }).success).toBe(false);
  });
  it('requires owner ID and phone together for a submit eligibility check', () => {
    expect(enterpriseAdminCheckSchema.safeParse({
      enterpriseName: input.enterpriseName, uscc: input.uscc,
    }).success).toBe(true);
    expect(enterpriseAdminCheckSchema.safeParse({
      enterpriseName: input.enterpriseName, uscc: input.uscc, ownerUserId: input.ownerUserId,
    }).success).toBe(false);
  });
  it('bounds pagination and accepts only documented public status filters', () => {
    expect(enterpriseAdminListSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(enterpriseAdminListSchema.parse({ page: '2', pageSize: '100' })).toEqual({ page: 2, pageSize: 100 });
    expect(enterpriseAdminListSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(enterpriseAdminListSchema.safeParse({ status: 'VERIFIED' }).success).toBe(false);
    expect(enterpriseAdminListSchema.safeParse({ status: 'SUCCEEDED' }).success).toBe(true);
  });
});
