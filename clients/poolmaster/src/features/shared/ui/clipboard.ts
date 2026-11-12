import { getLogger } from "@/lib/logger";

/**
 * Puts `text` on the clipboard and says whether it got there. A refusal (an insecure origin, a
 * denied permission) is logged and answers false, so the caller can show the text to copy by hand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Missing on a plain-http origin, though the DOM types say it never is.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      throw new Error("The Clipboard API is not available on this page.");
    }
    await clipboard.writeText(text);
    return true;
  } catch (err) {
    getLogger().warn({ action: "clipboard.copy.failed", err }, "Copy to clipboard was refused");
    return false;
  }
}
