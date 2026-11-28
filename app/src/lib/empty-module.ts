// Browser stand-in for Node built-ins (fs, net, tls). @anchor-lang/core's browser build still
// contains `require("fs")` inside Node-only helpers (AnchorProvider.env / NodeWallet.local) that
// the app never calls in the browser. See next.config.ts `turbopack.resolveAlias`.
export {};
