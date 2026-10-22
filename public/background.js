// Chrome owns the docked panel lifecycle. The shortcut triggers this same action.
function configureSidebar() {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
chrome.runtime.onInstalled.addListener(() =>
  configureSidebar().catch(console.error),
);
chrome.runtime.onStartup.addListener(() =>
  configureSidebar().catch(console.error),
);
configureSidebar().catch(console.error);
