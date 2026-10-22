export async function loadDomainDynamically(): Promise<unknown> {
  return import('../../../../packages/domain/src/index.js');
}
