// The browsers every build supports, shared by the web, Electron, Android and
// iOS configs.
//
// This is vite 5's default (`'modules'`), written out. Vite 7 raised its own
// default to "baseline widely available", which in vite 8 is Chrome 111 and
// Safari / iOS 16.4: a quiet drop of every WebView older than that, including
// iOS 14 and 15 devices and older Android System WebViews that run the app
// today. Upgrading the bundler is not a decision to drop them, so the target
// stays where it was. It covers CSS too: `build.cssTarget` defaults to it.
//
// Raise it deliberately, with the platforms' minimum versions in hand, not as
// a side effect of a bundler upgrade.
export const BUILD_TARGET = ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'];
