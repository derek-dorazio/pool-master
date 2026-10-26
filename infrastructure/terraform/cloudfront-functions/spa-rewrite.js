// SPA routing for the web app's S3 behavior (cloudfront.tf). A URI with a file extension
// (.js, .css, .png) is served as-is; any other is a client-side route and gets /index.html.
//
// Event pages (#1010): a link-preview crawler runs no script, so for an event page it gets the
// page's own shell, /play/<sport>/<slug>/index.html, which the deploy writes with the page's
// Open Graph tags. People still get /index.html. A page with no shell gives the crawler a 403,
// which only means no preview card.
var EVENT_PAGE = /^\/play\/[a-z0-9-]+\/[a-z0-9-]+\/?$/;
var LINK_PREVIEW_CRAWLER = /facebookexternalhit|facebot|twitterbot|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|skypeuripreview|pinterest|applebot|googlebot|bingbot|redditbot|embedly|iframely|vkshare|snapchat/i;

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.includes('.')) {
    return request;
  }
  var userAgent = request.headers['user-agent'] ? request.headers['user-agent'].value : '';
  if (EVENT_PAGE.test(uri) && LINK_PREVIEW_CRAWLER.test(userAgent)) {
    request.uri = uri.replace(/\/?$/, '/index.html');
  } else {
    request.uri = '/index.html';
  }
  return request;
}
