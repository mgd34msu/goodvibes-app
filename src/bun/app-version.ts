// The app's own version string, single-sourced from package.json (same
// mechanism electrobun.config.ts uses for `app.version`). Split out of
// index.ts so it can be imported by a test without pulling in index.ts's
// module-scope `main()` call and its electrobun/bun window-boot side effects.
//
// A hardcoded literal here previously shipped v0.1.1/v0.2.0 binaries that
// self-reported 0.1.0 in /app/health; do not reintroduce one.
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
