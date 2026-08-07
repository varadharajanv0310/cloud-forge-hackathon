import path from 'path';
import { fileURLToPath } from 'url';

// Tailwind looks for tailwind.config.js relative to process.cwd(). When the dev
// server is launched from anywhere other than client/ it finds no config, falls
// back to defaults with an empty content list, emits zero utilities, and the
// whole app renders unstyled with no error. Pin the path.
const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: path.join(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
