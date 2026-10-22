import { bootstrapWebServer } from '../src/server/bootstrap';

export const dynamic = 'force-dynamic';

export default function RootPage() {
  // Validate environment at server bootstrap boundary
  bootstrapWebServer(process.env);

  return (
    <main className="shell-container">
      <h1 className="shell-heading">Affiliate Content OS</h1>
      <p className="shell-status">Application shell is running</p>
    </main>
  );
}
