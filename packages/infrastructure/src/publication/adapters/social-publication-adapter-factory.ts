import type { SocialAccountEnvironment } from '@affiliate-content-os/domain';
import type { SocialPublicationAdapter } from '@affiliate-content-os/application';
import { FakeSocialPublicationAdapter } from './fake-social-publication-adapter.js';
import {
  type FakeSocialPublicationAdapterOptions,
  FakePublicationProductionSelectionError,
} from './fake-social-publication-types.js';

export interface ResolveSocialPublicationAdapterOptions extends FakeSocialPublicationAdapterOptions {
  readonly fakeAdapterEnabled: boolean;
  readonly environment?: SocialAccountEnvironment | 'production' | undefined;
}

export function resolveSocialPublicationAdapter(
  options: ResolveSocialPublicationAdapterOptions,
): SocialPublicationAdapter {
  const isProduction =
    options.environment === 'production' || process.env['NODE_ENV'] === 'production';

  if (options.fakeAdapterEnabled) {
    if (isProduction) {
      throw new FakePublicationProductionSelectionError(
        'Fake social publication adapter cannot be enabled in production environment.',
      );
    }
    return new FakeSocialPublicationAdapter(options);
  }

  throw new Error('No social publication adapter available (live adapters not yet implemented).');
}
