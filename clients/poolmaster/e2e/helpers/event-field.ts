import { expect, type Page } from '@playwright/test';
import { submitAndRead } from './browser-writes';

/**
 * The Event page's Field grid (#1890): each row is read-only, and its ⤢ opens the participant's
 * dialog, whose Edit corrects its tier, price, rank, odds and seed.
 */
const DIALOG = 'root-admin-event-participant-dialog';

/** Opens a field row's dialog in view mode. */
export async function openFieldParticipant(page: Page, fieldEntryId: string): Promise<void> {
  await page.getByTestId(`root-admin-event-field-row-${fieldEntryId}`).getByRole('button', { name: /Open details/ }).click();
  await expect(page.getByTestId(DIALOG)).toBeVisible();
}

/** Closes the open participant dialog. */
export async function closeFieldParticipant(page: Page): Promise<void> {
  await page.getByTestId(DIALOG).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId(DIALOG)).toBeHidden();
}

/** Corrects one participant on the Field tab through its dialog, then closes it. */
export async function correctFieldParticipant(
  page: Page,
  eventId: string,
  fieldEntryId: string,
  values: { tierKey?: string; price?: number; oddsToWin?: number; seedNumber?: number },
): Promise<void> {
  await openFieldParticipant(page, fieldEntryId);
  await page.getByTestId(`${DIALOG}-edit`).click();
  if (values.tierKey !== undefined) await page.getByTestId(`${DIALOG}-edit-tier`).selectOption(values.tierKey);
  if (values.price !== undefined) await page.getByTestId(`${DIALOG}-edit-price`).fill(String(values.price));
  if (values.oddsToWin !== undefined) await page.getByTestId(`${DIALOG}-edit-odds`).fill(String(values.oddsToWin));
  if (values.seedNumber !== undefined) await page.getByTestId(`${DIALOG}-edit-seed`).fill(String(values.seedNumber));
  // One save: the tier move rides in the field patch, so it stands or falls with the rest.
  await submitAndRead(page, `${DIALOG}-save`, 'PATCH', `/api/v1/events/${eventId}/participants`);
  // Saved, the dialog goes back to its view.
  await expect(page.getByTestId(`${DIALOG}-edit`)).toBeVisible();
  await closeFieldParticipant(page);
}
