import { Suspense, type ReactElement } from 'react';
import { notFound } from 'next/navigation';
import { FakeSocialAuthClient } from './fake-social-auth-client.js';

export const dynamic = 'force-dynamic';

export default async function FakeSocialAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  await searchParams;
  const isProduction =
    process.env.APP_ENV === 'production' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'production' ||
    (process.env.NODE_ENV === 'production' && process.env.ALLOW_FAKE_SOCIAL_AUTH !== 'true');

  if (isProduction) {
    notFound();
  }

  return (
    <Suspense fallback={<div>Đang tải màn hình xác thực...</div>}>
      <FakeSocialAuthClient />
    </Suspense>
  );
}
