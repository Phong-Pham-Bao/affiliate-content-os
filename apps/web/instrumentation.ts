/**
 * Next.js runtime startup instrumentation hook.
 * Validates configuration at server process startup before serving requests.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { bootstrapWebServer } = await import('./src/server/bootstrap');
      bootstrapWebServer(process.env);
    } catch (error) {
      console.error(
        `Web configuration error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  }
}
