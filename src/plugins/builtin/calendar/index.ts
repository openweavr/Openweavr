import { definePlugin, defineAction, defineTrigger } from '../../sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const CalDavAuthSchema = z.object({
  calendarUrl: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  bearerToken: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

const ListEventsSchema = CalDavAuthSchema.extend({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().optional(),
});

const CreateEventSchema = CalDavAuthSchema.extend({
  uid: z.string().optional(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string(),
  end: z.string().optional(),
  allDay: z.boolean().optional(),
  timezone: z.string().optional(),
  organizer: z.string().optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    rsvp: z.boolean().optional(),
  })).optional(),
  ifMatch: z.string().optional(),
});

const DeleteEventSchema = CalDavAuthSchema.extend({
  uid: z.string(),
  ifMatch: z.string().optional(),
});

const UpcomingTriggerSchema = CalDavAuthSchema.extend({
  windowMinutes: z.number().default(60),
  pollIntervalSeconds: z.number().default(60),
  lookbackMinutes: z.number().default(5),
});

interface CalendarEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  timezone?: string;
  href?: string;
  etag?: string;
}

function normalizeCalendarUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function buildAuthHeaders(config: z.infer<typeof CalDavAuthSchema>): Record<string, string> {
  if (config.bearerToken) {
    return { Authorization: `Bearer ${config.bearerToken}` };
  }
  if (config.username && config.password) {
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf-8').toString('base64');
    return { Authorization: `Basic ${token}` };
  }
  return {};
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(text: string, tag: string): string | undefined {
  const regex = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)</[^:>]*:?${tag}>`, 'i');
  const match = text.match(regex);
  if (!match) return undefined;
  return decodeXmlEntities(match[1].trim());
}

function parseMultiStatus(xml: string): Array<{ href?: string; etag?: string; calendarData?: string }> {
  const responses = xml.match(/<[^:>]*:?response[^>]*>[\\s\\S]*?<\/[^:>]*:?response>/gi) ?? [];
  return responses.map((response) => {
    const href = extractTag(response, 'href');
    const etag = extractTag(response, 'getetag');
    const calendarDataRaw = extractTag(response, 'calendar-data');
    const calendarData = calendarDataRaw
      ? calendarDataRaw.replace(/^<!\\[CDATA\\[/, '').replace(/\\]\\]>$/, '')
      : undefined;
    return { href, etag, calendarData };
  });
}

function unfoldIcsLines(ics: string): string[] {
  const rawLines = ics
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines.filter((line) => line.length > 0);
}

function parseIcsDate(value: string, params: Record<string, string>): { iso?: string; allDay: boolean; timezone?: string } {
  const tzid = params.TZID;
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return { iso: `${year}-${month}-${day}`, allDay: true, timezone: tzid };
  }

  if (/Z$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return { iso, allDay: false, timezone: 'UTC' };
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
    return { iso, allDay: false, timezone: tzid };
  }

  return { iso: value, allDay: false, timezone: tzid };
}

function parseIcs(ics: string): CalendarEvent[] {
  const lines = unfoldIcsLines(ics);
  const events: CalendarEvent[] = [];
  let current: CalendarEvent | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const [left, ...rest] = line.split(':');
    const value = rest.join(':');
    const [name, ...paramParts] = left.split(';');
    const upperName = name.toUpperCase();

    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const [key, val] = part.split('=');
      if (key && val) {
        params[key.toUpperCase()] = val;
      }
    }

    switch (upperName) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = value;
        break;
      case 'DESCRIPTION':
        current.description = value;
        break;
      case 'LOCATION':
        current.location = value;
        break;
      case 'DTSTART': {
        const parsed = parseIcsDate(value, params);
        current.start = parsed.iso;
        current.allDay = parsed.allDay;
        current.timezone = parsed.timezone;
        break;
      }
      case 'DTEND': {
        const parsed = parseIcsDate(value, params);
        current.end = parsed.iso;
        if (parsed.timezone && !current.timezone) current.timezone = parsed.timezone;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDate(value: string, opts: { allDay?: boolean; timezone?: string }): { value: string; params: string[] } {
  if (/^\d{8}(T\d{6}Z?)?$/.test(value)) {
    return { value, params: [] };
  }

  if (opts.allDay) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
      const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const dd = date.getUTCDate().toString().padStart(2, '0');
      return { value: `${yyyy}${mm}${dd}`, params: ['VALUE=DATE'] };
    }
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    if (opts.timezone && opts.timezone.toUpperCase() !== 'UTC') {
      const yyyy = date.getFullYear().toString().padStart(4, '0');
      const mm = (date.getMonth() + 1).toString().padStart(2, '0');
      const dd = date.getDate().toString().padStart(2, '0');
      const hh = date.getHours().toString().padStart(2, '0');
      const mi = date.getMinutes().toString().padStart(2, '0');
      const ss = date.getSeconds().toString().padStart(2, '0');
      return { value: `${yyyy}${mm}${dd}T${hh}${mi}${ss}`, params: [`TZID=${opts.timezone}`] };
    }

    const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
    const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mi = date.getUTCMinutes().toString().padStart(2, '0');
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    return { value: `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`, params: [] };
  }

  return { value, params: [] };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function queryEvents(config: z.infer<typeof CalDavAuthSchema>, from: string, to: string): Promise<CalendarEvent[]> {
  const calendarUrl = normalizeCalendarUrl(config.calendarUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: '1',
    ...buildAuthHeaders(config),
    ...(config.headers ?? {}),
  };

  const reportBody = `<?xml version="1.0" encoding="utf-8"?>\n<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">\n  <d:prop>\n    <d:getetag/>\n    <c:calendar-data/>\n  </d:prop>\n  <c:filter>\n    <c:comp-filter name="VCALENDAR">\n      <c:comp-filter name="VEVENT">\n        <c:time-range start="${from}" end="${to}"/>\n      </c:comp-filter>\n    </c:comp-filter>\n  </c:filter>\n</c:calendar-query>`;

  const response = await fetchWithTimeout(calendarUrl, {
    method: 'REPORT',
    headers,
    body: reportBody,
  }, 30000);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CalDAV REPORT failed: ${response.status} ${error.slice(0, 200)}`);
  }

  const xml = await response.text();
  const responses = parseMultiStatus(xml);
  const events: CalendarEvent[] = [];

  for (const resp of responses) {
    if (!resp.calendarData) continue;
    const parsed = parseIcs(resp.calendarData);
    for (const event of parsed) {
      events.push({ ...event, href: resp.href, etag: resp.etag });
    }
  }

  return events;
}

function buildEventUrl(calendarUrl: string, uid: string): string {
  const base = normalizeCalendarUrl(calendarUrl);
  return `${base}${encodeURIComponent(uid)}.ics`;
}

function buildEventIcs(input: z.infer<typeof CreateEventSchema>, uid: string): string {
  const start = formatIcsDate(input.start, { allDay: input.allDay, timezone: input.timezone });
  let endValue = input.end ?? input.start;
  if (input.allDay && !input.end) {
    const startDate = new Date(input.start);
    if (!Number.isNaN(startDate.getTime())) {
      endValue = new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
  }
  const end = formatIcsDate(endValue, { allDay: input.allDay, timezone: input.timezone });
  const dtstamp = formatIcsDate(new Date().toISOString(), { allDay: false, timezone: 'UTC' });

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weavr//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP${dtstamp.params.length ? `;${dtstamp.params.join(';')}` : ''}:${dtstamp.value}`,
    `DTSTART${start.params.length ? `;${start.params.join(';')}` : ''}:${start.value}`,
    `DTEND${end.params.length ? `;${end.params.join(';')}` : ''}:${end.value}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
  ];

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  }
  if (input.organizer) {
    lines.push(`ORGANIZER:mailto:${input.organizer}`);
  }
  if (input.attendees) {
    for (const attendee of input.attendees) {
      const params = [
        attendee.name ? `CN=${escapeIcsText(attendee.name)}` : undefined,
        attendee.rsvp ? 'RSVP=TRUE' : undefined,
      ].filter(Boolean);
      lines.push(`ATTENDEE${params.length ? `;${params.join(';')}` : ''}:mailto:${attendee.email}`);
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// Track active polling triggers for cleanup
const activePollers = new Map<string, { stop: () => void }>();

export default definePlugin({
  name: 'calendar',
  version: '1.0.0',
  description: 'CalDAV calendar actions and polling triggers',

  actions: [
    defineAction({
      name: 'list_events',
      description: 'List events from a CalDAV calendar',
      schema: ListEventsSchema,
      async execute(ctx) {
        const config = ListEventsSchema.parse(ctx.config);
        const now = new Date();
        const from = config.from ? formatIcsDate(config.from, { allDay: false, timezone: 'UTC' }).value : formatIcsDate(now.toISOString(), { allDay: false, timezone: 'UTC' }).value;
        const to = config.to ? formatIcsDate(config.to, { allDay: false, timezone: 'UTC' }).value : formatIcsDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), { allDay: false, timezone: 'UTC' }).value;

        const events = await queryEvents(config, from, to);
        const limited = config.limit ? events.slice(0, config.limit) : events;

        return {
          count: limited.length,
          range: { from, to },
          events: limited,
        };
      },
    }),

    defineAction({
      name: 'create_event',
      description: 'Create or update an event in a CalDAV calendar',
      schema: CreateEventSchema,
      async execute(ctx) {
        const config = CreateEventSchema.parse(ctx.config);
        const uid = config.uid ?? randomUUID();
        const url = buildEventUrl(config.calendarUrl, uid);

        const headers: Record<string, string> = {
          'Content-Type': 'text/calendar; charset=utf-8',
          ...buildAuthHeaders(config),
          ...(config.headers ?? {}),
        };

        if (config.ifMatch) {
          headers['If-Match'] = config.ifMatch;
        }

        const body = buildEventIcs(config, uid);
        const response = await fetchWithTimeout(url, {
          method: 'PUT',
          headers,
          body,
        }, 30000);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`CalDAV PUT failed: ${response.status} ${error.slice(0, 200)}`);
        }

        return {
          success: true,
          uid,
          url,
          status: response.status,
        };
      },
    }),

    defineAction({
      name: 'delete_event',
      description: 'Delete an event from a CalDAV calendar',
      schema: DeleteEventSchema,
      async execute(ctx) {
        const config = DeleteEventSchema.parse(ctx.config);
        const url = buildEventUrl(config.calendarUrl, config.uid);

        const headers: Record<string, string> = {
          ...buildAuthHeaders(config),
          ...(config.headers ?? {}),
        };

        if (config.ifMatch) {
          headers['If-Match'] = config.ifMatch;
        }

        const response = await fetchWithTimeout(url, {
          method: 'DELETE',
          headers,
        }, 30000);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`CalDAV DELETE failed: ${response.status} ${error.slice(0, 200)}`);
        }

        return {
          success: true,
          uid: config.uid,
          status: response.status,
        };
      },
    }),
  ],

  triggers: [
    defineTrigger({
      name: 'event_upcoming',
      description: 'Poll CalDAV calendar for upcoming events',
      schema: UpcomingTriggerSchema,
      async setup(config, emit) {
        const parsed = UpcomingTriggerSchema.parse(config);
        const pollKey = `calendar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const seen = new Set<string>();
        let polling = false;

        const poll = async (): Promise<void> => {
          if (polling) return;
          polling = true;
          try {
            const now = Date.now();
            const fromIso = new Date(now - parsed.lookbackMinutes * 60 * 1000).toISOString();
            const toIso = new Date(now + parsed.windowMinutes * 60 * 1000).toISOString();
            const from = formatIcsDate(fromIso, { allDay: false, timezone: 'UTC' }).value;
            const to = formatIcsDate(toIso, { allDay: false, timezone: 'UTC' }).value;

            const events = await queryEvents(parsed, from, to);
            for (const event of events) {
              const key = `${event.uid ?? 'unknown'}:${event.start ?? 'unknown'}`;
              if (seen.has(key)) continue;
              seen.add(key);

              emit({
                type: 'calendar.event_upcoming',
                calendarUrl: parsed.calendarUrl,
                event,
                windowMinutes: parsed.windowMinutes,
                fetchedAt: new Date().toISOString(),
              });
            }
          } catch (err) {
            console.error('[calendar] Polling error:', err);
          } finally {
            polling = false;
          }
        };

        const interval = setInterval(poll, parsed.pollIntervalSeconds * 1000);
        void poll();

        activePollers.set(pollKey, { stop: () => clearInterval(interval) });
        console.log(`[calendar] Polling for upcoming events every ${parsed.pollIntervalSeconds}s`);

        return () => {
          clearInterval(interval);
          activePollers.delete(pollKey);
          console.log('[calendar] Polling stopped');
        };
      },
    }),
  ],

  hooks: {
    async onUnload() {
      for (const poller of activePollers.values()) {
        poller.stop();
      }
      activePollers.clear();
      console.log('[calendar] Cleaned up active pollers');
    },
  },
});
