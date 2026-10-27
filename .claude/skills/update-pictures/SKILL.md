---
name: update-pictures
description: Adding or changing a picture the site or its emails show — a sport's photo (email header and event page hero), a contest type's drawn picture, or an event page's link preview image for chats and social posts — checked, sized, committed and seen live on QA. Use when someone sends a new photo, a How to Play illustration changes, a page's copy changes, or a picture is missing or stale on QA.
user-invocable: true
allowed-tools: [Read, Grep, Glob, Edit, Write, Bash]
---

# Updating the site's pictures

Three kinds of picture, each made a different way and each committed as a file:

| Picture | Where it lives | How it is made | What checks it |
|---|---|---|---|
| Sport photo | `clients/poolmaster/public/email/sports/<sport>.jpg`, 1200 by 480, with `<sport>.source.md` beside it | A licensed photo, checked and cropped by hand | `email-illustrations.test.ts`: every sport has a file, and every photo its source note |
| Contest type picture | `clients/poolmaster/public/email/formats/`, and a sport's drawn scene in `public/email/sports/` while it has no photo | `scripts/render-email-images.mjs` draws the How to Play illustrations | The same test, against `public/email/drawn.json`: a changed illustration not redrawn fails |
| Link preview image | `clients/poolmaster/public/og/<sport>-<slug>.jpg`, 1200 by 630 | `scripts/render-link-preview-images.mjs` draws each event page's tile from its copy | `link-preview.test.ts`: every event page with copy has an image |

What a picture may show is `rules/ux-rules.md` §14 *System Email* item 5 (*Pictures are ours or
generic*); where the photo appears is `rules/ux-rules.md` §13 *Event Pages* item 7 (*The hero
shows the sport's photo*) and the link preview is item 6 (*Every page with copy has its link
preview*). Read the item for the picture you are changing first. One photo per sport serves the
email header and the event page hero through `sportHeaderImagePath`, so changing it changes both.

## A sport photo

1. **Get the photo from the user.** Stock photo sites block this container's searches, so the
   user finds and downloads it. Ask for the photo page's link as well as the file: the source
   note needs it.
2. **Keep the original.** Every photo the user sends goes, downscaled to 2400 pixels on the long
   side, into `brand/photos/<sport>/` with a row in `brand/photos/README.md` saying whether it
   is used, a backup, or not usable and why. A rejected photo is still kept, so nobody checks it
   twice.
3. **Check it** for everything §14 item 5 lists: logos and makers' marks, sponsor decals,
   slogans, named venues, readable numbers, recognisable faces. Check at the size it shows (a
   1200 by 480 crop, and the digest's smaller crop), not only full size. A mark too small to read
   there passes; say so in the note.
4. **Crop it** to exactly 1200 by 480 and save it as a JPEG of roughly 100 to 150 KB (Pillow and
   ImageMagick are both in the container). Crop away a mark rather than reject a good photo when
   the crop still reads as the sport.
5. **Write the source note** `<sport>.source.md` beside it, in the shape the other notes use:
   photographer, source link, licence and its terms, download date and crop, and what was
   checked. The note is what makes the file a photo rather than a drawing: the render script
   skips any sport that has one.
6. From `clients/poolmaster`, run `npx vitest run src/features/contest-types/email-illustrations.test.ts`
   and open the photo once more.

## A contest type picture

Change the How to Play illustration in the web app, then from `clients/poolmaster` run
`node scripts/render-email-images.mjs`. It redraws every drawn picture and rewrites
`public/email/drawn.json`; commit the pictures that changed and the JSON. A new sport or
selection type is drawn on the next run with no list to update, since `emailIllustrations` walks
every supported sport and selection type. The script loads its fonts from Google Fonts:
open the new picture before committing, since without them it draws in fallback fonts.

## A link preview image

The `add-event-page` skill draws one for a new page. Redraw whenever a page's name, eyebrow,
hook or offers change: from `clients/poolmaster`, `node scripts/render-link-preview-images.mjs`
redraws every page into `public/og/`. Commit only the pages whose copy changed, after opening
each: the text must fit the card, the fonts must be the real ones, and the file must stay under
about 300 KB for WhatsApp.

Only event pages (`/play/<sport>/<slug>`) have link previews. The deploy writes each page's
shell with its Open Graph tags, and the CloudFront function in
`infrastructure/terraform/cloudfront-functions/spa-rewrite.js` serves that shell to link-preview
crawlers only. A preview for any other address, or a change to the crawler list, is a change to
that function and so a Terraform apply (the `apply-terraform` skill), not just a picture.

## Seeing it on QA

Each merge to main deploys QA in about 20 minutes. Then:

```bash
curl -sI https://qa.ultimateofficepoolmanager.com/email/sports/<sport>.jpg | head -1
curl -s -A "facebookexternalhit/1.1" https://qa.ultimateofficepoolmanager.com/play/<sport>/<slug> | grep og:image
```

This container cannot reach QA, so ask the user to open the picture, or paste the page's link in
a chat with `?t=1` on the end. To see a photo in an email, dispatch the **Send email previews**
workflow after the deploy (the `add-email` skill, Step 6): previews load pictures from QA.

## Traps

- **A file in `public/` linked by its root path.** The deploy copies the build under
  `releases/<sha>/`, and only the app shell, `/play/` and `/email/` are also synced to the
  bucket's root. Emails already sent link to `/email/...` forever, so that sync never deletes.
  A new folder of pictures linked by an absolute `/<folder>/` URL gets AccessDenied on QA until
  the deploy job in `.github/workflows/ci.yml` syncs it to the root as well.
- **An old picture after the deploy.** `/email/` files are cached for a day, and chat apps cache
  a link's card. Replacing a photo under the same name can show the old one for up to a day;
  that is expected, not a failed deploy.
- **A drawn scene overwriting a photo.** A photo without its `.source.md` note is treated as a
  drawing and redrawn by the render script.
- **A stale link preview.** The test checks that each page has an image, not that it matches the
  copy. Re-run the render script whenever the copy changes.
- **Pictures in a pull request.** A PR build has no app URL, so it writes no page shells and
  link previews cannot be checked before merge; check them on QA after.
