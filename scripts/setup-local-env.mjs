import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const defaultEnvExamplePath = path.join(rootDir, '.env.example');
const defaultEnvPath = path.join(rootDir, '.env');

export function setupLocalEnv({
  envFile = defaultEnvPath,
  exampleFile = defaultEnvExamplePath,
} = {}) {
  if (!fs.existsSync(exampleFile)) {
    throw new Error(`Template file ${exampleFile} does not exist.`);
  }

  if (fs.existsSync(envFile)) {
    console.log(`[env:local] ${envFile} already exists; leaving existing configuration unchanged.`);
    return { created: false, path: envFile };
  }

  try {
    fs.copyFileSync(exampleFile, envFile, fs.constants.COPYFILE_EXCL);
    console.log(`[env:local] Created ${envFile} from ${exampleFile}.`);
    return { created: true, path: envFile };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      console.log(
        `[env:local] ${envFile} already exists; leaving existing configuration unchanged.`,
      );
      return { created: false, path: envFile };
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    setupLocalEnv();
  } catch (err) {
    console.error(`[env:local] Error:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
