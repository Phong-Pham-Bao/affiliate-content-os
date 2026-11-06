import { bootstrapWebServer } from '../src/server/bootstrap';
import { AppShell } from '../src/components/app-shell';

export const dynamic = 'force-dynamic';

export default function RootPage() {
  // Validate environment at server bootstrap boundary
  bootstrapWebServer(process.env);

  return <AppShell />;
}
