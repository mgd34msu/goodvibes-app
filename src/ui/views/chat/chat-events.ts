// Window-level events the shell (or palette commands registered elsewhere)
// uses to reach INTO the keep-alive Chat view without prop plumbing. The view
// listens for these on mount; anything may dispatch them.

export const CHAT_NEW_EVENT = "goodvibes:chat-new";
export const CHAT_FOCUS_COMPOSER_EVENT = "goodvibes:chat-focus-composer";
export const CHAT_SEARCH_EVENT = "goodvibes:chat-search";

export function dispatchChatEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}
