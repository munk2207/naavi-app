/**
 * seed-demo-emails Edge Function
 *
 * One-time seed tool: inserts the 39 demo email messages (9 two-message
 * threads + 21 single messages) into Robert Sinclair's real Gmail inbox
 * via the Gmail API's messages.insert, per
 * docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md section 5.
 *
 * Requires the gmail.insert OAuth scope (added to lib/supabase.ts +
 * lib/calendar.ts 2026-08-01, REQUIRED_OAUTH_SCOPE_VERSION 3). Robert must
 * have signed out and back in AFTER that change deployed for his stored
 * refresh token to actually carry this permission — this function will
 * fail with a 403 from Gmail if he hasn't.
 *
 * Hardcoded to Robert's staging user_id by design — this is a one-off demo
 * seeding tool, not a general-purpose endpoint. Do not widen its scope.
 *
 * Usage: POST with {} body (no params needed) — idempotency is NOT
 * implemented (Gmail has no natural dedupe key for inserted messages), so
 * only run this once. Re-running will create duplicate emails.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROBERT_USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const ROBERT_EMAIL = 'robert.esm.2207@gmail.com';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_INSERT_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/import';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PDF_INVOICE_REYES: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMDE5Cj4+CnN0cmVhbQpHYXRVMWdNWWIqJjpOLzMqKzRDYy4zK1ZLLFlJTFJgZ2BkZkFfWD07P3NpZ3ViSSMtaCxVU2BpMmFCVFY2IVtgIlovJD8tTF4ja1xjPl9uU0xPdCYsW2JuRmxBZE1mITpmKW1XJTJzSGxQJz1FMlM5cTA/VG5tL0dlL0NGQ05ua2o0UjU3S14lL1hVLCRHPGxXQClTY25BaGkpT0kkPkBYTlFQPmM4M1M4RERLLm0lKzg8JjkyIUQxPCs5TiFjSzZsLigoTCgsdCxdcTJuUExYMl9COzFRQy84TklAVz80TzFGR1haKjk6KiR1QnMjTWRCUzE5PUZwbWY1WS9OayhuRFg+MFVLU0lgKUI4WScjNEpESk04ZD9uZTZlXmolKVdIPmo2NVAtaiMyMkNoJ2hqUm1jKWArZkpqUmAqMDlaWFpOc21xTE1SbEZmRC1xcENnQERPK1U6O246QnVcOG1pWmlLVlpiczgqaU84SkIrJTJgSm91QFE6M0s6RyZbalE5P15EOixWJVM5amdwdUw9UlxUOV9uX3NRbSNVMj4nNFttVzRYbT47UUMqXXJNL1VyWjZCQyRUOUFXbnVPJTY9TTdOO2xRbyouQkRUR0dhcE5NPmhyNDQ4I2ZhaSE1TGtwcUYqc0tWOik9a0JcUk9OREhRSkYubDkjQmZZIjImQnIpUUs5QDBZUjBpbENIQmpDX2ZoMiNrXEskM0JyUC1IRk8kQW0icmlUPjtUKCFlMDg5ayVYajdkQ0ksTUBmKzQiL2krbS5ddDBwNF5XQl43W1lVaSVuVWwlTzg2LW1TTVFuRShrbDJZcjwsO2JeR0glaEJAYlBfMWg3LmttbiZXO1NVRFxYQVloXWxvVlZJa0E8XUtmT09wM3JqJ21GPW1xYUdHT2hgZUU1WVZPaW8sbCUpYz42ODBjKksiWVtCJCFTXkVqZjxKQDlsRiZjaG1KdGNTbSMudWBNI21nKEJZMWlTbzNHbi8kIy5nWzY4cVVjZCdrWGljN1wxbWlTXjZNUUw4UlQ/WWRNKmdBUWclPE1CIylFZyRPSkNPX1NgNldwSFYhPXJ1ZHBITFZkNk4jdUkpPzwqbypDU0dVLGovUCtmWUtsaG1SJzpTdVhTVWc2J1ZHOV5jPGlSR1JvWFRoZ1NgcUFwPFc3JU80bCNPJiUlSlRCNFRhZDdnSjcvaU9eLEJabEEzLiRqb2wxNWUqIV5RLSlfMEsjaW87VXBZMGpJY2VOMD5pZyFHbWJ0a1c7UFIoIVhEMiVgUVdUWnJOUT8yMGVDWTFDKzg5SStzIy8sTmxUV0ZtLjAlMltEUXFeM1hwMyhIO1BnSXBFRW1KXiNCJ0dfP05+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMDIgMDAwMDAgbiAKMDAwMDAwMDIwOSAwMDAwMCBuIAowMDAwMDAwMzIxIDAwMDAwIG4gCjAwMDAwMDA1MTQgMDAwMDAgbiAKMDAwMDAwMDU4MiAwMDAwMCBuIAowMDAwMDAwODYyIDAwMDAwIG4gCjAwMDAwMDA5MjEgMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8ZGVlNzQ1MDlkOTJiZDIxZWM1ZGZiNDQ3ZTFlNTg5YmE+PGRlZTc0NTA5ZDkyYmQyMWVjNWRmYjQ0N2UxZTU4OWJhPl0KJSBSZXBvcnRMYWIgZ2VuZXJhdGVkIFBERiBkb2N1bWVudCAtLSBkaWdlc3QgKG9wZW5zb3VyY2UpCgovSW5mbyA2IDAgUgovUm9vdCA1IDAgUgovU2l6ZSA5Cj4+CnN0YXJ0eHJlZgoyMDMxCiUlRU9GCg==";

const PDF_INVOICE_HYDRO: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5NzAKPj4Kc3RyZWFtCkdhdFUxZ0o2S2cmOk86UyoydWZzLC1wUltsWkpnLEtsU1VvIWopK0soX2JbYzJRVWJpOEgmPHVJMGthJTtWRVVgMnFqZl9GKFhSWS9jdTdcQ1ZLPFEzIWNlYE0xS1oiR0A2UylLXWI8JVNPXVRjQElRLiVBclc/T2E2bGNrTS9zNU8pInUsYjo5alBNSzJbXUZcXSZNYGstcTUnNzkpZF9rVC5NXiNeN2loVi9zMFNYb2Q6LllAJ3RcQmokdWNyM1FWUypiQm4zMDMwbFtiQy9ALmU+K0NuWDUsRG4vaFhsdDFdSWAoLzppUC5xbD0iUVJsJj06SS5IN1FkT1o7YCZmOSI1RylELV0wRCZAPDkiMVtrUmkyYFtJQG9eXTRbcURDJWA9XSVSKnBsaCtCIUdIT0dpZXNmWj4pYS5BV2ssT2w6VVwrSmk4X2pvJ19IJFptSipcUDlMY1hRYEFeYyhmNmdjakYpWEMlakg2LmFnO21TK2ZRSXA+WGBnbVNmaixLVGg+IWVpWz4+V1pmOz0jMkVFKlM8ZGBXaSVWMG9eRU9nXElxRVwkQjYvJSokVnBNKW5QQmRWTm5vPUViN0dHPVZRZVBiPjZfSylgRV1PZlw0LFc5IjhBaCo4UEZqKDFsbnNrMiwtVVxlK0ctLjVyPSdgUDhPa1QwInIuQEQmMUNlPG1sKiktZy1APzZXTGsjaWEmXkJzJ0cuKEBEQURgQUhoNTJXOydsP0FmdERVbzxtU0M/RlRzRUVCOz0+UjE6UGxVdTMpMiJkQGteYSdsM2VyZzpqRTBhVHQ9USwlQSsqLjVGL2NKdEJoP1FnaTs2c0pjS04ocy5GVismKyVrPSVoSS08citncFNVSE49JWZFa289VjFhJEpLRFBOajlxNTlIJ2haKjRKTSo0c2FnJHBjXkhzQS03ViYsRWhmaFVIZkYiWEs3WyhNUzRnQ2VkaTtFWCEyWjIsQDspIjJhbjlhQHMhdTBsN0FxQjFXTl02ZVU6bzwjaidWS1NiSXM5QUVENmc3Ri1TKjFHI09TX2RVNS0nLS5ZP2dRJVpwTS1TP0UuZjdGdXBzQ3RlbEldTzQyMSI5KT9MRUYiNVEwdDUoX0o0Sk4vNjxRRj40c1krMlRtcmtbKzo6W0wnU0NFR1hgajJ0JyYzQTdPTltqKylFLGkxJURzbDgiZVJcNHJ0T2J0OkE9InFUZU9GPDdncUFEOy9SPWlZXWkwOmxPTXMybE91TzdKcDEoSChVZkBvbjtQXGtNXmsvO0xtcnIhKCUwI3Jxfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTE0IDAwMDAwIG4gCjAwMDAwMDA1ODIgMDAwMDAgbiAKMDAwMDAwMDg2MiAwMDAwMCBuIAowMDAwMDAwOTIxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGMwMzZlN2MzODI0NDRkOTQ5ZjcyN2ZhNTg3NTc1MmFlPjxjMDM2ZTdjMzgyNDQ0ZDk0OWY3MjdmYTU4NzU3NTJhZT5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMTk4MQolJUVPRgo=";

const PDF_INVOICE_AUTODESK: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5MDYKPj4Kc3RyZWFtCkdhdFUxPyNRMmQnUmYuRyosM2xmPD0tVkslLm43VUJyY0AzXHUraDIwK04rQS9NUlBSTj9bYzE6SCRRR0JwLGxuLDJxYj41NTRqLUYpOnNkKDVWdDAxWjErLG5NcFdETG8pO1Rrb2RSUz1fJyhCQWRzPVNfXXJwJFlxVC5xNkJOK187Ml8tXidbWz8wazdsRUQuJFEzPz88QzspU0w+VFYoczFHLkpFUyclT2IxOyVERHBIVmkmJ3BCVy9hMkVdV08oWT9VOjBhNzA1ck1OQ0FGPytUdTAzT2QnUjpEXCgjaysxR0thYmJuXVZJPSlBNjMuWVdDUlJ1c0wxQjxVcWI+T2FVaj1PWG5jPVtDKHFIQWdFVzk5UnRFc1E1US8uSTIoX14qSD1lOlsjPC9lKz5LRUk7MWNdbGFQIkFbJTlURyIzYXIpVF9TckApMzxNMCVHOC5QbD0pOmhlNzBLWGluaUVDLT9uZ3EzXChiXm1nT3E2WnNnL11BOWVlXkkmOV4iKTpba24zITBDZWkoWW8nJUQ9MikzbmJiMF1cTEQnYj9lXjInUjBAUVBFJTVNVS0nbzBcRypjXiFlZ10mRVNFKVlaO1ZmImwmITthdTBeYCtFU25ybiRDKGo7LGhkcW81bEkkLUJoQzk7NT50cGZpQGxUPUI0bnBqKltSOmhQTidSR1p0JDVbTixgYWVrQittPlpWWUluaWo0a0RBaS46USJWSFxyZCxZaEtYTUJfR3AqcmxjJ0dQPVRDMkVcamBKNW5mL1EzbilvcVIvZkciRzE6XkJhVSRqLSo7QjNpKWVwJyYwPFVfLSVbRUtTUEkxbWFdOzQ6MHNDLUZMSklpQE0wRFtDMSteMGI1X1RAKFdPdTxXNEVlQydqRV87QGZJYzI6JUtyUCJaOnVRX004cSlAS1tUTi5ocz1UJ2JRLTlVQnE0RGI4aSFRPislNDtdLFlNM1Fga0RAOUFHP1I9YCwvPC5RXDNLKThUMm5WJzk1ZTdHQEo/JTRiNEolR01xYjovSi8zYXQyPVsxNkBXcV1DSjNPMylEOU4mNCZtWzQ1WFMoViRfSU0uMSlWND4zIzVcLmEnSWdwSCk8JnB1a3JuamY5WywsVFcvMF4jTClPT18wa2MhYF0oWTJaVXE2aU5eLW9UUkgnWFJdT24/MC0zWzhSODJrUGlYZVYociQpQlFJQXR+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMDIgMDAwMDAgbiAKMDAwMDAwMDIwOSAwMDAwMCBuIAowMDAwMDAwMzIxIDAwMDAwIG4gCjAwMDAwMDA1MTQgMDAwMDAgbiAKMDAwMDAwMDU4MiAwMDAwMCBuIAowMDAwMDAwODYyIDAwMDAwIG4gCjAwMDAwMDA5MjEgMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8ZTQ2YTlkOGUwNmFhYzAwYzY3MjczMjhhMmIyMDM5ZGQ+PGU0NmE5ZDhlMDZhYWMwMGM2NzI3MzI4YTJiMjAzOWRkPl0KJSBSZXBvcnRMYWIgZ2VuZXJhdGVkIFBERiBkb2N1bWVudCAtLSBkaWdlc3QgKG9wZW5zb3VyY2UpCgovSW5mbyA2IDAgUgovUm9vdCA1IDAgUgovU2l6ZSA5Cj4+CnN0YXJ0eHJlZgoxOTE3CiUlRU9GCg==";

const PDF_INVOICE_OAC: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA4OTIKPj4Kc3RyZWFtCkdhdFUxPyNTRk4nUmU8MjM3QE1ePEtQNFxqITkkay9NM100PS1fb1pkVSNVZEJmW1ZtSSIzXjZhJW9HMyJVXz9lS0c1WVxTOXNcN2tMcCVzQ2xuSzQtLD1lXmRqa0pkJk8oZSNNXW9hTEFTQjtJQWUwSVVfXXNLNjBmU2BgTkk1SzJMRm44WztNNT9PWTotP087KDBzM2skOyxJVipNNTM7UjI2Kz5jO0U4ImxWOFMnLTYjZlxESWU1IjRkVi5fSWFdalpiKjJecURzL2dnKkdWO2MnVjo4JyRiQExhdWl1OSxyKGoxZC4kOFdtUTgvMSFMcy9tQyopTytBY1RpVTtLNGJyUllmK0NgMSg9NVMxXlk+KXUsKCxjK3BNb2c3QG4hYkFULVwoPCtdRVwyR25USTgycS1iXS5ANGYmTEZPViJOKzxiaVEoJm4/PThPazctTTdIc2hSP0hQTDslO1MiXVwva21TT0Fbbl1vI0hKNUclYiFpXjdoVkg+Mk5oPkBqNT1vUUxNUlJqSDVCbD1qY2hhOiNmZDNJRzc/NVdNRnNUcjkpMFY/JV0tP1NISV1BUDhyc09dOiYuOzhuQ2tZYWJrInBjS1w+NkNDZkVqSF8iU1w1bG87TEA9SHMtUi1sXkBCYCdeJWE5I1B1cTtUQ1Y0QU1UUTNMQWBwXE4tU3NTSDEtcChjKTpVMVU6KD8wVzc2OWtsRl5gOEBvLCpsSE9dOCdmIXQ9KCpLWChfJWUraiJMU0BGJUVmJWdNSzBdSWo8TDRiMUk3S0RbQmdlKFBQZkwqY2NJLVE0ZWNQV1w3QGkhJj9CUzwmXFpwNGZfaT8xZmlPQj1kUlQ7YktXR00pPWNTMU5dPlJIMVdQXjQxRFBCW1s4LlxSPWEkN3BaOXA9WCllQV9TOl9HWWZJa1pWaTRELnNXc0hFJDErQmtkPF9HZ2UnNz0oXi8kbi9zUFtbYkciZFlsSzZnKiJxMS5bPyRiQEcvTWY8cWhzWXBLTEBxVW8sXSpKJFdaOS1dX1JjcU5NKEM/LzhOTjVNUkhkJjUnMjgjIVJOWVMnLW01NlQoNTo6PFVPXTtjLy5sRzUkKUxzKVYrTUwsLCo+Pm0uNjRZbjRUV2RdQHNnR2NGWWl1R0cyXFdVSilNXVNuPGk8YGJWPzhYMzdbWUZHZXMuVzMrQzYvfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTE0IDAwMDAwIG4gCjAwMDAwMDA1ODIgMDAwMDAgbiAKMDAwMDAwMDg2MiAwMDAwMCBuIAowMDAwMDAwOTIxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPGQyOGE3YTAwMWI2NWIzNjBiMzk0ODM2YjFiYTMyYTFmPjxkMjhhN2EwMDFiNjViMzYwYjM5NDgzNmIxYmEzMmExZj5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMTkwMwolJUVPRgo=";

const PDF_INVOICE_TAX: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5NjUKPj4Kc3RyZWFtCkdhdG05PyNTSVUnUmVUOjM1QEY7LnI6S0gtcWBwVm8kSVpgWkRNYUlDXyhsJD5XUUZEUDZqW3MyNlwvZU9ITlBzTTdtTDwlIz4qUG1RTDw3RiVIXT8hWkpoWyJgUmAsb2ZFTic6c1ZGUWBfZysmRDRUSDByPnBqJTY6bylXaj88bCsiUlwwLlkobWtRYj45a11xQWZZXytVVl4mN1hDZy0kP2hGW24pW0ksOlc/IiNlVW9XSl9SNENwSERdRGc7MUNuMS5PPXFaSSwlSUgtRzMtY1EmQ0UmIVVYSTo/JW1yNzYwTF9gLV9uOkI4ZFc9ajI2QnFTLEpDTWktVmgoRSFTJUhXbipxbmlLPUlrMUxhTik0KnJtdC9yYU9vckNhUGRVJENbJDZNTXJHOXIqVUNCakRLMU0vQDI/ME8oSmdES100MnRXMktoTE9uJChsJ0Uwc2RjT3BuUDAjLmhxSmQwaVEsU0hnXlxOKWt0LiZwXik+Sj9hSE5JKDg2XjknPk4oKF9aRFNYdTtVWChNYyhdXCtdUkQ0OC9ZOTlOPEAjVWBeSFxHZyFeI1NaNkcyb20tTlhFXVxEaFI4dWxXViNJRTBRUDFJaUFnKz9dQE1VcCY+Nlo9TF1FTEU5OTQ1RVRYT2xcQDctRidgJXNtLlgpMDZZJl83OjRTXz4lRTRLYylbMixfJlIxPzsrOjY/IkpXJXBDUSlsOjFSKWcvIV01UmJsNktCRlFUPUlqPGlHOWw4QTtdbVR1LC1uISEkZCMrKU1eQVRaUSJ0RUNKXSxqPW01bj48NiNdXyQ3bStBcSs5S29qQ1Q3aVNvaGdQSWBESWBeMidtUyJYQWNiXzlyW09USV5MPU5YcWM6SjA9X0xUZ0MxZzwhS2trOmlROkQiVi5WJjojcXBFOShgYyg1IW1hIjZvJEtUMVFUM2FPa15eIk5AUGstRVRuZ2khW2xYZU5yUGsiXmNTJURKVC5kJFYpZEIkYUFMZDA8ImpXbCkzQU0jWm9MTVEzZUtAPFI5YlZcIkItcUpdSTpqYS5qUiU+VDxiOiFvOGlWcSMncHA3WzdHPEVhY18kZG1IQGRxWmtaTiUlT2srLWRGQEpaLzklcnFoaClLIXQwMl8tR1RERlVpP2RVUWlNTFVmPWtiZDsyWjokXTRVSmVLbkU5ITwxXT0kX2xfZzw7U19SXihqIi8/SkI2UmheJEE7Ny9TTG9USl8nUjE+JU1ZNVhkUWxIZG9WJ2FoZTRdIlhpLFkxNiJMbTRMIjpycj5TOWtiXH4+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMjA5IDAwMDAwIG4gCjAwMDAwMDAzMjEgMDAwMDAgbiAKMDAwMDAwMDUxNCAwMDAwMCBuIAowMDAwMDAwNTgyIDAwMDAwIG4gCjAwMDAwMDA4NjIgMDAwMDAgbiAKMDAwMDAwMDkyMSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxhYjY4ZTdlYWQxZGM1ZmJiOGNjZDE2Y2FiMmEyMDMwYT48YWI2OGU3ZWFkMWRjNWZiYjhjY2QxNmNhYjJhMjAzMGE+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDYgMCBSCi9Sb290IDUgMCBSCi9TaXplIDkKPj4Kc3RhcnR4cmVmCjE5NzYKJSVFT0YK";

const PDF_CONTRACT_REYES: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMjQ2Cj4+CnN0cmVhbQpHYXRtOmdNWiUwJ1JcTTYlIl0waSQ6Y1VFKFgnb25qJzklRkRWTnU4a2U3bF5CVU8lMjg+SlVNbkhTM3QoU2lUMC5wbCxHblVrTTozXSJmNGtPPWldNmpWZUQ3MFNXa0koMT1CJ19yXm8lViJMa0VMaEdQP01iNUswTElsPiJWYURlNGFEMyhLTy9vYEkjVlUtJ1I+QkMyXFwqVTMwW1NcSic7WTZFRzlDOFYwWmBDLiNFazlrJjBibnEjZzJbL189KG1DUUMtLDNrY1xMQFM6MzByVG9dbS82QHBkQTxgN1o8QTM6Zm5lWVZCZ2tddFQzKCFZO0ZvZFElSWFSazpDNisiIUQ3cVtvO1xEZiJPPGhxXjhAJTNqTjc1MSQ+UGw+M0dFQD5halVsbjIhZzcuRSo/cDw3S1Q+JzpITWMqUjAhSVs0VV4waVdEP2olRVBEM1syajw/YiNMYmtyTSY6VCddQzlZdHBMYC4idEVFaz5ZVkRdUCFkI2IsbEVqT2IxW2QkdFU+RjtuWlkpYlVKKnUiXDw7RyFXZEA/YHNFUzpKYDcyTHE2OkQvXms1Oyk0aGwrQkUzK2laSi0hLl11Zzg+RjVIUjhqZz9vZG44anAwUzpWWjBrTiliSyEwLWkjUGIxR1hDTmhBXm42LDdcKnNJSG1wVTFeNUViR3IyOUZZQVA4RFMmWzkhIlFJTktoQCstPVM6O3MqcSwiTG91M1AhZExhOiRLXGNNJ1IoZ1lnTG1iVGk3cEpmPXUlQiclPSM+aD9bWiJELloqZWM3bjpELllaVldGN0FYbTJGOSNNKEsvY1ddS1YsMy8kKWlVQF1pakZPMCElXmVrUEQ1Y0ZeSDM/TGtzSDs2VVs6MjJoPzErZTo/ZUsuKUMqKUlfb1Biay1oNClvL1xTT0dlWWw+VltIU25bWD8zWERHXmk4dTYqMUwxPU8+VjFpL2ojZ0wnQzsyckUxQj9SLFBoWklDXE0jJUYhMUhAST5hRyNlYmQ3ciRJLkVOMG0vZDNtZlZUYE1KbDxrMkxPamglWilvaD5EIj5pQHIuVUVKKCYqND81JixQMWxvVG9OY1dcRU5CK21XSjMjLlVncVcwbE9FVFBAVk0vJ2YqPTtcRVFZcS11UVFoK1NvOEA6NT5tQUJBJFpsZitNXlJXO1s+KV9XYiwoOUBYY0F0aWc3OyR1bzg6dEBWXi0jNEw2TWxdZCs+VCRTOl01UjBULyI/Sk1PJFo2S1o3WVY0XiFvWiNTXEpgM09iQiVXRG4zU3FqVE4xcHAiTU0jLTZPM1JfLlhMKTlYNnFzTC1aW1VwaWJRODR0Lk1fbjEyNFBbNHFCbWAhZDxPLTlrNCJwPFtDczg4JmZgKiJQcjlDcENfNkJDPC9eLyIlcUpYcjdjckVPaSczSzBRSnQ0WFNRISl0bDdtZzdMS1ojQi9MPV5BWzchJCEocyVgUklZcUx0WE48YVFxQUsnVFtFOjpkZGVBOypmMlA0MGFtazFuKiRPbEJsMjw9WDY5PylQdCgyTS4hXkpmcEZicHJdXXUtL08sNkMrVDxKUS5CJ2pHcVZyQSpJa3RqNlB1bC9CTm1DXlpwLTZAMklpXDdbNjt0RDlqXjBhW2NbJ2ZiK2dWK15vcz89aUdsSWlPZUBXZH4+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMjA5IDAwMDAwIG4gCjAwMDAwMDAzMjEgMDAwMDAgbiAKMDAwMDAwMDUxNCAwMDAwMCBuIAowMDAwMDAwNTgyIDAwMDAwIG4gCjAwMDAwMDA4NjIgMDAwMDAgbiAKMDAwMDAwMDkyMSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzwzMjEwYjkwZDM1ZGIyN2U0MzgxMjE1Y2U1NDEyMTAxZD48MzIxMGI5MGQzNWRiMjdlNDM4MTIxNWNlNTQxMjEwMWQ+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDYgMCBSCi9Sb290IDUgMCBSCi9TaXplIDkKPj4Kc3RhcnR4cmVmCjIyNTgKJSVFT0YK";

const PDF_WARRANTY_BOSCH: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA5NDkKPj4Kc3RyZWFtCkdhdD1pPyNTMUcnU2MpSi5wYE1nJ3NyXElxLkwtcFsrZiEoSjNiRFM4QSJEVGUoMFc1UkBVRVlpbDw4a0Q8XTFbQzJbUzNDPlNRUE8xXjVrNVFLQSFaUCIrUUdrJE4+RU1RTzthSClFaGklNFA9XiRcKW5yO2knKTdvanJGVCI+OzpCJjVMUUJ0LE5cPjJtTD8lTltTRWNDSUduOGYvZFBddTQhQDhSIS0yOTxFMC1lUHIhQ3JVQzxcR0dOUGpcMWNeKlNXTmZHJFtGQydqPD9WOE1qQVxJX1lKMmVMJ2RiQzFjK2REUEIzOFtPdGBvOTY0MCE/YEpJRDgoSS9xUXBUJEIrYDx1QTROT0lPPEdjal4xMVt1bCZkVDByUjJCTV5JJVw8RDgkXWo4W2tIZV1cbjM2YXVOOzUwXVM2dDAiV2RWOUMnSU8vX0AuSFJVTGosI29wTDE5OW9rN2hQPVBLNEdFNHA/R2UuNCpRSztnYV9EME8mbDIwM3NHQSFdRXVcbVJfOVxfRDdQT0FkYEFAM0gnPEwna1dgKzA/LEpyXkohPkZKPWpdIlJqP0RTK1xEaDorNjUwMVJEKTBkY2U/Y2xCYl9rZjsmOGlbb2pSRkloXUlWX11aYUpOJE88W0MkLGs0a0BBUGZTIio4PC1LLnJFSiVDKjspcmovOWRAZiVZYGghViNwcTBGNiVSRkFua28yQjgtO25FL09DaDkwKmsqP15QY1tBT0ZKJU0/Y09GJCgjaClCdSVLX1UubmtSVTdWcmU3ZD4zQ1RBVyQ/XWhLRmJtKWlRIz4lZCVIcl1oSVUzJlxaZ2BjOzo/XEEvIktObkNNWEgnIjxSJkM1RjI7UVEuVT1gXHVaQi09aWo/UFRsT1JePmZdZ29QW2dKOGMkOkN0X1VLPnM3OVI9QEt0LE5XMkU0SiJaWC9mVzNeOC48LSxmPjVLWChEP0tdLj84Wl8qTD5iNiZrZjZMVUNRTTZRPSVALEV0Wid0LSUxU2ZCUldTUE1yKU8mJjZjRE1GMSgrQ148KFwkVSRXY2VFSFFrVFNSRCVoSzQwVCctLHBDWWNJPWYoTlhcbG8jVjNtMm8hSG9HbmctUz5NUCQoL2doP2NJJT9QQnBFMiVjJllhTjQtcFsjUSc2ZElWQScxQj1kYkpSVidzXG1vJ3E6MDZMRF50bUhRXW9GdU5BaWxmZ0otU3Q7WltKI2RJUCNkcVVYVz5lNC9BRjx0dEUuMWdAaCVddFoyYD9bPEJgfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTE0IDAwMDAwIG4gCjAwMDAwMDA1ODIgMDAwMDAgbiAKMDAwMDAwMDg2MiAwMDAwMCBuIAowMDAwMDAwOTIxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDI0YWIxMGNkZDhmM2MwZDQ2ZTJjNmEzYjRiNTMxYTVkPjwyNGFiMTBjZGQ4ZjNjMGQ0NmUyYzZhM2I0YjUzMWE1ZD5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMTk2MAolJUVPRgo=";

const PDF_RECEIPT_AMAZON: string = "JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChcKGFub255bW91c1wpKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL0NyZWF0b3IgKFwodW5zcGVjaWZpZWRcKSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODAxMDYyMjU0LTA0JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKFwodW5zcGVjaWZpZWRcKSkgL1RpdGxlIChcKGFub255bW91c1wpKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMzcxCj4+CnN0cmVhbQpHYXQ9Kz8jU0lVJ1JlVDozNUUxJC9SayRBLXFgalRSWFZBRVtcXjZaQD1WXWVSQmI7YFAiU1lIMVtOLW1xUVEvQ1luWlhxIWlYI1NGIlpwWEdTcW5YPVNrZUReaEpCOm1oY20zRVg9KEs1XVZVZ00+LFFkMEZVZWVXPis7XmZBOVQ0KTVGRS9ta2o5M1JPOlYyYGYjJFxTMk5MIjJfPXNjQVNwdDg+bzhKLVBGPz1KU2chb11qRVwpSS1oI09ALCZzaG1qO3RkRFwvVGovWGpYXl5KOnMuOWFXQSteJylucj5yaGg7PFdlIz1SczUzNUpraDs8TlpuKmdjXURiNjtAPXQiWkR1QEZyZTEic15qNFwjPGtSZi5PYVdoPy9LTnNBaXFyNTpqWmtNJSZUYGRmRWZjcGxZRWRuckEmSXVxJF9taFhWQW80M1FZZTNddTdTSkU3LT1oUUFxJmByIjB0PycsX2lrMi5SaWJLYydkRGQ2YV87OzcpRFNLbTI1R2xyLT9mLWpdWz4iRSxxI0FQUUsodVlYPUZOcSFgJDlnN1opI2ZBZHM2dWF1MmY1aiEydUheRjI7Y2xTLU0+MXRTLVk0cj48YilqPXBsTiY/T24mVzFmbSZtc0Q7ZzxWQSlQa3InajdbbSFcX1JON0E2Yi4hIUQ9MkdcK19YZkY7cEplXC90W0tsQEcoWkBJL2tCPlBkKFkkczZjZD0nYj5BazgwNiJuTUBuLWErM2hwazBQPE4rVUpEN1Q6b18xX2QxPU8obXE5TmpGJGBWZyglJSpUZ3MrbHBKNUhydFwhNiY2OT9kS04nR0BDcCVbclZXa0JFVG4laVtFP0pCRjI7ZT50NEhYXV08MClCVDwhQ2ZYYDBsYD4lUUdlNzNdLyFLLUQjYChVXGgjRC9UM0FaLy5ecC5ccWhicyVKLUUmJiwnXm9GbjpfND9gXmUtbicsXTlsRy5cY1heT0JZWDdETFhdci8pVCFPLmpURk46O0JDP0IqSCI6ZFtMRiZeNzkoX0g4WGhwYkpvOWJDZ2UiJk0sOHRULW1HOj5RIWdvcjBEaHFxblAqKTBBJzU8ZmtHO0NSNVs/RXUjTk0tXEYuWVxBN2FFdSlVUERQRjYuRDldLVhcNmZUXFhNOEcmYyEtJ01gTE5YWTtQanIsQjZoOUtKVjs+Rkk7RjRfdTtaaVNmVWwtWFw1O2xgKU4yKkFedFAyTDhqYT88KCE+aDpgUFFrO3A6OyFUV2ZARixoa2lrIWs7R3EqcD44WVIwPjhUSGNxN2ZLXidsISVYYlNpWClPT0ZlNHAnYz8hOiUvQik9bz81XE9hYmNQaU0yMilXKS5BTTQnT1VeUFAnMF1DUFNXLCFeLSkqSy9OSmZSPE5RIlthWE0yTWhBImlBU05nclgnQztUNEsiYDBsYSU0RF9ALlg9XWY2bHBkdHI4VmBCTTxMbDRaaGgjXzQ4QnNZMU9KVTpAJTttczhOdV1kI2pAQj5yTkYsVWordFcnbG1NVkRjNFw/TChBckQqYTBsJDpuSW4zRiUjdHJCJXIlKWNPcmZdZW9pSldqLCtPVUk0WydHTWpxQEY5QSwsJShDNFwocEhSLVA7PStFZmNqXTBJI3BMcyJEO1hXOCJdaDtmV2cuI1MlMiFAJCxfW1kzQmMuXTxwbF88QTw7Kis6XUFhQCEnMylsc0xccHVaKVxPZycxW2tjPTBYKidHRVY8dV09bWI+JCIoMFJucWhKRGMsLz4rJDNQdEExJWc8SDYlXUlQUXRsY1FTKVcmNyQ+OXRSSlg6dDcvMywoIl9ZXWAuczlYJypbfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTE0IDAwMDAwIG4gCjAwMDAwMDA1ODIgMDAwMDAgbiAKMDAwMDAwMDg2MiAwMDAwMCBuIAowMDAwMDAwOTIxIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDE2OWRiYWI5ZTViMjMwZTlhZGRhYmRjZDliYTFjMjhjPjwxNjlkYmFiOWU1YjIzMGU5YWRkYWJkY2Q5YmExYzI4Yz5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMjM4MwolJUVPRgo=";

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

interface EmailSpec {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  dayOffset: number; // days before "today" (negative = past)
  hour: number;
  pdfAttachment?: { constB64: string; filename: string };
}

// Builds an RFC 2822 raw message, MIME multipart if there's a PDF attachment.
function buildRawMessage(spec: EmailSpec): string {
  const date = new Date();
  date.setDate(date.getDate() + spec.dayOffset);
  date.setHours(spec.hour, 0, 0, 0);
  const dateHeader = date.toUTCString();

  const headers = [
    `From: ${spec.fromName} <${spec.from}>`,
    `To: ${ROBERT_EMAIL}`,
    `Subject: ${spec.subject}`,
    `Date: ${dateHeader}`,
    'MIME-Version: 1.0',
  ];

  if (spec.pdfAttachment) {
    const boundary = 'seedBoundary_' + Math.random().toString(36).slice(2);
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      spec.body,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${spec.pdfAttachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${spec.pdfAttachment.filename}"`,
      '',
      spec.pdfAttachment.constB64,
      '',
      `--${boundary}--`,
    ];
    return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"');
  return headers.join('\r\n') + '\r\n\r\n' + spec.body;
}

async function insertMessage(accessToken: string, spec: EmailSpec): Promise<{ ok: boolean; id?: string; error?: string }> {
  const raw = buildRawMessage(spec);
  const rawB64url = b64urlEncode(textEncode(raw));
  const res = await fetch(GMAIL_INSERT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawB64url, labelIds: ['INBOX'] }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err };
  }
  const data = await res.json();
  return { ok: true, id: data.id };
}

// ── The 39 seeded messages ──────────────────────────────────────────────────
// dayOffset: negative = days in the past relative to "today" (seed run day).
// Matches the gist descriptions in docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md
// section 5. Conversations are inbound + Robert's reply, both landed as
// received mail for simplicity (Robert's "reply" shows as a second inbound
// message quoting his response, since Gmail import doesn't distinguish
// Sent-folder placement the way a live compose would).

const MESSAGES: EmailSpec[] = [
  // 1. Tom Reyes — framing photos
  { from: 'tom@reyesbuild.ca', fromName: 'Tom Reyes', to: ROBERT_EMAIL, dayOffset: -13, hour: 10,
    subject: 'Basement reno — framing photos',
    body: "Hi Robert,\n\nFraming's done on the basement — a few photos attached (not shown here, sent separately via text). Before we close it up with drywall, can you confirm the outlet placement on the south wall? I marked where I think you wanted them but want your sign-off.\n\nThanks,\nTom" },
  { from: 'tom@reyesbuild.ca', fromName: 'Tom Reyes', to: ROBERT_EMAIL, dayOffset: -13, hour: 14,
    subject: 'Re: Basement reno — framing photos',
    body: "Robert Sinclair wrote:\n> Outlet placement looks good, go ahead with what you marked. One more near the TV wall if there's room.\n\nTom Reyes: Got it, adding one more near the TV wall. Moving to drywall this week." },

  // 2. Priya Nair — budget review numbers
  { from: 'priya.nair@kellertfife.com', fromName: 'Priya Nair', to: ROBERT_EMAIL, dayOffset: -13, hour: 9,
    subject: 'RE: budget review numbers',
    body: "Robert — can you have the Q3 budget numbers ready before our 1:1? Want to go over them together before I take them upstairs.\n\nPriya" },
  { from: 'priya.nair@kellertfife.com', fromName: 'Priya Nair', to: ROBERT_EMAIL, dayOffset: -13, hour: 11,
    subject: 'Re: RE: budget review numbers',
    body: "Robert Sinclair wrote:\n> Yep, I'll have the Q3 numbers ready — pulling them together now.\n\nPriya Nair: Perfect, see you at the 1:1." },

  // 3. Nadia Farah — Montreal trip dates
  { from: 'nadia.farah@gmail.com', fromName: 'Nadia Farah', to: ROBERT_EMAIL, dayOffset: -12, hour: 19,
    subject: 'Re: Montreal trip — dates',
    body: "Hey Robert, the dates work great on my end! Are you driving up or taking the train?\n\nNadia" },
  { from: 'nadia.farah@gmail.com', fromName: 'Nadia Farah', to: ROBERT_EMAIL, dayOffset: -12, hour: 20,
    subject: 'Re: Re: Montreal trip — dates',
    body: "Robert Sinclair wrote:\n> Driving up, should get in around 2pm.\n\nNadia Farah: Sounds good, see you then!" },

  // 4. James Okafor — one more coffee
  { from: 'jamesokafor@gmail.com', fromName: 'James Okafor', to: ROBERT_EMAIL, dayOffset: -3, hour: 8,
    subject: 'One more coffee before you head back?',
    body: "Hey Robert — heading back to Toronto this afternoon. One more coffee before I go?\n\nJames" },
  { from: 'jamesokafor@gmail.com', fromName: 'James Okafor', to: ROBERT_EMAIL, dayOffset: -3, hour: 8,
    subject: 'Re: One more coffee before you head back?',
    body: "Robert Sinclair wrote:\n> Yes! 9am, usual place?\n\nJames Okafor: Perfect, see you there." },

  // 5. Linda Fournier — book club pick
  { from: 'whwh2207@gmail.com', fromName: 'Linda Fournier', to: ROBERT_EMAIL, dayOffset: -9, hour: 17,
    subject: 'Re: book club — this month\'s pick',
    body: "Hi Robert! This month's pick is confirmed. Hosting at my place, same time as usual.\n\nLinda" },
  { from: 'whwh2207@gmail.com', fromName: 'Linda Fournier', to: ROBERT_EMAIL, dayOffset: -9, hour: 18,
    subject: 'Re: Re: book club — this month\'s pick',
    body: "Robert Sinclair wrote:\n> Sounds good, I'll bring wine.\n\nLinda Fournier: Perfect, see you then!" },

  // 6. Marcus Webb — annual review reminder
  { from: 'marcus.webb@rbcwealth.com', fromName: 'Marcus Webb', to: ROBERT_EMAIL, dayOffset: -7, hour: 9,
    subject: 'RBC Wealth — annual review reminder',
    body: "Hi Robert, just a reminder of our annual review coming up. Could you bring the updated RESP numbers for Maya and Ethan?\n\nBest,\nMarcus Webb\nRBC Wealth Management" },
  { from: 'marcus.webb@rbcwealth.com', fromName: 'Marcus Webb', to: ROBERT_EMAIL, dayOffset: -7, hour: 10,
    subject: 'Re: RBC Wealth — annual review reminder',
    body: "Robert Sinclair wrote:\n> Will do, I'll bring the RESP numbers.\n\nMarcus Webb: Great, see you then." },

  // 7. Elena Sinclair — pick up Ethan
  { from: 'elena.sinclair@gmail.com', fromName: 'Elena Sinclair', to: ROBERT_EMAIL, dayOffset: -11, hour: 8,
    subject: 'Can you grab Ethan Thursday?',
    body: "Hey — can you pick up Ethan from practice Thursday? I've got a staff meeting that runs late.\n\nElena" },
  { from: 'elena.sinclair@gmail.com', fromName: 'Elena Sinclair', to: ROBERT_EMAIL, dayOffset: -11, hour: 9,
    subject: 'Re: Can you grab Ethan Thursday?',
    body: "Robert Sinclair wrote:\n> Got it, no problem.\n\nElena Sinclair: Thank you!" },

  // 8. James Okafor — coming into Ottawa
  { from: 'jamesokafor@gmail.com', fromName: 'James Okafor', to: ROBERT_EMAIL, dayOffset: -8, hour: 12,
    subject: 'Coming into Ottawa next week',
    body: "Hey Robert, I'll be in Ottawa next week — VIA Rail gets in around 3pm. Any chance you could grab me from the station?\n\nJames" },
  { from: 'jamesokafor@gmail.com', fromName: 'James Okafor', to: ROBERT_EMAIL, dayOffset: -8, hour: 13,
    subject: 'Re: Coming into Ottawa next week',
    body: "Robert Sinclair wrote:\n> Of course, I'll be there.\n\nJames Okafor: Appreciate it, see you then!" },

  // 9. Grace Lindqvist — holding 30 min
  { from: 'grace.lindqvist@kellertfife.com', fromName: 'Grace Lindqvist', to: ROBERT_EMAIL, dayOffset: -13, hour: 8,
    subject: 'Holding 30 min — budget prep',
    body: "Hi Robert, I've held 30 minutes on your calendar before the 1:1 with Priya so you have time to prep the budget numbers. Let me know if that doesn't work.\n\nGrace" },
  { from: 'grace.lindqvist@kellertfife.com', fromName: 'Grace Lindqvist', to: ROBERT_EMAIL, dayOffset: -13, hour: 8,
    subject: 'Re: Holding 30 min — budget prep',
    body: "Robert Sinclair wrote:\n> That slot works, thanks Grace.\n\nGrace Lindqvist: Great, it's on your calendar." },

  // 10. Tom Reyes — Invoice #4471 (PDF)
  { from: 'tom@reyesbuild.ca', fromName: 'Tom Reyes', to: ROBERT_EMAIL, dayOffset: -13, hour: 15,
    subject: 'Invoice #4471 — Reyes Build',
    body: "Hi Robert, attached is the progress invoice for the basement reno — $4,200.00, due in about two weeks. Let me know if you have any questions.\n\nTom",
    pdfAttachment: { constB64: 'PDF_INVOICE_REYES', filename: 'invoice-4471-reyes-build.pdf' } },

  // 11. Reyes Build — signed contract (PDF)
  { from: 'tom@reyesbuild.ca', fromName: 'Tom Reyes', to: ROBERT_EMAIL, dayOffset: -15, hour: 10,
    subject: 'Reyes Build — signed contract copy',
    body: "Hi Robert, attached is your copy of the signed basement renovation agreement — scope and total ($18,500) as discussed. Looking forward to getting started.\n\nTom",
    pdfAttachment: { constB64: 'PDF_CONTRACT_REYES', filename: 'basement-reno-contract.pdf' } },

  // 12. Hydro Ottawa bill (PDF)
  { from: 'billing@hydroottawa.com', fromName: 'Hydro Ottawa', to: ROBERT_EMAIL, dayOffset: -14, hour: 6,
    subject: 'Your bill is ready',
    body: "Your Hydro Ottawa bill is now available. Amount due: $187.42, due in approximately two weeks. See attached PDF for full details.",
    pdfAttachment: { constB64: 'PDF_INVOICE_HYDRO', filename: 'hydro-ottawa-bill.pdf' } },

  // 13. Bosch warranty (PDF)
  { from: 'warranty@bosch-home.ca', fromName: 'Bosch Home Appliances', to: ROBERT_EMAIL, dayOffset: -10, hour: 11,
    subject: 'Warranty registration confirmed — Bosch dishwasher',
    body: "Thank you for registering your Bosch dishwasher. Your 2-year warranty is now active — see the attached confirmation for full details and expiry date.",
    pdfAttachment: { constB64: 'PDF_WARRANTY_BOSCH', filename: 'bosch-dishwasher-warranty.pdf' } },

  // 14. Autodesk invoice (PDF)
  { from: 'billing@autodesk.com', fromName: 'Autodesk', to: ROBERT_EMAIL, dayOffset: -12, hour: 7,
    subject: 'Invoice — AutoCAD licenses renewal',
    body: "Kellert & Fife Engineering's Q3 AutoCAD license renewal is ready — $1,860.00. Forwarded for your approval before payment. See attached invoice.",
    pdfAttachment: { constB64: 'PDF_INVOICE_AUTODESK', filename: 'autodesk-autocad-invoice.pdf' } },

  // 15. Amazon — order shipped (no PDF)
  { from: 'auto-confirm@amazon.ca', fromName: 'Amazon.ca', to: ROBERT_EMAIL, dayOffset: -14, hour: 16,
    subject: 'Your order has shipped',
    body: "Good news! Your order (Ethan's soccer cleats) has shipped and is arriving soon. Track your package in Your Orders." },

  // 16. Amazon — order receipt (PDF)
  { from: 'auto-confirm@amazon.ca', fromName: 'Amazon.ca', to: ROBERT_EMAIL, dayOffset: -11, hour: 17,
    subject: 'Your order receipt',
    body: "Thanks for your order! Attached is your receipt for basement reno paint and supplies — $312.55 itemized.",
    pdfAttachment: { constB64: 'PDF_RECEIPT_AMAZON', filename: 'amazon-receipt-reno-supplies.pdf' } },

  // 17. Ottawa Athletic Club renewal (PDF)
  { from: 'billing@oac.ca', fromName: 'Ottawa Athletic Club', to: ROBERT_EMAIL, dayOffset: -11, hour: 9,
    subject: 'Membership renewal',
    body: "Your annual membership renewal is ready — $840.00. See attached invoice for details. Your membership includes gym, pool, and group class access.",
    pdfAttachment: { constB64: 'PDF_INVOICE_OAC', filename: 'oac-membership-renewal.pdf' } },

  // 18. City of Ottawa property tax (PDF)
  { from: 'tax@ottawa.ca', fromName: 'City of Ottawa', to: ROBERT_EMAIL, dayOffset: -5, hour: 8,
    subject: 'Property tax installment due',
    body: "Your quarterly property tax installment is ready — $1,140.00. See attached invoice for the due date and payment options.",
    pdfAttachment: { constB64: 'PDF_INVOICE_TAX', filename: 'city-of-ottawa-tax-installment.pdf' } },

  // 19. Osei Dental — appointment confirmation
  { from: 'frontdesk@oseidental.ca', fromName: 'Osei Dental', to: ROBERT_EMAIL, dayOffset: -14, hour: 13,
    subject: 'Appointment confirmation',
    body: "This confirms your dental cleaning appointment with Dr. Osei. See you soon!" },

  // 20. Rogers bill
  { from: 'myaccount@rogers.com', fromName: 'Rogers', to: ROBERT_EMAIL, dayOffset: -13, hour: 7,
    subject: 'Your Rogers bill for July',
    body: "Your July bill is ready to view — $214.99. Log in to My Rogers to view your full statement online." },

  // 21. Enbridge Gas bill
  { from: 'billing@enbridgegas.com', fromName: 'Enbridge Gas', to: ROBERT_EMAIL, dayOffset: -6, hour: 7,
    subject: 'Your bill is ready',
    body: "Your Enbridge Gas bill is ready — $96.30. View your full statement online at enbridgegas.com/myaccount." },

  // 22. RBC Wealth statement notice
  { from: 'statements@rbcwealth.com', fromName: 'RBC Wealth Management', to: ROBERT_EMAIL, dayOffset: -13, hour: 6,
    subject: 'Your RBC Wealth statement is ready',
    body: "Your monthly account statement is now available. Log in to view your full statement online." },

  // 23. West End Vet — checkup reminder
  { from: 'info@westendvet.ca', fromName: 'West End Vet', to: ROBERT_EMAIL, dayOffset: -12, hour: 10,
    subject: "Biscuit's checkup reminder",
    body: "This is a reminder of Biscuit's upcoming checkup. Please note vaccinations are also due at this visit." },

  // 24. CRA Notice of Assessment
  { from: 'noreply@cra-arc.gc.ca', fromName: 'Canada Revenue Agency', to: ROBERT_EMAIL, dayOffset: -9, hour: 8,
    subject: 'Your Notice of Assessment is available',
    body: "Your Notice of Assessment is now available in your CRA My Account portal. Log in to view the full document." },

  // 25. Bloodwork results
  { from: 'noreply@westboroclinic.ca', fromName: 'Westboro Medical & Dental Clinic', to: ROBERT_EMAIL, dayOffset: -8, hour: 9,
    subject: 'Your recent bloodwork results are ready',
    body: "Your recent bloodwork results from your annual physical follow-up are ready to view in the patient portal. Nothing flagged as urgent." },

  // 26. Parent-teacher booking confirmed
  { from: 'noreply@ocdsb.ca', fromName: 'Glebe Collegiate', to: ROBERT_EMAIL, dayOffset: -12, hour: 8,
    subject: 'Parent-teacher booking confirmed',
    body: "This confirms your parent-teacher conference booking for Ethan. See you then!" },

  // 27. VIA Rail booking confirmation
  { from: 'etickets@viarail.ca', fromName: 'VIA Rail', to: ROBERT_EMAIL, dayOffset: -7, hour: 11,
    subject: 'Your booking confirmation',
    body: "Your VIA Rail booking is confirmed (Robert Sinclair CC'd — booked for James Okafor). Have a great trip!" },

  // 28. Costco receipt
  { from: 'receipts@costco.ca', fromName: 'Costco Ottawa', to: ROBERT_EMAIL, dayOffset: -12, hour: 19,
    subject: 'Your recent receipt',
    body: "Thanks for shopping at Costco Ottawa! Your itemized receipt: paper towels, rotisserie chicken, dog food, batteries, olive oil, frozen berries — total as charged at checkout." },

  // 29. Wag N' Wash grooming confirmation
  { from: 'noreply@wagnwash.ca', fromName: "Wag N' Wash", to: ROBERT_EMAIL, dayOffset: -7, hour: 14,
    subject: 'Grooming appointment confirmed',
    body: "This confirms Biscuit's grooming appointment. See you soon!" },

  // 30. Recital parking notes
  { from: 'frontoffice@glebecollegiate.ca', fromName: 'Glebe Collegiate Front Office', to: ROBERT_EMAIL, dayOffset: -3, hour: 9,
    subject: "Re: Ethan's recital — parking notes",
    body: "A quick note on parking for the upcoming recital: street parking is available on Lyon St and Second Ave; the school lot is reserved for staff. See you there!" },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tokenRow, error: tokenError } = await admin
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', ROBERT_USER_ID)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    return new Response(JSON.stringify({ error: 'No Google token found for Robert' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(tokenRow.refresh_token);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: { subject: string; ok: boolean; id?: string; error?: string }[] = [];
  for (const spec of MESSAGES) {
    // Resolve the PDF constant name to actual base64 content.
    const withResolvedPdf: EmailSpec = spec.pdfAttachment
      ? { ...spec, pdfAttachment: { ...spec.pdfAttachment, constB64: PDF_CONST_MAP[spec.pdfAttachment.constB64] } }
      : spec;
    const r = await insertMessage(accessToken, withResolvedPdf);
    results.push({ subject: spec.subject, ok: r.ok, id: r.id, error: r.error });
    // Small delay to stay well under Gmail API per-second quota.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const failCount = results.filter((r) => !r.ok).length;
  return new Response(JSON.stringify({
    success: failCount === 0,
    total: results.length,
    failed: failCount,
    results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

const PDF_CONST_MAP: Record<string, string> = {
  PDF_INVOICE_REYES,
  PDF_INVOICE_HYDRO,
  PDF_INVOICE_AUTODESK,
  PDF_INVOICE_OAC,
  PDF_INVOICE_TAX,
  PDF_CONTRACT_REYES,
  PDF_WARRANTY_BOSCH,
  PDF_RECEIPT_AMAZON,
};
