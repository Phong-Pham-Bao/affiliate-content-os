import { Suspense, type ReactElement } from 'react';
import { notFound } from 'next/navigation';
import { FakeSocialAuthClient } from './fake-social-auth-client.js';

export const dynamic = 'force-dynamic';

function getEffectiveNodeEnv(): string | undefined {
  const env = process.env;
  const key = 'NODE_ENV';
  return env[key];
}

export default async function FakeSocialAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await searchParams;
  const nodeEnv = getEffectiveNodeEnv();
  const isProduction =
    process.env.APP_ENV === 'production' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'production' ||
    nodeEnv === 'production';

  if (isProduction) {
    notFound();
  }

  return (
    <Suspense fallback={<div>Đang tải màn hình xác thực...</div>}>
      <FakeSocialAuthClient />
    </Suspense>
  );
}
