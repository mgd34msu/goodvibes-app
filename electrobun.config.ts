import type { ElectrobunConfig } from "electrobun/bun";

const config: ElectrobunConfig = {
  app: {
    name: "GoodVibes",
    identifier: "dev.pellux.goodvibes-app",
    version: "0.1.0",
    description: "GoodVibes desktop — the unified GUI for the GoodVibes ecosystem.",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/ui/main.tsx",
      },
    },
    copy: {
      "src/ui/index.html": "views/mainview/index.html",
      "src/ui/styles": "views/mainview/styles",
      "assets/fonts": "views/mainview/fonts",
    },
  },
  runtime: {
    // The Bun process owns shutdown: the daemon must outlive window close
    // decisions, so we handle exit ourselves in src/bun/index.ts.
    exitOnLastWindowClosed: true,
  },
};

export default config;
