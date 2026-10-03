import type {
  NativeCalendar,
  NativeCalendarEvent,
  NativeCalendarFacade,
  NativeCalendarPermissionResponse,
  NativeCreateCalendarInput,
} from './native-calendar';

function permissionResponse(
  response: Readonly<{
    status: string;
    granted: boolean;
    canAskAgain: boolean;
  }>,
): NativeCalendarPermissionResponse {
  return {
    status: response.status,
    granted: response.granted,
    canAskAgain: response.canAskAgain,
  };
}

function calendarValue(calendar: {
  id: string;
  title: string;
  allowsModifications: boolean;
  source?: {
    id?: string;
    name: string;
    type: string;
    isLocalAccount?: boolean;
  };
  color?: string;
  isPrimary?: boolean;
  isVisible?: boolean;
  isSynced?: boolean;
}): NativeCalendar {
  return {
    id: calendar.id,
    title: calendar.title,
    allowsModifications: calendar.allowsModifications,
    ...(calendar.source === undefined
      ? {}
      : {
          source: {
            ...(calendar.source.id === undefined
              ? {}
              : { id: calendar.source.id }),
            name: calendar.source.name,
            type: calendar.source.type,
            ...(calendar.source.isLocalAccount === undefined
              ? {}
              : { isLocalAccount: calendar.source.isLocalAccount }),
          },
        }),
    ...(calendar.color === undefined ? {} : { color: calendar.color }),
    ...(calendar.isPrimary === undefined
      ? {}
      : { isPrimary: calendar.isPrimary }),
    ...(calendar.isVisible === undefined
      ? {}
      : { isVisible: calendar.isVisible }),
    ...(calendar.isSynced === undefined ? {} : { isSynced: calendar.isSynced }),
  };
}

function eventValue(event: {
  id: string;
  calendarId: string;
  title: string;
  startDate: Date | string;
  endDate: Date | string;
  notes?: string | null;
  availability?: string | null;
  status?: string | null;
  originalId?: string;
  instanceId?: string;
  originalStartDate?: Date | string;
  allDay?: boolean;
}): NativeCalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    notes: event.notes,
    availability: event.availability,
    status: event.status,
    originalId: event.originalId,
    instanceId: event.instanceId,
    originalStartDate: event.originalStartDate,
    allDay: event.allDay,
  };
}

/**
 * Loads Expo lazily. Importing @workspace/calendar in a Node test therefore
 * does not attempt to resolve CalendarNext through requireNativeModule.
 */
export async function loadExpoCalendarNativeFacade(): Promise<NativeCalendarFacade> {
  const Calendar = await import('expo-calendar');

  async function findCalendar(calendarId: string) {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    return calendars.find((candidate) => candidate.id === calendarId) ?? null;
  }

  return {
    async getPermissionState() {
      return permissionResponse(await Calendar.getCalendarPermissions(false));
    },
    async requestPermission() {
      return permissionResponse(
        await Calendar.requestCalendarPermissions(false),
      );
    },
    async listCalendars() {
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      return calendars.map(calendarValue);
    },
    async createCalendar(input: NativeCreateCalendarInput) {
      const calendar = await Calendar.createCalendar({
        title: input.title,
        entityType: Calendar.EntityTypes.EVENT,
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.ownerAccount === undefined
          ? {}
          : { ownerAccount: input.ownerAccount }),
        ...(input.isVisible === undefined
          ? {}
          : { isVisible: input.isVisible }),
        ...(input.isSynced === undefined ? {} : { isSynced: input.isSynced }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      });
      return calendarValue(calendar);
    },
    async listEvents(calendarIds, start, end) {
      const events = await Calendar.listEvents([...calendarIds], start, end);
      return {
        completeness: 'complete',
        events: events.map(eventValue),
      };
    },
    async createEvent(calendarId, input) {
      const calendar = await findCalendar(calendarId);
      if (calendar === null) {
        throw new Error('The target calendar does not exist.');
      }
      return eventValue(await calendar.createEvent(input));
    },
    async updateEvent(eventId, patch) {
      const event = await Calendar.ExpoCalendarEvent.get(eventId);
      await event.update(patch);
    },
    async deleteEvent(eventId) {
      const event = await Calendar.ExpoCalendarEvent.get(eventId);
      await event.delete();
    },
  };
}
