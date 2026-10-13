// SPDX-License-Identifier: GPL-3.0-only
// The install counter: a CloudFront Function on viewer requests to /count/*.
//
// The page tells it how far a visitor got (site/frontend/src/lib/telemetry.ts): POST /count/<event>?fw=..&had=..
// It writes one line to its log and answers 204; nothing reaches the bucket. CloudFront sends the log to
// CloudWatch Logs in us-east-1, where site/infra/lib/telemetry-stack.ts counts the lines and draws the dashboard.
//
// A line holds the event and four short values and nothing else: no address, no browser, no cookie.
//   FM1EVT_done fw=b16 had=FM-1_015 stage=- sid=1a2b3c4d
// The names here must match site/install-count.json (a test checks: src/lib/telemetry.test.ts).
//
// Written in the plainest JavaScript (var, indexOf, counted loops): CloudFront's runtimes take only part of the
// language, and this cannot be tried on CloudFront before it is deployed.
var EVENTS = ['visit', 'file', 'connect', 'start', 'done', 'fail'];
var FIELDS = ['fw', 'had', 'stage', 'sid'];
var PLAIN = /^[A-Za-z0-9._-]{1,24}$/;   // anything else is logged as "-": a line can not be forged into two

function answer(statusCode, statusDescription) {
  return { statusCode: statusCode, statusDescription: statusDescription, headers: { 'cache-control': { value: 'no-store' } } };
}

function handler(event) {
  var req = event.request;
  var name = req.uri.slice('/count/'.length);
  if (req.method !== 'POST' || EVENTS.indexOf(name) < 0) return answer(404, 'Not Found');
  var line = 'FM1EVT_' + name;
  for (var i = 0; i < FIELDS.length; i++) {
    var q = req.querystring[FIELDS[i]];
    line += ' ' + FIELDS[i] + '=' + (q && typeof q.value === 'string' && PLAIN.test(q.value) ? q.value : '-');
  }
  console.log(line);
  return answer(204, 'No Content');
}
