import { CopyButton } from "./copy-button";
import { Text } from "./text";
import { Tile } from "./tile";

type WebAddressBoxProps = {
  /** The full address, origin included: it is what Copy puts on the clipboard. */
  url: string;
  /**
   * Whether the address answers yet. Until it does (a league still being created) the address
   * looks like a link but does not open, since it would show a missing page; Copy still works.
   */
  isLive: boolean;
  /** Why the address doesn't open yet, shown on hover while it isn't live. */
  notLiveHint?: string;
  testId?: string;
};

/** The address as people read it: no `https://`, nothing after it. */
function displayAddress(url: string) {
  return url.replace(/^https?:\/\//, "");
}

/**
 * A web address someone will share: the full address in bold, underlined, opening in a new tab
 * once it is live, beside a Copy button. Clearly louder than a field's helper text, because the
 * address is what the reader came for.
 */
export function WebAddressBox({ isLive, notLiveHint, testId, url }: WebAddressBoxProps) {
  const address = displayAddress(url);
  return (
    <Tile
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid={testId}
      padding="sm"
      radius="sm"
      variant="subtle"
    >
      <Text
        asChild
        className="min-w-0 break-all underline underline-offset-4"
        size="base"
        tone="primary"
        variant="strong"
        weight="bold"
      >
        {isLive ? (
          <a data-testid={testId ? `${testId}-link` : undefined} href={url} rel="noopener noreferrer" target="_blank">
            {address}
          </a>
        ) : (
          <span
            aria-disabled="true"
            data-testid={testId ? `${testId}-link` : undefined}
            title={notLiveHint}
          >
            {address}
          </span>
        )}
      </Text>
      <CopyButton label="Copy" size="sm" testId={testId ? `${testId}-copy` : undefined} text={url} />
    </Tile>
  );
}
