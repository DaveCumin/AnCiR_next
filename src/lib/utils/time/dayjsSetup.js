// Central dayjs configuration. Every consumer in the app should import
// `dayjs` from here so the plugins are registered exactly once at module load.
//
// Plugins enabled:
//   - utc           : `dayjs.utc(...)` and `.utc()` instance method
//   - timezone      : `dayjs.tz(...)` for IANA zone parsing/conversion
//   - customParseFormat : `dayjs(str, fmt, strict)` for moment-style format strings

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export default dayjs;
