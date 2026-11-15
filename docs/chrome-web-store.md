# Chrome Web Store: Privacy practices answers

Ready-to-paste text for the **Privacy practices** tab of the Chrome Web Store developer dashboard. It matches `extension/public/manifest.json` (version 0.1.9) and [PRIVACY.md](../PRIVACY.md). If the manifest's permissions change, update this file in the same change.

Privacy policy URL: `https://github.com/TheOligarch/usc-schedule-maker/blob/main/PRIVACY.md`

## Single purpose

> USC Schedule Maker helps USC students plan a class schedule. Students enter required courses, open GE or elective slots, allowed class times and priorities, and the extension generates every conflict-free schedule from USC's course catalog and ranks them by those priorities. A short optional AI interview captures preferences and suggests courses. The extension adds a "myScheduleMaker" tab to USC WebReg so students can plan there and, if they choose, add a chosen schedule's sections to their WebReg myCourseBin.

## Permission justifications

The manifest requests no API permissions (`permissions` is absent). It has two `host_permissions` and one content script match. The dashboard asks for one justification under **Host permission justification**; paste the whole block below.

> **Content script on https://webreg.usc.edu/\*:** Adds a "myScheduleMaker" tab to USC WebReg's navigation and opens the scheduling app in a panel on that page. It highlights the sections a schedule picked when the student opens a course from the app. When the student clicks "Add all to myCourseBin" and confirms, it adds that schedule's sections to their course bin, using WebReg's own add request in the student's signed-in session. An allowlist restricts it to loading a course page and adding a section, so it cannot register, drop or check out. Nothing read from WebReg is stored or sent elsewhere.
>
> **https://classes.usc.edu/\*:** Fetches live seat counts for the courses in the schedule being viewed from USC's public course API. This runs in the background service worker because that API sends no CORS headers. Requests contain only a term and course codes and are sent without cookies.
>
> **https://mmdvgvpckweiklkbuxvy.supabase.co/\*:** The extension's own backend. It downloads the public course catalog files from Supabase Storage and calls the extension's AI functions (interview, schedule explanations, schedule-feedback interpretation, health check) on Supabase Edge Functions.

Individual justifications, if the dashboard asks for them separately:

| Permission | Justification |
| --- | --- |
| Content script `https://webreg.usc.edu/*` | Adds the myScheduleMaker tab and app panel to USC WebReg, highlights the sections a schedule picked, and, only when the student confirms, adds those sections to their WebReg myCourseBin using WebReg's own add request in their session. It is allowlisted to course-page reads and course-bin adds only. |
| `https://classes.usc.edu/*` | Live seat counts for the schedule being viewed, from USC's public course API (no CORS headers, so the service worker fetches them). Term and course codes only, no cookies. |
| `https://mmdvgvpckweiklkbuxvy.supabase.co/*` | The extension's own backend: public course catalog downloads and its AI functions. |

`web_accessible_resources` (`index.html`, `assets/*`, `icons/*`, matched to `https://webreg.usc.edu/*` only) lets the content script show the extension's own app page in an iframe on WebReg. It is not a permission and needs no justification field.

`storage`: not requested in 0.1.9, which keeps its data in the extension page's `localStorage` and IndexedDB. **Only if** the rate-limit change adds `"storage"` to the manifest for the install ID, use:

> **storage:** Keeps the extension's random, anonymous install ID on the device so it can be sent with AI requests for rate limiting. It holds no personal information.

## Remote code

Answer: **No, I am not using remote code.**

> All JavaScript the extension runs is packaged in the extension. It does not load external scripts, use eval or new Function, or inject remote code into pages. The extension downloads JSON course catalog files from its Supabase storage and receives JSON responses from its AI backend; both are parsed and displayed as data and never executed.

## Data usage

### What user data do you plan to collect from users now or in the future?

"Collect" here means data that leaves the user's device. Data kept only in the browser is not collected.

| Data type | Check? | Why |
| --- | --- | --- |
| Personally identifiable information | No | No name, email, address, age or institutional ID is requested or sent. The rate-limit install ID is random and not linked to any person, so it is not an identification number of the kind this category means. |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | The WebReg add request uses the student's existing session cookie and WebReg's page token, but only same-origin to WebReg itself. The extension never reads or sends a password or credential to its own servers or anyone else. |
| Personal communications | No | |
| **Location** | **Yes** | The AI backend processes the IP address for rate limiting and stores it only as a salted hash, deleted within 48 hours. Checked conservatively because the dashboard lists IP address under Location. |
| Web history | No | |
| User activity | No | No clicks, keystrokes, scrolling or network activity is monitored or logged. |
| **Website content** | **Yes** | Text the user types into the extension (interview answers and schedule feedback) and their course selections are sent to the AI backend and to Anthropic to produce a reply. Nothing read from WebReg pages leaves the device except back to WebReg. |

### Certifications

Check all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

Anthropic receives the AI request content as a service provider to generate the reply. That is a transfer needed to provide the extension's single purpose, which the first certification allows.
